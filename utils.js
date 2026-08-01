/**
 * utils.js — file validation, export, histogram, pixel analysis
 */
(function (global) {
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
 
  function sanitizeFilename(name) {
    if (!name) return 'untitled';
    // Strip anything that could be interpreted as markup; never used in innerHTML anyway,
    // but keep it inert for exports and defense-in-depth.
    return String(name).replace(/[<>&"']/g, '').slice(0, 180);
  }
 
  function validateFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    if (!file.type || !file.type.startsWith('image/')) {
      return { ok: false, error: 'That file doesn\u2019t look like an image. Please upload a JPG, PNG, or WebP.' };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: 'File is larger than 20\u00A0MB. Please choose a smaller image.' };
    }
    return { ok: true };
  }
 
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let val = bytes / 1024;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024;
      i++;
    }
    return `${val.toFixed(1)} ${units[i]}`;
  }
 
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ img, dataUrl: reader.result });
        img.onerror = () => reject(new Error('Could not decode image \u2014 the file may be corrupted.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }
 
  function getImageData(img, maxDim = 512) {
    const canvas = document.createElement('canvas');
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), canvas };
  }
 
  function computeHistogram(imageData) {
    const bins = 32;
    const r = new Array(bins).fill(0);
    const g = new Array(bins).fill(0);
    const b = new Array(bins).fill(0);
    const data = imageData.data;
    const step = 256 / bins;
    for (let i = 0; i < data.length; i += 4) {
      r[Math.min(bins - 1, Math.floor(data[i] / step))]++;
      g[Math.min(bins - 1, Math.floor(data[i + 1] / step))]++;
      b[Math.min(bins - 1, Math.floor(data[i + 2] / step))]++;
    }
    return { r, g, b, bins };
  }
 
  function drawHistogram(canvas, histogram) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const styles = getComputedStyle(document.body);
    const colors = {
      r: 'rgba(229, 85, 95, 0.75)',
      g: 'rgba(61, 184, 122, 0.75)',
      b: 'rgba(91, 141, 239, 0.75)',
    };
    const max = Math.max(...histogram.r, ...histogram.g, ...histogram.b, 1);
    const barW = w / histogram.bins;
 
    ['r', 'g', 'b'].forEach((channel) => {
      ctx.fillStyle = colors[channel];
      histogram[channel].forEach((count, i) => {
        const barH = (count / max) * (h - 8);
        ctx.fillRect(i * barW + (channel === 'r' ? 0 : channel === 'g' ? barW / 3 : (2 * barW) / 3), h - barH, barW / 3, barH);
      });
    });
  }
 
  function computePixelDiff(imageDataA, imageDataB) {
    const w = Math.min(imageDataA.width, imageDataB.width);
    const h = Math.min(imageDataA.height, imageDataB.height);
    const out = new ImageData(w, h);
    const a = imageDataA.data, b = imageDataB.data;
    let totalDiff = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ia = (y * imageDataA.width + x) * 4;
        const ib = (y * imageDataB.width + x) * 4;
        const io = (y * w + x) * 4;
        const dr = Math.abs(a[ia] - b[ib]);
        const dg = Math.abs(a[ia + 1] - b[ib + 1]);
        const db = Math.abs(a[ia + 2] - b[ib + 2]);
        const diff = (dr + dg + db) / 3;
        totalDiff += diff;
        // heat ramp: low diff -> transparent/blue, high diff -> gold/red
        out.data[io] = Math.min(255, diff * 2.4);
        out.data[io + 1] = Math.max(0, 120 - diff);
        out.data[io + 2] = Math.max(0, 200 - diff * 1.5);
        out.data[io + 3] = Math.min(255, 60 + diff * 2);
      }
    }
    return { imageData: out, avgDiff: totalDiff / (w * h) };
  }
 
  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
 
  function openPrintReport(report) {
    const win = window.open('', '_blank');
    if (!win) return;
    const safeName = sanitizeFilename(report.filename);
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>DeepGuard Report \u2014 ${safeName}</title>
      <style>
        body{font-family: Inter, Arial, sans-serif; color:#17171A; padding:40px; max-width:720px; margin:0 auto;}
        h1{font-size:22px; margin-bottom:4px;}
        .muted{color:#666; font-size:13px; margin-bottom:24px;}
        table{width:100%; border-collapse:collapse; margin-top:16px;}
        td,th{padding:8px 4px; text-align:left; border-bottom:1px solid #e5e5e5; font-size:14px;}
        .verdict{display:inline-block; padding:4px 10px; border-radius:6px; font-weight:600;}
      </style></head><body>
      <h1>DeepGuard Analysis Report</h1>
      <p class="muted">Generated ${new Date(report.timestamp).toLocaleString()}</p>
      <table>
        <tr><th>Filename</th><td>${safeName}</td></tr>
        <tr><th>Verdict</th><td>${report.prediction}</td></tr>
        <tr><th>Confidence</th><td>${report.confidence}%</td></tr>
        <tr><th>Trust score</th><td>${report.trustScore}</td></tr>
        <tr><th>Dimensions</th><td>${report.dimensions || '\u2014'}</td></tr>
        <tr><th>File size</th><td>${report.fileSize || '\u2014'}</td></tr>
        <tr><th>Format</th><td>${report.format || '\u2014'}</td></tr>
      </table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }
 
  global.DeepGuardUtils = {
    validateFile,
    formatBytes,
    loadImageFromFile,
    getImageData,
    computeHistogram,
    drawHistogram,
    computePixelDiff,
    downloadJSON,
    openPrintReport,
    sanitizeFilename,
  };
})(window);