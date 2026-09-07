/** Jest mock: blob-util native module is unavailable in tests. */
const store = new Map();

const fs = {
  dirs: {DocumentDir: '/tmp/mock-docs', CacheDir: '/tmp/mock-cache'},
  exists: async path => store.has(path) || false,
  mkdir: async () => {},
  stat: async path => ({size: String(store.get(path)?.length ?? 0)}),
  unlink: async path => {
    store.delete(path);
  },
  mv: async (from, to) => {
    store.set(to, store.get(from));
    store.delete(from);
  },
  writeFile: async (path, data) => {
    store.set(path, data);
  },
  readFile: async path => store.get(path) ?? '',
};

function config() {
  const task = Promise.resolve({info: () => ({status: 200})});
  task.progress = () => task;
  task.cancel = cb => cb && cb();
  return {fetch: () => task};
}

module.exports = {__esModule: true, default: {fs, config}};
