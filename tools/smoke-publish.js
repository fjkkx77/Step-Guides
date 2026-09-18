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

  const before = execSync(`gh api repos/${OWNER}/${REPO}/commits --jq "length"`, { encoding: 'utf8' }).trim();

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

  const after = execSync(`gh api repos/${OWNER}/${REPO}/commits --jq "length"`, { encoding: 'utf8' }).trim();
  console.log(`commit 数 ${before} -> ${after}（2 个文件应该只多 1 个 commit）：`,
              (+after === +before + 1) ? 'PASS' : 'FAIL');
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
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
