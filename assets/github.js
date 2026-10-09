/* 用 GitHub Git Data API 把一个教程一次性提交上去。
   为什么不用更简单的 Contents API：它一次只能写一个文件，12 张图要发 14 次请求，
   中途断网就会在仓库里留下半个教程。Git Data API 的最后一步（更新 ref）是原子的，
   要么整份教程上线，要么仓库完全没变。 */
(() => {
  'use strict';

  const API = 'https://api.github.com';

  /** 8 位随机 id，去掉 0/o/1/l/I 这些看串行的字符（要念给人听、手打的场合不受罪） */
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  function randomId(len = 8) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    let s = '';
    for (const b of buf) s += ALPHABET[b % ALPHABET.length];
    return s;
  }
  /** 教程编号只认这个形状。地址里的 ?edit=、目录里的 id 都要先过它（审查 P1-4：
      不检查的话，构造过的「编号」会被拼进页面执行脚本、读走 token） */
  const isId = s => typeof s === 'string' && s.length === 8 && [...s].every(ch => ALPHABET.includes(ch));

  /** 字符串 → UTF-8 → base64。分块转换：一次把十几万个字节展开成参数，
      Chrome 会抛 RangeError（审查 P2-8：目录约 900 份时发布全部失败） */
  function b64(str) {
    const buf = new TextEncoder().encode(str);
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /** 把 [{path,sha}] 组装成 GitHub 要的 tree 数组；sha 为 null 表示删除这个文件 */
  function buildTree(files) {
    return files.map(f => ({
      path: String(f.path).replace(/^\/+/, ''),
      mode: '100644',
      type: 'blob',
      sha: f.sha === null ? null : f.sha
    }));
  }

  /** 每个请求都有超时（审查 P2-4：以前网络卡住会一直转），也能被外面的「取消」打断 */
  async function api(path, { token, method = 'GET', body, raw = false, timeout = 30000, signal } = {}) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort); }
    let r;
    try {
      r = await fetch(API + path, {
        method,
        // GitHub 的响应带 Cache-Control: private, max-age=60。不关掉的话，
        // 「读分支当前指向哪个提交」会吃到最多 60 秒前的旧值：
        // 表现为发布完立刻再发一次就 422 not a fast forward，连重试都读到同一个旧 SHA。
        cache: 'no-store',
        signal: ctrl.signal,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) {
        let msg = '';
        try { msg = (await r.json()).message || ''; } catch (e) { /* 空响应 */ }
        const err = new Error(`${method} ${path} 失败：HTTP ${r.status}${msg ? ' ' + msg : ''}`);
        err.status = r.status;
        err.step = path;
        throw err;
      }
      if (raw) return r.text();
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error(timedOut ? `${method} ${path} 等了 ${Math.round(timeout / 1000)} 秒没有回应` : '已取消');
        err.name = 'AbortError';
        err.timeout = timedOut;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /** 读仓库某个提交里的 list.json（教程目录）。仓库里还没有这个文件 = 空目录；
      别的失败一律往外抛——绝不能把「这次没读到」当成「空目录」再整份写回（审查 P1-2） */
  async function readIndex(o, ref) {
    let text;
    try {
      text = await api(`/repos/${o.owner}/${o.repo}/contents/list.json?ref=${encodeURIComponent(ref)}`,
                       { token: o.token, raw: true, signal: o.signal });
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
    let list;
    try { list = JSON.parse(text); } catch (e) { list = null; }
    if (!Array.isArray(list)) throw new Error('仓库里的 list.json 读出来不是教程列表，先别发布，找我看一下');
    return list;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /**
   * 发布：blobs -> tree -> commit -> 更新 ref，一次提交。
   * @param {object} o
   * @param {string} o.token  fine-grained PAT（只需本仓库 Contents 读写）
   * @param {string} o.owner
   * @param {string} o.repo
   * @param {string} [o.branch=main]
   * @param {Array<{path:string,content?:string,encoding?:string,sha?:null}>} o.files
   *        content 为 base64 字符串；传 {path, sha:null} 表示删除该文件
   * @param {(list:Array)=>Array} [o.index]  改目录：拿到仓库**当前版本**的 list.json，返回新的。
   *        每次换基重试都会重新读、重新算，两台设备先后发布也不会互相冲掉
   * @param {string} o.message
   * @param {AbortSignal} [o.signal]  「取消」
   * @param {(s:{phase:string,done:number,total:number})=>void} [o.onProgress]
   */
  async function publish(o) {
    const { token, owner, repo, files, message, signal } = o;
    const branch = o.branch || 'main';
    const base = `/repos/${owner}/${repo}`;
    const report = p => o.onProgress && o.onProgress(p);
    const call = (path, opt = {}) => api(path, { token, signal, ...opt });

    // 1) 先把内容传成 blob。blob 是按内容寻址的，跟分支走到哪儿无关，
    //    所以只传一次；后面换基重试时可以直接复用，不用重传十几张图
    const uploads = files.filter(f => f.sha !== null);
    // GitHub 对「创建内容」的请求有每分钟 80 个的限制（官方文档 rate limits 一节）。
    // 图特别多时放慢一点，宁可多等十几秒，也别发到一半被拒（审查 P3-13）
    const pace = uploads.length > 60 ? 800 : 0;
    const blobs = [];
    let n = 0;
    for (const f of uploads) {
      report({ phase: '上传文件', done: n, total: uploads.length });
      if (pace && n) await sleep(pace);
      const blob = await call(`${base}/git/blobs`, {
        method: 'POST', timeout: 120000,               // 大图在慢网上传得久
        body: { content: f.content, encoding: f.encoding || 'base64' }
      });
      blobs.push({ path: f.path, sha: blob.sha });
      n++;
    }
    const dels = files.filter(f => f.sha === null);

    // 2) 组 tree → 提交 → 移动分支指针。
    //    最后一步可能撞上"读 ref 之后 HEAD 又被推进了"（另一台设备发布、
    //    或上一次发布刚落地），GitHub 回 422 not a fast forward。
    //    这种情况换成新的 base 再来一轮就行，不必让用户重发一遍。
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      report({ phase: attempt ? '分支被别人推进了，换个基准重来' : '组装提交', done: 0, total: 1 });
      const ref = await call(`${base}/git/ref/heads/${branch}`);
      const headSha = ref.object.sha;
      const headCommit = await call(`${base}/git/commits/${headSha}`);

      const entries = blobs.slice();

      // 目录：从这一轮的基准提交里读，改完再传（每轮都重新读，不复用上一轮的）
      if (o.index) {
        const next = o.index(await readIndex(o, headSha));
        const lb = await call(`${base}/git/blobs`, {
          method: 'POST', body: { content: b64(JSON.stringify(next, null, 1)), encoding: 'base64' }
        });
        entries.push({ path: 'list.json', sha: lb.sha });
      }

      // 删除：只删「当前 tree 里确实有」的路径。删一个不存在的路径会让整棵 tree
      // 创建失败（422 GitRPC::BadObjectState），连带整份教程发不出去
      if (dels.length) {
        let have = new Set();
        try {
          const tree = await call(`${base}/git/trees/${headCommit.tree.sha}?recursive=1`);
          have = new Set((tree.tree || []).map(x => x.path));
        } catch (e) { if (e.name === 'AbortError') throw e; /* 读不到就这轮不删，下次编辑时再收拾 */ }
        for (const f of dels) {
          const path = String(f.path).replace(/^\/+/, '');
          if (have.has(path)) entries.push({ path, sha: null });
        }
      }

      // 一个都不剩＝这次没有任何实际改动。空 tree 交上去会回 422 Invalid tree info
      if (!entries.length) return { commit: headSha, count: 0, noop: true };

      const tree = await call(`${base}/git/trees`, {
        method: 'POST', body: { base_tree: headCommit.tree.sha, tree: buildTree(entries) }
      });
      const commit = await call(`${base}/git/commits`, {
        method: 'POST', body: { message, tree: tree.sha, parents: [headSha] }
      });

      try {
        report({ phase: '提交', done: 0, total: 1 });
        // force 永远为 false：宁可重试，也不能把别人的提交冲掉
        await call(`${base}/git/refs/heads/${branch}`, {
          method: 'PATCH', body: { sha: commit.sha, force: false }
        });
        return { commit: commit.sha, count: uploads.length, retried: attempt > 0 };
      } catch (e) {
        lastErr = e;
        if (attempt === 0 && e.status === 422) { await sleep(800); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  /** 等线上真的换成这次的内容：轮询到 200 **而且** check 通过才算成功。
      check 用来认「是不是这一次」：改已发布的教程时，旧的 data.json 本来就能打开（审查 P2-2）。
      被取消时返回 false（提交已经生效，只是不等了） */
  async function waitLive(url, { timeout = 180000, interval = 4000, onTick, check, signal } = {}) {
    const t0 = Date.now();
    let tries = 0;
    while (Date.now() - t0 < timeout) {
      if (signal && signal.aborted) return false;
      tries++;
      onTick && onTick({ tries, seconds: Math.round((Date.now() - t0) / 1000) });
      try {
        const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { cache: 'no-store' });
        if (r.ok && (!check || check(await r.json()))) return true;
      } catch (e) { /* 构建中，继续等 */ }
      await sleep(interval);
    }
    return false;
  }

  /** 列出仓库里某个目录下的所有文件路径。
      删除教程时必须用它，而不是靠读 data.json 推断有哪些图片 ——
      data.json 万一读不到（网络、缓存、跨环境），图片就会被漏在仓库里变成孤儿。
      仓库的 tree 才是权威来源。 */
  async function listTree(o) {
    const base = `/repos/${o.owner}/${o.repo}`;
    const ref = await api(`${base}/git/ref/heads/${o.branch || 'main'}`, { token: o.token });
    const commit = await api(`${base}/git/commits/${ref.object.sha}`, { token: o.token });
    const tree = await api(`${base}/git/trees/${commit.tree.sha}?recursive=1`, { token: o.token });
    const pre = String(o.prefix || '').replace(/^\/+/, '');
    return (tree.tree || [])
      .filter(x => x.type === 'blob' && (!pre || x.path === pre || x.path.startsWith(pre)))
      .map(x => x.path);
  }

  /** 读一个文件的当前内容（编辑已发布的教程时用） */
  async function getJson(url) {
    const r = await fetch(url + '?cb=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('读取失败 HTTP ' + r.status);
    return r.json();
  }

  /** 把发布/删除时的报错翻成「出了什么事、下一步做什么」（审查 P2-3：以前原样显示英文接口信息，
      token 过期了还建议去挂代理）。原始信息附在最后一行，方便找我查 */
  function explain(err) {
    const s = err && err.status;
    let say;
    if (err && err.name === 'AbortError') {
      say = err.timeout ? '网络太慢，等了很久没有回应，已经停下了。换个网络（或挂上代理）再点重试。' : '已取消。';
    } else if (s === 401) {
      say = 'GitHub 不认这个 token：多半是过期了（建的时候选过有效期），也可能填错了。\n' +
            '去 GitHub 重新建一个（步骤见 README「第一次使用：建一个 token」），再到写作页右上角 ⚙ 里换上。';
    } else if (s === 403) {
      say = '这个 token 没有往仓库里写东西的权限：建 token 时要选中这个仓库，并把 Contents 设成 Read and write。' +
            '\n（也可能是一下子发得太多被 GitHub 限流了，过几分钟再试。）';
    } else if (s === 404) {
      say = '找不到仓库或分支：看看 ⚙ 里的 GitHub 用户名、仓库名、分支有没有填错；token 没选中这个仓库时也会这样。';
    } else if (s === 409 || s === 422) {
      say = '仓库那边刚被改过，没对上。点重试一般就好。';
    } else if (s >= 500) {
      say = `GitHub 那边出错了（HTTP ${s}），过一会儿再点重试。`;
    } else if (!s && err && err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message || '')) {
      // 只有真的是「请求没发出去/没回来」才说网络（code-review：以前压缩图片失败、目录坏了也被说成网络问题）
      say = '连不上 GitHub。手机网络打不开 api.github.com 时，挂上代理或换个网络再点重试。';
    } else if (!s) {
      say = '出错了，不是网络问题，换网络也没用。把下面的「详细信息」截图发给我看看。';
    } else {
      say = '没成功。';
    }
    return say + '\n\n详细信息：' + ((err && err.message) || String(err));
  }

  window.SGGitHub = { randomId, isId, b64, buildTree, publish, waitLive, getJson, listTree, readIndex, explain, api };
})();
