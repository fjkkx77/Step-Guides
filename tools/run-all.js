/* 一条命令跑全部本地测试（建议 O-5）。全部在本机跑：自己起静态服务，发布相关的用假 GitHub，不碰真仓库、不联网。
   用法：node tools/run-all.js
   不在这里的两个（会往真仓库写东西，要真测时自己单独跑，并加 --real）：
     smoke-publish.js   真发一份再删掉
     verify-delete.js   真造一份再从教程库删掉
   摄像头：没有任何一个测试会去开摄像头（verify-scan 是把静态二维码图片喂给解码函数）。 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8879;   // 老测试脚本写死了这个端口
const SUITE = [
  'selftest', 'verify-audit', 'verify', 'verify-writer', 'verify-editor', 'verify-gestures', 'verify-steps',
  'verify-long', 'verify-moveto', 'verify-title', 'verify-more', 'verify-zoom', 'verify-zoom-feel', 'verify-zoom-smooth',
  'verify-paste', 'verify-img', 'verify-reader-nav', 'verify-immersion', 'verify-cover', 'verify-dblclick', 'verify-qr', 'verify-scan'
];

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock.js'), ROOT, String(PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const bad = [];
  try {
    // --skip=a,b：跳过某几组（比如 verify-audit 单独跑过了；一次全跑要十几分钟）
    const skip = ((process.argv.find(a => a.startsWith('--skip=')) || '').split('=')[1] || '').split(',').filter(Boolean);
    for (const name of SUITE) {
      if (skip.includes(name)) { console.log(`SKIP ${name}`); continue; }
      const args = [path.join(__dirname, name + '.js')];
      if (name === 'verify-nav') args.push(`http://127.0.0.1:${PORT}/`);
      const t0 = Date.now();
      const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
      const out = (r.stdout || '') + (r.stderr || '');
      const fails = out.split(/\r?\n/).filter(l => /^FAIL|^✗|未通过/.test(l));
      const ok = r.status === 0;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}（${Math.round((Date.now() - t0) / 1000)} 秒）${ok ? '' : '\n    ' + (fails.slice(0, 6).join('\n    ') || out.slice(-400))}`);
      if (!ok) bad.push(name);
    }
    // verify-nav 默认测线上，这里给它本地地址
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, 'verify-nav.js'), `http://127.0.0.1:${PORT}/`], { cwd: ROOT, encoding: 'utf8' });
    console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} verify-nav（${Math.round((Date.now() - t0) / 1000)} 秒）`);
    if (r.status !== 0) bad.push('verify-nav');
  } finally { try { srv.kill(); } catch (e) {} }
  console.log(bad.length ? `\n${bad.length} 组没通过：${bad.join('、')}` : '\n全部通过');
  process.exit(bad.length ? 1 : 0);
})();
