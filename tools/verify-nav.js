/* 返回/主页键线上复核：每个场景一个干净浏览器。
   等待条件必须是「处理函数真的绑上了」——window.SGWriter 是在 boot() 之前就挂的，
   拿它当就绪信号会在按钮还没绑事件时就点下去，点了等于没点（踩过） */
const { open, sleep } = require('./cdp.js');
// 默认验线上；也可以传本地地址：node tools/verify-nav.js http://127.0.0.1:8879/
const SITE = process.argv[2] || 'https://jc.wbztl.xyz/';
const until = async (c, expr, n = 60) => {
  for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; }
  return false;
};

async function scenario(from, enter, btn) {
  const c = await open(1100, 800, 1);
  try {
    await c.goto(SITE + from);
    await until(c, `!!document.querySelector(${JSON.stringify(enter)})`);
    await c.ev(`document.querySelector(${JSON.stringify(enter)}).click()`);
    const bound = await until(c, `(() => { const b = document.getElementById(${JSON.stringify(btn)});
      return !!(b && b.onclick); })()`);
    if (!bound) return '（按钮一直没绑上事件）';
    await c.ev(`document.getElementById(${JSON.stringify(btn)}).click()`);
    await until(c, "location.pathname.indexOf('/w/') < 0");
    return await c.ev('location.pathname');
  } finally { await c.close(); }
}

(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };

  const a = await scenario('', 'a[href="w/"]', 'btn-back');
  chk('从首页进 → 返回回首页', a === '/', '落在 ' + a);

  const b = await scenario('mine/', '#btn-new', 'btn-back');
  chk('从教程库进 → 返回回教程库', b.indexOf('/mine/') >= 0, '落在 ' + b);

  const d = await scenario('mine/', '#btn-new', 'btn-home2');
  chk('主页键 → 不管从哪来都回首页', d === '/', '落在 ' + d);

  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
