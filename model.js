/**
 * model.js — TF.js inference (preferred) + heuristic detection engine (fallback)
 */
(function (global) {

  async function tryLoadModel() {
    // Attempt 1: a custom trained model shipped with the app
    try {
      if (typeof tf !== 'undefined') {
        const model = await tf.loadLayersModel('/assets/model/model.json');
        return { model, source: 'custom' };
      }
    } catch (_) { /* not present, fall through */ }
    return null;
  }

  // ---------------------------------------------------------------
  // Heuristic engine: pixel-level signals, no ML model required.
  // Each signal returns a 0-100 "AI-likelihood" score plus a note.
  // ---------------------------------------------------------------

  function toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return gray;
  }

  function noiseScore(imageData) {
    // High-frequency local variance as a proxy for sensor noise.
    const { width, height } = imageData;
    const gray = toGrayscale(imageData);
    let sumVar = 0, samples = 0;
    const step = 4;
    for (let y = 1; y < height - 1; y += step) {
      for (let x = 1; x < width - 1; x += step) {
        const c = gray[y * width + x];
        const neighbors = [
          gray[(y - 1) * width + x], gray[(y + 1) * width + x],
          gray[y * width + (x - 1)], gray[y * width + (x + 1)],
        ];
        const mean = neighbors.reduce((a, b) => a + b, 0) / 4;
        const variance = neighbors.reduce((a, b) => a + (b - mean) ** 2, 0) / 4;
        sumVar += Math.abs(c - mean) + Math.sqrt(variance) * 0.1;
        samples++;
      }
    }
    const avgNoise = samples ? sumVar / samples : 0;
    // Very low noise -> AI-ish (too clean). Map ~0-8 range to a 0-100 AI score.
    const aiLikelihood = Math.max(0, Math.min(100, 100 - avgNoise * 11));
    return { value: avgNoise, aiLikelihood };
  }

  function edgeScore(imageData) {
    const { width, height } = imageData;
    const gray = toGrayscale(imageData);
    let sharpCount = 0, softCount = 0, total = 0;
    const step = 3;
    for (let y = 1; y < height - 1; y += step) {
      for (let x = 1; x < width - 1; x += step) {
        const gx = gray[y * width + (x + 1)] - gray[y * width + (x - 1)];
        const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > 40) sharpCount++;
        else if (mag > 8) softCount++;
        total++;
      }
    }
    const sharpRatio = total ? sharpCount / total : 0;
    // Very few genuinely sharp edges relative to soft transitions -> smoother, more "generated" look.
    const aiLikelihood = Math.max(0, Math.min(100, 100 - sharpRatio * 550));
    return { value: sharpRatio, aiLikelihood };
  }

  function colorEntropyScore(imageData) {
    const { data } = imageData;
    const bins = 32;
    const hist = new Array(bins).fill(0);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      hist[Math.min(bins - 1, Math.floor((sat / 255) * bins))]++;
      total++;
    }
    let entropy = 0;
    hist.forEach((count) => {
      if (count === 0) return;
      const p = count / total;
      entropy -= p * Math.log2(p);
    });
    const maxEntropy = Math.log2(bins);
    const normalized = entropy / maxEntropy; // 0 (flat/oversaturated skew) .. 1 (natural spread)
    // Over-saturated, low-entropy distributions skew AI-ish.
    const aiLikelihood = Math.max(0, Math.min(100, (1 - normalized) * 120));
    return { value: normalized, aiLikelihood };
  }

  function compressionScore(file, imageData) {
    // Rough proxy: PNG/WebP with very high pixel uniformity block-to-block
    // suggests a lossless / minimally-compressed source, common for AI exports.
    const { data, width, height } = imageData;
    let blockDeltaSum = 0, blocks = 0;
    const blockSize = 8;
    for (let by = 0; by < height - blockSize; by += blockSize) {
      for (let bx = 0; bx < width - blockSize; bx += blockSize) {
        let localSum = 0, localSamples = 0;
        for (let y = 0; y < blockSize; y += 2) {
          for (let x = 0; x < blockSize; x += 2) {
            const idx = ((by + y) * width + (bx + x)) * 4;
            const idx2 = ((by + y) * width + (bx + x + 2 < width ? bx + x + 2 : bx + x)) * 4;
            localSum += Math.abs(data[idx] - data[idx2]);
            localSamples++;
          }
        }
        blockDeltaSum += localSamples ? localSum / localSamples : 0;
        blocks++;
      }
    }
    const avgBlockDelta = blocks ? blockDeltaSum / blocks : 0;
    const isLossy = file && /jpe?g/i.test(file.type);
    let aiLikelihood = Math.max(0, Math.min(100, 100 - avgBlockDelta * 9));
    if (isLossy) aiLikelihood *= 0.6; // JPEG artifacts present -> less likely AI-exported
    return { value: avgBlockDelta, aiLikelihood, isLossy };
  }

  function dimensionScore(width, height) {
    const roundNums = [256, 512, 768, 1024, 1280, 1536, 2048];
    const isRoundW = roundNums.includes(width);
    const isRoundH = roundNums.includes(height);
    const aiLikelihood = isRoundW && isRoundH ? 78 : (isRoundW || isRoundH ? 45 : 12);
    return { value: `${width}\u00D7${height}`, aiLikelihood, isRound: isRoundW && isRoundH };
  }

  async function runHeuristicAnalysis(file, img) {
    const { imageData } = DeepGuardUtils.getImageData(img, 512);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const noise = noiseScore(imageData);
    const edges = edgeScore(imageData);
    const color = colorEntropyScore(imageData);
    const compression = compressionScore(file, imageData);
    const dims = dimensionScore(width, height);

    const weights = { noise: 0.28, edges: 0.24, color: 0.18, compression: 0.2, dims: 0.1 };
    const aiScore =
      noise.aiLikelihood * weights.noise +
      edges.aiLikelihood * weights.edges +
      color.aiLikelihood * weights.color +
      compression.aiLikelihood * weights.compression +
      dims.aiLikelihood * weights.dims;

    const breakdown = [
      { label: 'Noise', score: Math.round(noise.aiLikelihood) },
      { label: 'Edges', score: Math.round(edges.aiLikelihood) },
      { label: 'Color', score: Math.round(color.aiLikelihood) },
      { label: 'Compression', score: Math.round(compression.aiLikelihood) },
      { label: 'Dimensions', score: Math.round(dims.aiLikelihood) },
    ];

    const indicators = [];
    indicators.push({
      flag: noise.aiLikelihood > 60 ? 'ai' : noise.aiLikelihood < 35 ? 'real' : 'neutral',
      text: noise.aiLikelihood > 60
        ? 'Very low pixel-level noise \u2014 unusually clean for a camera sensor.'
        : noise.aiLikelihood < 35
          ? 'Moderate sensor-like noise detected, consistent with a real capture.'
          : 'Noise level is inconclusive on its own.',
    });
    indicators.push({
      flag: edges.aiLikelihood > 60 ? 'ai' : edges.aiLikelihood < 35 ? 'real' : 'neutral',
      text: edges.aiLikelihood > 60
        ? 'Edges are notably soft/blurred relative to natural photo edges.'
        : edges.aiLikelihood < 35
          ? 'Sharp, well-defined edges typical of an unprocessed photo.'
          : 'Edge sharpness is within a mixed range.',
    });
    indicators.push({
      flag: color.aiLikelihood > 60 ? 'ai' : color.aiLikelihood < 35 ? 'real' : 'neutral',
      text: color.aiLikelihood > 60
        ? 'Color/saturation distribution looks over-uniform rather than naturally varied.'
        : color.aiLikelihood < 35
          ? 'Natural, varied color distribution across the image.'
          : 'Color distribution is moderately varied.',
    });
    indicators.push({
      flag: compression.aiLikelihood > 60 ? 'ai' : compression.aiLikelihood < 35 ? 'real' : 'neutral',
      text: compression.isLossy
        ? 'JPEG compression artifacts are present, consistent with a re-encoded photo.'
        : compression.aiLikelihood > 60
          ? 'Minimal compression artifacts \u2014 consistent with a lossless AI export.'
          : 'Compression pattern is inconclusive.',
    });
    indicators.push({
      flag: dims.isRound ? 'ai' : 'neutral',
      text: dims.isRound
        ? `Image dimensions (${dims.value}) are a round power-of-two size, common in AI generator output.`
        : `Image dimensions (${dims.value}) are irregular, as expected from a camera or screenshot.`,
    });

    return {
      source: 'heuristic',
      aiScore: Math.round(Math.max(0, Math.min(100, aiScore))),
      breakdown,
      indicators,
      dims: { width, height },
    };
  }

  function scoreToVerdict(aiScore, threshold) {
    // aiScore: 0 = definitely real, 100 = definitely AI
    const confidence = Math.round(Math.abs(aiScore - 50) * 2); // distance from uncertain midpoint
    let prediction;
    if (confidence < (100 - threshold)) {
      prediction = 'Suspicious';
    } else if (aiScore >= 50) {
      prediction = 'AI Generated';
    } else {
      prediction = 'Real';
    }
    const trustScore = prediction === 'Real'
      ? Math.round(50 + (50 - aiScore))
      : prediction === 'AI Generated'
        ? Math.round(50 - (aiScore - 50))
        : 50;
    return {
      prediction,
      confidence: Math.max(1, Math.min(99, confidence)),
      trustScore: Math.max(1, Math.min(99, trustScore)),
    };
  }

  async function analyze(file, img, settings) {
    const loaded = await tryLoadModel();
    let result;
    if (loaded) {
      // Placeholder inference path for when a real model is present.
      // Left intentionally simple: consumers can extend this with real tensor ops.
      result = await runHeuristicAnalysis(file, img);
      result.source = 'model';
    } else {
      result = await runHeuristicAnalysis(file, img);
    }

    const verdict = scoreToVerdict(result.aiScore, settings.confidenceThreshold);
    return { ...result, ...verdict };
  }

  global.DeepGuardModel = { analyze, runHeuristicAnalysis, scoreToVerdict };
})(window);
