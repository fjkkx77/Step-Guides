/* 写作页、教程库只在 jc.wbztl.xyz 上用（审查 P2-11）。
   为什么：<用户名>.github.io 下面所有 Pages 项目在浏览器看来是同一个「源」，本地存储互相看得见。
   你在那儿开着 11 个站，token 若存在 github.io 这边，其中任何一个站出了脚本注入就能读走它。
   所以在 github.io 上打开写作页/教程库时：清掉那边存的设置（含 token），转到 jc.wbztl.xyz 的同一页
   （地址里 ?edit=… 和 # 后面的扫码设置原样带过去）。教程本身照样能在 github.io 上看。

   例外（code-review）：github.io 这边的浏览器里还存着没发完的草稿时，不转走——草稿存在这个「源」里，
   转去新地址就再也打不开了。这时只在页面顶上提示一句，等你把草稿发布或导出备份；草稿清空后下次再打开就会转走。
   这个文件要在页面最前面加载（放在 <head> 里），转走之前别的脚本还没来得及读 token。 */
window.SGPrimary = {
  origin: 'https://jc.wbztl.xyz',
  /** 该转去哪：不在 github.io 上就返回 null */
  target(href) {
    const u = new URL(href);
    if (!u.hostname.endsWith('.github.io')) return null;
    const p = u.pathname.startsWith('/Step-Guides/') ? u.pathname.slice('/Step-Guides'.length) : u.pathname;
    return this.origin + p + u.search + u.hash;
  },
  /** 这个源里还有几份草稿（新旧两种存法都算）。读不了就当 0 */
  async countDrafts() {
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        if (!dbs.some(d => d.name === 'step-guides')) return 0;   // 没建过就别去 open（open 会凭空建一个空库）
      }
      const db = await new Promise((res, rej) => { const r = indexedDB.open('step-guides'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const count = name => new Promise(res => {
        if (!db.objectStoreNames.contains(name)) return res(0);
        const q = db.transaction(name, 'readonly').objectStore(name).count();
        q.onsuccess = () => res(q.result); q.onerror = () => res(0);
      });
      const n = (await count('drafts')) + (await count('draft'));
      db.close();
      return n;
    } catch (e) { return 0; }
  }
};
(async () => {
  const t = window.SGPrimary.target(location.href);
  if (!t) return;
  const root = document.documentElement;
  root.style.visibility = 'hidden';                       // 查草稿那一下别让页面闪出来
  const n = await window.SGPrimary.countDrafts();
  if (!n) {
    try { localStorage.removeItem('sg.cfg'); } catch (e) { /* 隐私模式下读写会抛，不影响转走 */ }
    location.replace(t);
    return;
  }
  root.style.visibility = '';
  const tip = document.createElement('div');
  tip.setAttribute('role', 'status');
  tip.style.cssText = 'position:sticky;top:0;z-index:50;padding:10px 14px;background:#fff4e5;color:#7a3e00;font-size:14px;line-height:1.6';
  tip.textContent = `这个旧地址里还存着 ${n} 份没发完的草稿。把它们发布、或「⚙ → 导出备份」后，以后请用 ${window.SGPrimary.origin}（写作页和教程库都搬过去了）。`;
  const go = () => document.body.prepend(tip);
  document.body ? go() : addEventListener('DOMContentLoaded', go);
})();
