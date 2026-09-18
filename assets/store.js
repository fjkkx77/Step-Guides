/* 草稿仓库：IndexedDB 存一条记录。
   为什么不用 localStorage：它只有 ~5MB，12 张截图转 base64 就 4MB 起，必爆；
   而且图片 Blob 可以直接结构化克隆进 IndexedDB，不用转码。 */
(() => {
  'use strict';

  const DB = 'step-guides';
  const STORE = 'draft';
  const KEY = 'current';

  function openDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    } finally {
      db.close();
    }
  }

  const save  = draft => tx('readwrite', s => s.put(draft, KEY));
  const load  = ()    => tx('readonly',  s => s.get(KEY));
  const clear = ()    => tx('readwrite', s => s.delete(KEY));

  window.SGStore = { save, load, clear };
})();
