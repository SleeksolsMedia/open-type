/** Jest mock: in-memory MMKV (native Nitro module is unavailable in tests). */
class MMKV {
  constructor() {
    this.store = new Map();
  }
  getString(key) {
    const v = this.store.get(key);
    return v === undefined ? undefined : v;
  }
  set(key, value) {
    this.store.set(key, value);
  }
  delete(key) {
    this.store.delete(key);
  }
  clearAll() {
    this.store.clear();
  }
}

function createMMKV() {
  return new MMKV();
}

function existsMMKV() {
  return false;
}

function deleteMMKV() {}

module.exports = {MMKV, createMMKV, existsMMKV, deleteMMKV};
