/* 冒烟测试：在真实浏览器里用 assets/github.js 往仓库发一次，再删掉。
   验的是三件事：① API 调用序列对不对 ② 浏览器能不能跨域调 api.github.com
   ③ 是不是只产生一个 commit（原子性）。token 从本机 gh 取，不打印。 */
const { open, sleep } = require('./cdp.js');
const { execSync } = require('child_process');
const PORT = 8879;
const OWNER = 'fjkkx77', REPO = 'Step-Guides';

(async () => {
  const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
  if (!token) throw new Error('取不到 gh token');

  const c = await open(420, 900, 1);
  await c.goto(`http://127.0.0.1:${PORT}/tests/selftest.html`);   // 这页已经引了 github.js

  // 用 HEAD 的 SHA 判原子性，别数 commits 的条数：那个接口默认每页 30 条，
  // 仓库一过 30 个提交，"length" 就恒等于 30，断言永远失真（我自己踩的）
  const headOf = () => execSync(`gh api repos/${OWNER}/${REPO}/git/ref/heads/main --jq ".object.sha"`,
                                { encoding: 'utf8' }).trim();
  const before = headOf();

  const r = await c.ev(`(async () => {
    const { publish } = window.SGGitHub;
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    try {
      const res = await publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [
          { path: 't/_smoke/a.txt', content: b64('hello ' + Date.now()) },
          { path: 't/_smoke/b.txt', content: b64('two files, one commit') }
        ],
        message: '冒烟测试：验证浏览器端原子发布'
      });
      return JSON.stringify({ ok: true, ...res });
    } catch (e) { return JSON.stringify({ ok: false, err: e.message }); }
  })()`);
  await c.close();

  const out = JSON.parse(r);
  console.log('浏览器端发布：', out.ok ? 'PASS commit=' + out.commit.slice(0, 7) + ' 文件数=' + out.count : 'FAIL ' + out.err);
  if (!out.ok) process.exit(1);

  const after = headOf();
  const parent = execSync(`gh api repos/${OWNER}/${REPO}/commits/${after} --jq ".parents[0].sha"`,
                          { encoding: 'utf8' }).trim();
  console.log('2 个文件只产生 1 个 commit（新 HEAD 的父提交＝发布前的 HEAD）：',
              (after !== before && parent === before) ? 'PASS'
              : `FAIL ${before.slice(0,7)} -> ${after.slice(0,7)}（父 ${parent.slice(0,7)}）`);
  const files = execSync(`gh api repos/${OWNER}/${REPO}/contents/t/_smoke --jq "length"`, { encoding: 'utf8' }).trim();
  console.log('两个文件都在仓库里：', files === '2' ? 'PASS' : 'FAIL 实际 ' + files);

  // 顺便验删除路径（sha:null），并把测试文件清理干净——测试不留痕
  const c2 = await open(420, 900, 1);
  await c2.goto(`http://127.0.0.1:${PORT}/tests/selftest.html`);
  const r2 = await c2.ev(`(async () => {
    try {
      const res = await window.SGGitHub.publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [{ path: 't/_smoke/a.txt', sha: null }, { path: 't/_smoke/b.txt', sha: null }],
        message: '冒烟测试：清理'
      });
      return JSON.stringify({ ok: true, ...res });
    } catch (e) { return JSON.stringify({ ok: false, err: e.message }); }
  })()`);
  await c2.close();
  const del = JSON.parse(r2);
  console.log('删除路径（sha:null）：', del.ok ? 'PASS' : 'FAIL ' + del.err);
  let gone = false;
  try { execSync(`gh api repos/${OWNER}/${REPO}/contents/t/_smoke`, { stdio: 'pipe' }); }
  catch (e) { gone = true; }
  console.log('测试文件已清理干净：', gone ? 'PASS' : 'FAIL 仓库里还有 t/_smoke');

  // 混进一条「删除一个根本不存在的路径」：不该把整份发布搞垮
  // （真实场景：编辑教程换图时带的那条"删旧图"指令，路径对不上就 422 BadObjectState）
  const c3 = await open(420, 900, 1);
  await c3.goto(`http://127.0.0.1:${PORT}/tests/selftest.html`);
  const r3 = await c3.ev(`(async () => {
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    try {
      const res = await window.SGGitHub.publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [
          { path: 't/_smoke/c.txt', content: b64('存在的文件') },
          { path: 't/_smoke/根本没有这个文件.txt', sha: null }
        ],
        message: '冒烟测试：删不存在的路径不该炸'
      });
      return JSON.stringify({ ok: true, commit: res.commit });
    } catch (e) { return JSON.stringify({ ok: false, err: e.message }); }
  })()`);
  const mix = JSON.parse(r3);
  console.log('删不存在的路径不会搞垮发布：', mix.ok ? 'PASS' : 'FAIL ' + mix.err);

  // 空改动（要删的都不存在）不该报错，应该原地收工
  const r4 = await c3.ev(`(async () => {
    try {
      const res = await window.SGGitHub.publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [{ path: 't/_smoke/也不存在.txt', sha: null }], message: '冒烟：空改动'
      });
      return JSON.stringify({ ok: true, noop: !!res.noop });
    } catch (e) { return JSON.stringify({ ok: false, err: e.message }); }
  })()`);
  const nz = JSON.parse(r4);
  console.log('空改动不报错、原地收工：', nz.ok && nz.noop ? 'PASS' : 'FAIL ' + (nz.err || '没标成 noop'));

  // 清掉刚才那个 c.txt（稍等一下，避开 GitHub 刚写完 ref 读到旧值的那几百毫秒）
  if (mix.ok) {
    await new Promise(r => setTimeout(r, 2500));
    const r5 = await c3.ev(`(async () => { try {
      await window.SGGitHub.publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [{ path: 't/_smoke/c.txt', sha: null }], message: '冒烟测试：清理' });
      return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()`);
    if (r5 !== 'ok') console.log('清理没成功：', r5);
  }
  await c3.close();
  let gone2 = false;
  try { execSync(`gh api repos/${OWNER}/${REPO}/contents/t/_smoke`, { stdio: 'pipe' }); }
  catch (e) { gone2 = true; }
  console.log('第二轮也清理干净：', gone2 ? 'PASS' : 'FAIL');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
