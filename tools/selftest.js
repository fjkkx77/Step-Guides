/* 在无头浏览器里跑 tests/selftest.html，把结果打到终端
   用法：node tools/selftest.js */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;

(async () => {
  const c = await open(420, 900, 1);
  await c.goto(`http://127.0.0.1:${PORT}/tests/selftest.html`);
  let res = null;
  for (let i = 0; i < 30 && !res; i++) {
    await sleep(400);
    res = await c.ev('window.__results ? JSON.stringify(window.__results) : null');
  }
  await c.close();
  if (!res) { console.error('自检页没有产出结果（脚本报错了？）'); process.exit(1); }
  const list = JSON.parse(res);
  list.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  const bad = list.filter(r => !r.ok).length;
  console.log(bad ? `\n${list.length} 条里有 ${bad} 条没过` : `\n全部 ${list.length} 条通过`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
