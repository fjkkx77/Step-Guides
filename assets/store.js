/* 草稿仓库：IndexedDB。
   为什么不用 localStorage：它只有 ~5MB，12 张截图转 base64 就 4MB 起，必爆；
   而且图片 Blob 可以直接结构化克隆进 IndexedDB，不用转码。

   2026-10-09 起草稿按「哪一份」分开存（审查 P0-1）：以前只有一个位置，
   去「编辑」另一份已发布教程时，自动保存会把还没发布的新草稿整份覆盖掉。现在每份各占一个位置：
     new:<随机码>   一份还没发布过的新教程（地址 /w/?draft=<随机码> 能接着写）
     edit:<编号>    对某份已发布教程、还没发布出去的修改
   图片单独存一张表（键 = 位置|步骤 key）：打字时只写文字那条小记录，
   不再每次都把所有原图重写一遍（审查 O-3：30 张原图每次保存要重写 75MB）。 */
(() => {
  'use strict';

  const DB = 'step-guides';
  const META = 'drafts', BLOBS = 'blobs', OLD = 'draft';
  const range = slot => IDBKeyRange.bound(slot + '|', slot + '|~');   // 步骤 key 只有小写字母和数字，「~」比它们都大

  /** 草稿记录里不放 Blob 和临时地址，只记「这一步有没有本地图片」 */
  const toMeta = (slot, d) => ({
    slot, id: d.id || null, title: d.title || '', gone: d.gone || [], known: d.known || [],
    steps: (d.steps || []).map(s => ({ key: s.key, remote: s.remote || null, w: s.w, h: s.h,
                                       title: s.title || '', text: s.text || '', name: s.name || '', hasBlob: !!(s.blob || s.hasBlob) })),
    savedAt: Date.now()
  });

  function openDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = e => {
        const db = req.result, t = req.transaction;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
        // 老版本（只有一个位置 draft/current）升上来：把那份草稿搬进新结构，升级不能弄丢用户的东西
        if (e.oldVersion >= 1 && db.objectStoreNames.contains(OLD)) {
          const old = t.objectStore(OLD), g = old.get('current');
          g.onsuccess = () => {
            const d = g.result;
            if (d && d.steps && d.steps.length) {
              // 老版本只有成功发布后才写编号，所以带编号的就是「改已发布教程」的草稿
              const slot = d.id ? 'edit:' + d.id : 'new:m' + Date.now().toString(36);
              d.steps.forEach(s => { if (s.blob) t.objectStore(BLOBS).put(s.blob, slot + '|' + s.key); });
              t.objectStore(META).put(toMeta(slot, d), slot);
            }
            old.delete('current');
          };
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('草稿库被另一个标签页占着，关掉其它写作页再试'));
    });
  }

  /** 开一个事务跑 fn(t, setResult)；事务真正提交完才算成功（写满了、被中止都会报错） */
  async function tx(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((res, rej) => {
        let out, t;
        try {
          t = db.transaction([META, BLOBS], mode);
          t.oncomplete = () => res(out);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error || new Error('草稿没存上'));
          fn(t, v => { out = v; });
        } catch (e) {
          try { t && t.abort(); } catch (_) { /* 已经结束 */ }
          rej(e);
        }
      });
    } finally {
      db.close();
    }
  }

  /** 保存一份草稿。blobs = 这次新加/换掉的图 [{key, blob}]；已经存过的图不用再传。
      drop = 这一页删掉的步骤 key：只删这些图。不按「这一页没用到的就删」去清——
      同一份草稿在两个标签页里开着时，那样会把另一页刚存的图删掉（code-review） */
  const save = (slot, draft, blobs, drop) => tx('readwrite', t => {
    const meta = toMeta(slot, draft);
    const B = t.objectStore(BLOBS);
    t.objectStore(META).put(meta, slot);
    (blobs || []).forEach(b => B.put(b.blob, slot + '|' + b.key));
    (drop || []).forEach(k => B.delete(slot + '|' + k));
  });

  /** 读一份草稿（图片一起取回来，挂在每一步的 blob 上）；没有就是 null */
  const load = slot => tx('readonly', (t, done) => {
    const g = t.objectStore(META).get(slot);
    g.onsuccess = () => {
      const m = g.result || null;
      done(m);
      if (!m) return;
      const B = t.objectStore(BLOBS);
      m.steps.forEach(s => {
        if (!s.hasBlob) return;
        const r = B.get(slot + '|' + s.key);
        r.onsuccess = () => { s.blob = r.result || null; };
      });
    };
  });

  const clear = slot => tx('readwrite', t => {
    t.objectStore(META).delete(slot);
    t.objectStore(BLOBS).delete(range(slot));
  });

  /** 所有草稿（不含图片），最近保存的在前 */
  const list = () => tx('readonly', (t, done) => {
    const r = t.objectStore(META).getAll();
    r.onsuccess = () => done((r.result || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
  });

  window.SGStore = { save, load, clear, list };
})();
