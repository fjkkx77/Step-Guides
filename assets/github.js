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

  /** 把 [{path,sha}] 组装成 GitHub 要的 tree 数组；sha 为 null 表示删除这个文件 */
  function buildTree(files) {
    return files.map(f => ({
      path: String(f.path).replace(/^\/+/, ''),
      mode: '100644',
      type: 'blob',
      sha: f.sha === null ? null : f.sha
    }));
  }

  async function api(path, { token, method = 'GET', body } = {}) {
    const r = await fetch(API + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
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
    return r.status === 204 ? null : r.json();
  }

  /**
   * 发布：blobs -> tree -> commit -> 更新 ref，一次提交。
   * @param {object} o
   * @param {string} o.token  fine-grained PAT（只需本仓库 Contents 读写）
   * @param {string} o.owner
   * @param {string} o.repo
   * @param {string} [o.branch=main]
   * @param {Array<{path:string,content?:string,encoding?:string,sha?:null}>} o.files
   *        content 为 base64 字符串；传 {path, sha:null} 表示删除该文件
   * @param {string} o.message
   * @param {(s:{phase:string,done:number,total:number})=>void} [o.onProgress]
   */
  async function publish(o) {
    const { token, owner, repo, files, message } = o;
    const branch = o.branch || 'main';
    const base = `/repos/${owner}/${repo}`;
    const report = p => o.onProgress && o.onProgress(p);

    report({ phase: '读取分支', done: 0, total: 1 });
    const ref = await api(`${base}/git/ref/heads/${branch}`, { token });
    const headSha = ref.object.sha;
    const headCommit = await api(`${base}/git/commits/${headSha}`, { token });

    // 1) 每个文件传成 blob
    const entries = [];
    const uploads = files.filter(f => f.sha !== null);
    let n = 0;
    for (const f of uploads) {
      report({ phase: '上传文件', done: n, total: uploads.length });
      const blob = await api(`${base}/git/blobs`, {
        token, method: 'POST',
        body: { content: f.content, encoding: f.encoding || 'base64' }
      });
      entries.push({ path: f.path, sha: blob.sha });
      n++;
    }
    for (const f of files.filter(x => x.sha === null)) entries.push({ path: f.path, sha: null });

    // 2) 组 tree（base_tree = 当前，等于「在现有仓库上改这几个文件」）
    report({ phase: '组装提交', done: 0, total: 1 });
    const tree = await api(`${base}/git/trees`, {
      token, method: 'POST',
      body: { base_tree: headCommit.tree.sha, tree: buildTree(entries) }
    });

    // 3) 提交
    const commit = await api(`${base}/git/commits`, {
      token, method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha] }
    });

    // 4) 移动分支指针——到这一步才算真的上去了，前面失败仓库不受影响
    report({ phase: '提交', done: 0, total: 1 });
    await api(`${base}/git/refs/heads/${branch}`, {
      token, method: 'PATCH', body: { sha: commit.sha, force: false }
    });

    return { commit: commit.sha, count: uploads.length };
  }

  /** 等 Pages 真的构建好：轮询到 200 才算成功（推上去 ≠ 线上能打开） */
  async function waitLive(url, { timeout = 180000, interval = 4000, onTick } = {}) {
    const t0 = Date.now();
    let tries = 0;
    while (Date.now() - t0 < timeout) {
      tries++;
      onTick && onTick({ tries, seconds: Math.round((Date.now() - t0) / 1000) });
      try {
        const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(),
                              { cache: 'no-store' });
        if (r.ok) return true;
      } catch (e) { /* 构建中，继续等 */ }
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  /** 读一个文件的当前内容（编辑已发布的教程时用） */
  async function getJson(url) {
    const r = await fetch(url + '?cb=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('读取失败 HTTP ' + r.status);
    return r.json();
  }

  window.SGGitHub = { randomId, buildTree, publish, waitLive, getJson, api };
})();
