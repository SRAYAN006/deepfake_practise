/**
 * storage.js — localStorage CRUD with schema migration
 * Key: deepfakeValidator:data
 */
(function (global) {
  const STORAGE_KEY = 'deepfakeValidator:data';
  const CURRENT_VERSION = 2;
  const MAX_HISTORY = 100;

  const DEFAULT_SETTINGS = {
    theme: 'dark',
    confidenceThreshold: 65,
    autoAnalyze: true,
    saveHistory: true,
    enableAnimations: true,
  };

  function defaultData() {
    return { version: CURRENT_VERSION, settings: { ...DEFAULT_SETTINGS }, history: [] };
  }

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return defaultData();
    let data = { ...raw };

    // v1 -> v2: introduce enableAnimations setting, ensure history array exists
    if (!data.version || data.version < 2) {
      data = {
        version: 2,
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        history: Array.isArray(data.history) ? data.history : [],
      };
    }

    // Always backfill any missing settings keys (forward-compatible)
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    if (!Array.isArray(data.history)) data.history = [];
    data.version = CURRENT_VERSION;
    return data;
  }

  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (err) {
      console.warn('DeepGuard storage: failed to read, resetting.', err);
      return defaultData();
    }
  }

  function write(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('DeepGuard storage: failed to write.', err);
      return false;
    }
  }

  const Storage = {
    getAll() {
      return read();
    },

    getSettings() {
      return read().settings;
    },

    updateSettings(patch) {
      const data = read();
      data.settings = { ...data.settings, ...patch };
      write(data);
      return data.settings;
    },

    getHistory() {
      return read().history;
    },

    addHistoryEntry(entry) {
      const data = read();
      const record = {
        id: entry.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        filename: entry.filename,
        timestamp: entry.timestamp || Date.now(),
        prediction: entry.prediction,
        confidence: entry.confidence,
        trustScore: entry.trustScore,
        fileSize: entry.fileSize,
        format: entry.format,
        thumbUrl: entry.thumbUrl,
      };
      data.history.unshift(record);
      if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY;
      write(data);
      return record;
    },

    deleteHistoryEntry(id) {
      const data = read();
      data.history = data.history.filter((h) => h.id !== id);
      write(data);
    },

    clearHistory() {
      const data = read();
      data.history = [];
      write(data);
    },
  };

  global.DeepGuardStorage = Storage;
})(window);
