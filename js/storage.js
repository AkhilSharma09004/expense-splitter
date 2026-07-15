/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Thin persistence layer around localStorage. The whole app state is kept as
 * a single JSON blob so the "database" is trivially inspectable, exportable
 * and importable — handy for a client-only demo, and it keeps every other
 * module ignorant of *how* data is persisted (they just call Store.get/set).
 * ---------------------------------------------------------------------------
 */
const Store = (() => {
  const KEY = 'tally:v1';

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  const DEFAULT_STATE = {
    schemaVersion: 1,
    currency: '₹',
    theme: 'light',
    meId: 'you',
    view: 'dashboard',
    activeGroupId: null,
    people: [],
    groups: [],
    activity: [], // expenses + settlements, newest first is NOT guaranteed; sort on read
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return { ...clone(DEFAULT_STATE), ...parsed };
    } catch (err) {
      console.error('Tally: failed to read local storage, starting fresh.', err);
      return clone(DEFAULT_STATE);
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error('Tally: failed to persist state.', err);
      return false;
    }
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  return { load, save, clear, DEFAULT_STATE };
})();
