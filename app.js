/**
 * app.js — App controller & UI logic
 */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const Storage = window.DeepGuardStorage;
  const Utils = window.DeepGuardUtils;
  const Model = window.DeepGuardModel;

  let settings = Storage.getSettings();
  let currentFile = null;
  let currentImg = null;
  let currentDataUrl = null;
  let lastAnalysis = null;

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------
  function initTabs() {
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function switchTab(name) {
    $$('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    $$('.panel').forEach((p) => {
      const active = p.id === `panel-${name}`;
      p.classList.toggle('is-active', active);
      p.hidden = !active;
    });
    updateFab();
  }

  // ---------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    $('#theme-toggle .icon-sun').hidden = theme !== 'light';
    $('#theme-toggle .icon-moon').hidden = theme === 'light';
    $('#setting-theme').setAttribute('aria-checked', String(theme === 'dark'));
  }

  function initTheme() {
    applyTheme(settings.theme || 'dark');
    $('#theme-toggle').addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      settings = Storage.updateSettings({ theme: next });
      applyTheme(next);
    });
    $('#setting-theme').addEventListener('click', () => {
      const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
      settings = Storage.updateSettings({ theme: next });
      applyTheme(next);
    });
  }

  // ---------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------
  function initSettingsModal() {
    const overlay = $('#settings-overlay');
    const modal = $('#settings-modal');
    const openBtn = $('#settings-toggle');
    const closeBtn = $('#settings-close');

    function open() {
      overlay.hidden = false;
      modal.hidden = false;
      openBtn.setAttribute('aria-expanded', 'true');
      closeBtn.focus();
      document.addEventListener('keydown', onKeydown);
    }
    function close() {
      overlay.hidden = true;
      modal.hidden = true;
      openBtn.setAttribute('aria-expanded', 'false');
      openBtn.focus();
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const focusables = $$('button, input', modal);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', close);

    const thresholdInput = $('#setting-threshold');
    thresholdInput.value = settings.confidenceThreshold;
    $('#threshold-value').textContent = settings.confidenceThreshold;
    thresholdInput.addEventListener('input', () => {
      $('#threshold-value').textContent = thresholdInput.value;
      settings = Storage.updateSettings({ confidenceThreshold: Number(thresholdInput.value) });
    });

    const autoSwitch = $('#setting-auto');
    autoSwitch.setAttribute('aria-checked', String(!!settings.autoAnalyze));
    autoSwitch.addEventListener('click', () => {
      const next = autoSwitch.getAttribute('aria-checked') !== 'true';
      autoSwitch.setAttribute('aria-checked', String(next));
      settings = Storage.updateSettings({ autoAnalyze: next });
    });

    const historySwitch = $('#setting-history');
    historySwitch.setAttribute('aria-checked', String(!!settings.saveHistory));
    historySwitch.addEventListener('click', () => {
      const next = historySwitch.getAttribute('aria-checked') !== 'true';
      historySwitch.setAttribute('aria-checked', String(next));
      settings = Storage.updateSettings({ saveHistory: next });
    });
  }

  // ---------------------------------------------------------------
  // Snackbar
  // ---------------------------------------------------------------
  let snackbarTimer = null;
  function showSnackbar(message, type = 'info') {
    const el = $('#snackbar');
    el.textContent = message;
    el.className = `snackbar type-${type}`;
    el.hidden = false;
    clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ---------------------------------------------------------------
  // Upload (Analyze tab)
  // ---------------------------------------------------------------
  function initUpload() {
    const zone = $('#upload-zone');
    const fileInput = $('#file-input');
    const browseBtn = $('#browse-btn');
    const errorEl = $('#upload-error');
    const removeBtn = $('#remove-image-btn');

    browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    zone.addEventListener('click', (e) => {
      if (!$('#upload-preview').hidden) return;
      fileInput.click();
    });
    zone.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && $('#upload-preview').hidden) {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    ['dragenter', 'dragover'].forEach((evt) =>
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('is-dragover'); })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('is-dragover'); })
    );
    zone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    document.addEventListener('paste', (e) => {
      if (!$('#panel-analyze').classList.contains('is-active')) return;
      const item = Array.from(e.clipboardData.items || []).find((i) => i.type.startsWith('image/'));
      if (item) handleFile(item.getAsFile());
    });

    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetUpload();
    });

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
      zone.classList.add('has-error');
    }
    function clearError() {
      errorEl.hidden = true;
      zone.classList.remove('has-error');
    }

    async function handleFile(file) {
      clearError();
      const validation = Utils.validateFile(file);
      if (!validation.ok) {
        showError(validation.error);
        return;
      }
      try {
        const { img, dataUrl } = await Utils.loadImageFromFile(file);
        currentFile = file;
        currentImg = img;
        currentDataUrl = dataUrl;

        $('#upload-empty').hidden = true;
        $('#upload-preview').hidden = false;
        $('#preview-img').src = dataUrl;
        $('#preview-img').alt = `Preview of ${Utils.sanitizeFilename(file.name)}`;
        $('#preview-filename').textContent = Utils.sanitizeFilename(file.name);
        $('#analyze-actions').hidden = false;
        updateFab();
        hideResults();

        if (settings.autoAnalyze) {
          runAnalysis();
        }
      } catch (err) {
        showError(err.message || 'Could not load that file.');
      }
    }

    global_handleFile = handleFile; // exposed for FAB / paste reuse if needed
  }

  let global_handleFile = null;

  function resetUpload() {
    currentFile = null;
    currentImg = null;
    currentDataUrl = null;
    lastAnalysis = null;
    $('#upload-empty').hidden = false;
    $('#upload-preview').hidden = true;
    $('#file-input').value = '';
    $('#analyze-actions').hidden = true;
    hideResults();
    updateFab();
  }

  function hideResults() {
    $('#results').hidden = true;
    $('#progress-block').hidden = true;
  }

  function updateFab() {
    const analyzing = $('#panel-analyze').classList.contains('is-active');
    $('#fab-analyze').hidden = !(analyzing && currentImg);
  }

  // ---------------------------------------------------------------
  // Analysis flow
  // ---------------------------------------------------------------
  async function runAnalysis() {
    if (!currentFile || !currentImg) return;
    hideResults();
    const progressBlock = $('#progress-block');
    const steps = $$('#progress-steps li');
    progressBlock.hidden = false;

    async function step(name, ms) {
      steps.forEach((s) => s.classList.remove('is-active'));
      const el = steps.find((s) => s.dataset.step === name);
      if (el) el.classList.add('is-active');
      await new Promise((r) => setTimeout(r, ms));
      if (el) { el.classList.remove('is-active'); el.classList.add('is-done'); }
    }

    await step('load', 150);
    await step('model', 200);
    await step('heuristics', 350);
    const analysis = await Model.analyze(currentFile, currentImg, settings);
    await step('score', 150);

    progressBlock.hidden = true;
    lastAnalysis = analysis;
    renderResults(analysis);

    if (settings.saveHistory) {
      Storage.addHistoryEntry({
        filename: currentFile.name,
        prediction: analysis.prediction,
        confidence: analysis.confidence,
        trustScore: analysis.trustScore,
        fileSize: Utils.formatBytes(currentFile.size),
        format: currentFile.type.replace('image/', '').toUpperCase(),
        thumbUrl: currentDataUrl,
      });
      renderHistory();
    }
  }

  function verdictClass(prediction) {
    if (prediction === 'Real') return 'real';
    if (prediction === 'AI Generated') return 'ai';
    return 'suspicious';
  }

  function renderResults(analysis) {
    $('#results').hidden = false;

    const badge = $('#verdict-badge');
    badge.textContent = analysis.prediction;
    badge.className = `verdict-badge ${verdictClass(analysis.prediction)}`;

    $('#confidence-num').textContent = `${analysis.confidence}%`;
    $('#confidence-bar-fill').style.width = `${analysis.confidence}%`;

    const ringFill = $('#trust-ring-fill');
    const circumference = 326.7;
    const offset = circumference - (analysis.trustScore / 100) * circumference;
    ringFill.style.strokeDashoffset = offset;
    ringFill.style.stroke = analysis.prediction === 'Real' ? 'var(--success)'
      : analysis.prediction === 'AI Generated' ? 'var(--error)' : 'var(--warning)';
    $('#trust-score-num').textContent = analysis.trustScore;

    $('#heuristic-notice').hidden = analysis.source !== 'heuristic';

    // Info list
    const info = $('#info-list');
    info.innerHTML = '';
    const infoItems = [
      ['Dimensions', `${analysis.dims.width} \u00D7 ${analysis.dims.height}`],
      ['File size', Utils.formatBytes(currentFile.size)],
      ['Format', currentFile.type.replace('image/', '').toUpperCase()],
      ['Filename', Utils.sanitizeFilename(currentFile.name)],
    ];
    infoItems.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      info.append(dt, dd);
    });

    // Indicators
    const list = $('#indicator-list');
    list.innerHTML = '';
    analysis.indicators.forEach((ind) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = `indicator-dot flag-${ind.flag}`;
      const text = document.createElement('span');
      text.textContent = ind.text;
      li.append(dot, text);
      list.appendChild(li);
    });

    // Breakdown
    const breakdown = $('#breakdown-list');
    breakdown.innerHTML = '';
    analysis.breakdown.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `<span>${b.label}</span><span class="track"><span class="fill" style="width:${b.score}%"></span></span><span class="val">${b.score}%</span>`;
      breakdown.appendChild(row);
    });

    // Histogram
    const { imageData } = Utils.getImageData(currentImg, 256);
    const histogram = Utils.computeHistogram(imageData);
    Utils.drawHistogram($('#histogram-canvas'), histogram);
  }

  // ---------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------
  function initExport() {
    $('#export-json-btn').addEventListener('click', () => {
      if (!lastAnalysis || !currentFile) return;
      const report = {
        filename: Utils.sanitizeFilename(currentFile.name),
        timestamp: Date.now(),
        prediction: lastAnalysis.prediction,
        confidence: lastAnalysis.confidence,
        trustScore: lastAnalysis.trustScore,
        breakdown: lastAnalysis.breakdown,
        indicators: lastAnalysis.indicators.map((i) => i.text),
        dimensions: `${lastAnalysis.dims.width}x${lastAnalysis.dims.height}`,
        fileSize: Utils.formatBytes(currentFile.size),
        format: currentFile.type,
        analysisSource: lastAnalysis.source,
      };
      Utils.downloadJSON(`deepguard-report-${Date.now()}.json`, report);
      showSnackbar('JSON report downloaded.', 'success');
    });

    $('#export-pdf-btn').addEventListener('click', () => {
      if (!lastAnalysis || !currentFile) return;
      Utils.openPrintReport({
        filename: currentFile.name,
        timestamp: Date.now(),
        prediction: lastAnalysis.prediction,
        confidence: lastAnalysis.confidence,
        trustScore: lastAnalysis.trustScore,
        dimensions: `${lastAnalysis.dims.width}\u00D7${lastAnalysis.dims.height}`,
        fileSize: Utils.formatBytes(currentFile.size),
        format: currentFile.type.replace('image/', '').toUpperCase(),
      });
    });
  }

  // ---------------------------------------------------------------
  // Analyze / FAB buttons
  // ---------------------------------------------------------------
  function initAnalyzeButtons() {
    $('#analyze-btn').addEventListener('click', runAnalysis);
    $('#fab-analyze').addEventListener('click', runAnalysis);
  }

  // ---------------------------------------------------------------
  // History tab
  // ---------------------------------------------------------------
  function renderHistory() {
    const list = $('#history-list');
    const entries = Storage.getHistory();
    list.innerHTML = '';
    $('#history-empty').hidden = entries.length > 0;

    entries.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'history-card';
      const date = new Date(entry.timestamp).toLocaleString();
      li.innerHTML = `
        <img class="history-thumb" src="${entry.thumbUrl || ''}" alt="" />
        <div class="history-meta">
          <div class="history-filename">${Utils.sanitizeFilename(entry.filename)}</div>
          <div class="history-sub">${date} \u00B7 ${entry.fileSize || ''} \u00B7 ${entry.format || ''}</div>
        </div>
        <span class="history-verdict ${verdictClass(entry.prediction)}">${entry.prediction}</span>
        <button class="icon-btn history-delete" aria-label="Delete this history entry" data-id="${entry.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>`;
      list.appendChild(li);
    });

    $$('.history-delete', list).forEach((btn) => {
      btn.addEventListener('click', () => {
        Storage.deleteHistoryEntry(btn.dataset.id);
        renderHistory();
        showSnackbar('Entry deleted.', 'info');
      });
    });
  }

  function initHistory() {
    renderHistory();
    $('#clear-history-btn').addEventListener('click', () => {
      Storage.clearHistory();
      renderHistory();
      showSnackbar('History cleared.', 'info');
    });
  }

  // ---------------------------------------------------------------
  // Compare tab
  // ---------------------------------------------------------------
  function initCompare() {
    const slots = { a: null, b: null };
    const imgs = { a: null, b: null };

    ['a', 'b'].forEach((key) => {
      const slot = $(`#compare-slot-${key}`);
      const input = $('input[type="file"]', slot);
      const imgEl = $('.compare-img', slot);
      const badge = $('.compare-badge', slot);
      const emptyEl = $('.compare-slot-empty', slot);

      slot.addEventListener('click', () => input.click());
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const validation = Utils.validateFile(file);
        if (!validation.ok) { showSnackbar(validation.error, 'error'); return; }
        const { img, dataUrl } = await Utils.loadImageFromFile(file);
        slots[key] = file;
        imgs[key] = img;
        emptyEl.hidden = true;
        imgEl.hidden = false;
        imgEl.src = dataUrl;
        imgEl.alt = `Preview of ${Utils.sanitizeFilename(file.name)}`;
        badge.hidden = true;
        $('#compare-btn').disabled = !(slots.a && slots.b);
      });
    });

    $('#compare-btn').addEventListener('click', async () => {
      $('#compare-btn').disabled = true;
      $('#compare-btn').textContent = 'Comparing\u2026';

      const [resA, resB] = await Promise.all([
        Model.analyze(slots.a, imgs.a, settings),
        Model.analyze(slots.b, imgs.b, settings),
      ]);

      ['a', 'b'].forEach((key) => {
        const res = key === 'a' ? resA : resB;
        const slot = $(`#compare-slot-${key}`);
        const badge = $('.compare-badge', slot);
        badge.hidden = false;
        badge.textContent = `${res.prediction} \u00B7 ${res.confidence}%`;
        badge.className = `compare-badge ${verdictClass(res.prediction)}`;
      });

      const dataA = Utils.getImageData(imgs.a, 240).imageData;
      const dataB = Utils.getImageData(imgs.b, 240).imageData;
      const { imageData: diffData } = Utils.computePixelDiff(dataA, dataB);
      const canvas = $('#heatmap-canvas');
      canvas.width = diffData.width;
      canvas.height = diffData.height;
      canvas.getContext('2d').putImageData(diffData, 0, 0);
      $('#heatmap-card').hidden = false;

      $('#compare-btn').disabled = false;
      $('#compare-btn').textContent = 'Compare both';
    });
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  function init() {
    initTabs();
    initTheme();
    initSettingsModal();
    initUpload();
    initAnalyzeButtons();
    initExport();
    initHistory();
    initCompare();
    updateFab();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
