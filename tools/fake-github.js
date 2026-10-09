/* 页面内的「假 GitHub」：注入到每个页面，替换 window.fetch。
   验证脚本用它测发布、删除、目录合并、各种失败，**不碰真仓库、不联网**。
   用法：const { shim } = require('./fake-github.js'); await c.send('Page.addScriptToEvaluateOnNewDocument', { source: shim(ROOT_DIR) });
   行为开关都放在 localStorage 里（页面刷新后仍生效）：
     __ghMode   ok | 401 | 403 | hang | lost-once | slow
     __siteFail list.json 从「线上站点」读时：error | html | stale
     __notLive  1 = 新教程的 data.json 一直 404（模拟构建没好）
     __listExtra 数字：仓库里的 list.json 额外塞多少条假记录（测大目录） */
const fs = require('fs'), path = require('path');

function listFiles(dir, base = '') {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    if (n === '.git' || n === 'node_modules' || n === 'shots') continue;
    const p = path.join(dir, n), r = base ? base + '/' + n : n;
    if (fs.statSync(p).isDirectory()) out.push(...listFiles(p, r)); else out.push(r);
  }
  return out;
}

function shim(root) {
  const tree = listFiles(root).filter(p => !p.startsWith('tools/') && !p.startsWith('docs/'));
  let list = '[]';
  try { list = fs.readFileSync(path.join(root, 'list.json'), 'utf8'); } catch (e) { /* 没有就当空 */ }
  return `(() => {
  const FAKE_SITE = 'https://fake.github.io/Step-Guides/';
  const real = window.fetch.bind(window);
  const S = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const J = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
  const TREE0 = ${JSON.stringify(tree)};
  const LIST0 = ${JSON.stringify(list)};
  window.__gh = { blobs: [], trees: [], commits: 0, patches: 0, calls: [] };
  window.__nativeDialogs = [];
  window.alert = m => { __nativeDialogs.push('alert:' + m); };
  window.confirm = m => { __nativeDialogs.push('confirm:' + m); return S('__confirm') !== 'no'; };
  window.prompt = m => { __nativeDialogs.push('prompt:' + m); return null; };
  const repoList = () => {
    const n = +(S('__listExtra') || 0);
    if (!n) return LIST0;
    const arr = JSON.parse(LIST0);
    for (let i = 0; i < n; i++) arr.push({ id: 'zz' + String(i).padStart(6, '0'), title: '占位教程第' + i + '份', steps: 12, updated: '2026-10-01T00:00:00.000Z' });
    return JSON.stringify(arr, null, 1);
  };
  window.fetch = async (u, opt) => {
    opt = opt || {};
    const url = String(u && u.url ? u.url : u);
    const method = (opt.method || 'GET').toUpperCase();
    if (url.startsWith('https://api.github.com')) {
      const p = url.slice('https://api.github.com'.length);
      __gh.calls.push(method + ' ' + p);
      const mode = S('__ghMode') || 'ok';
      if (mode === '401') return J({ message: 'Bad credentials' }, 401);
      if (mode === '403') return J({ message: 'Resource not accessible by personal access token' }, 403);
      if (mode === 'hang') return new Promise((res, rej) => { if (opt.signal) opt.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      if (/\\/contents\\/list\\.json/.test(p)) {
        if (S('__repoListFail') === '1') return J({ message: 'Server Error' }, 502);
        if (S('__repoList404') === '1') return J({ message: 'Not Found' }, 404);
        return new Response(repoList(), { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (/\\/git\\/ref\\/heads\\//.test(p)) return J({ object: { sha: 'head' } });
      if (/\\/git\\/commits\\/head$/.test(p)) return J({ sha: 'head', tree: { sha: 'tree0' } });
      if (/\\/git\\/trees\\/tree0/.test(p)) return J({ sha: 'tree0', tree: TREE0.map(x => ({ path: x, type: 'blob' })) });
      if (/\\/git\\/blobs$/.test(p)) { __gh.blobs.push(JSON.parse(opt.body)); return J({ sha: 'blob' + __gh.blobs.length }); }
      if (/\\/git\\/trees$/.test(p)) { __gh.trees.push(JSON.parse(opt.body)); return J({ sha: 'tree' + __gh.trees.length }); }
      if (/\\/git\\/commits$/.test(p)) { __gh.commits++; return J({ sha: 'c' + __gh.commits }); }
      if (/\\/git\\/refs\\/heads\\//.test(p)) {
        __gh.patches++;
        if (mode === 'lost-once' && __gh.patches === 1) throw new TypeError('Failed to fetch');
        if (mode === 'slow') await new Promise(r => setTimeout(r, 5000));
        return J({ object: { sha: 'c' + __gh.commits } });
      }
      return J({});
    }
    if (url.startsWith(FAKE_SITE)) {
      const rest = url.slice(FAKE_SITE.length), p = rest.split('?')[0];
      const fail = S('__siteFail') || '';
      if (p === 'list.json' && fail === 'error') throw new TypeError('Failed to fetch');
      if (p === 'list.json' && fail === 'html') return new Response('<html>502</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (p === 'list.json' && fail === 'stale') return J([]);
      const r = await real(location.origin + '/' + rest, opt);
      if (r.status === 404 && /data\\.json$/.test(p) && S('__notLive') !== '1') {
        // 新教程「构建好了」：回显刚提交的 data.json（带上本次的发布标记）
        const blobs = __gh.blobs.map(b => { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b.content), c => c.charCodeAt(0)))); } catch (e) { return null; } });
        const last = blobs.reverse().find(x => x && x.steps);
        return J(last || { live: 1 });
      }
      return r;
    }
    return real(u, opt);
  };
})();`;
}

/** 把提交里的 blob 解成文本（图片会是乱码，只用来找 JSON/HTML） */
const decodeBlobs = c => c.ev(`JSON.stringify(__gh.blobs.map(b => { try { const s = new TextDecoder().decode(Uint8Array.from(atob(b.content), ch => ch.charCodeAt(0))); return s.length < 400000 ? s : '(大文件 ' + s.length + ')'; } catch (e) { return 'ERR'; } }))`);

module.exports = { shim, decodeBlobs };
