/* 2026-10-17 电脑版式回归：用户看了对比图，选「电脑上恢复改版前的通栏布局」（手机保持新版式）。
   改版那次只按手机设计，电脑上文字收进 640px、长文整列收进 760px、长文截图贴左——用户：「很窄、很拧巴很挤、浪费大屏」。
   ① 电脑（1280/1707）逐步模式：截图在上、文字卡片在下；文字卡片铺满内容区（不是窄的一栏）；底栏两个按钮等宽
   ② 电脑长文模式：每步一张通栏卡片（左右各留 12px）、截图在卡片里水平居中、文字在截图下面
   ③ 手机（390）不受影响：文字仍在截图上面，长文仍是时间轴
   ④ 电脑版式只认「宽 ≥900 + 有鼠标」：鼠标 899 宽是手机版式、900 宽是电脑版式；横屏手机（932×430 触屏）仍是手机版式
   ⑤ 矮的电脑窗口（1280×650）：卡片里标题仍是 22px（矮屏那几条规则不能把它顶回 24px）
   ⚠ cdp.js 默认开触摸模拟（媒体查询报 pointer:coarse），测电脑时要关掉，否则拿到的是手机版式
   每档都查无横向溢出。
   用法：node tools/verify-desktop.js [--base=https://jc.wbztl.xyz]（默认本地 8879，由 run-all 起服务） */
const { open, sleep } = require('./cdp.js');
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const ROOT = BASE ? BASE.replace(/\/$/, '') : 'http://127.0.0.1:8879';
const T = ROOT + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const J = async (c, expr) => JSON.parse(await c.ev(`JSON.stringify(${expr})`));

async function enter(c, mode) {
  await c.goto(T);
  await c.ev(`localStorage.clear();localStorage.setItem('sg.readMode','${mode}');1`);
  await c.goto(T);
  await sleep(800);
  await c.ev(`(() => { const b = document.querySelector('.pv.cover .pv-go'); if (b) b.click(); })(), 1`);
  await sleep(600);
}
const GEO = `(() => {
  const p = document.querySelector('.page[data-i="0"]'), R = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
  const pr = R(p), cs = getComputedStyle(p);
  const content = { l: pr.l + parseFloat(cs.paddingLeft), r: pr.r - parseFloat(cs.paddingRight) };
  const prev = document.getElementById('prev'), next = document.getElementById('next');
  return { page: pr, content, say: R(p.querySelector('.say .h')), sayBox: R(p.querySelector('.say')), img: R(p.querySelector('.shot img')),
    prevW: prev ? prev.getBoundingClientRect().width : 0, nextW: next ? next.getBoundingClientRect().width : 0,
    timeline: getComputedStyle(p, '::before').display !== 'none' && getComputedStyle(p, '::before').content !== 'none',
    sw: document.documentElement.scrollWidth, vw: innerWidth };
})()`;

/** 开一个「电脑」：关掉触摸模拟，媒体查询才报 any-hover:hover + any-pointer:fine */
async function openDesk(w, h) {
  const c = await open(w, h, 1);
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  return c;
}

async function desk(w, h) {
  const L = `${w}×${h}`;
  const c = await openDesk(w, h);
  try {
    chk(`${L} 前提：这是有鼠标的电脑（any-hover:hover + any-pointer:fine）`, await c.ev(`matchMedia('(any-hover:hover) and (any-pointer:fine)').matches`));
    await enter(c, 'step');
    let g = await J(c, GEO);
    chk(`${L} 逐步：截图在上、文字卡片在下`, g.img.b <= g.sayBox.t + 1, `图底 ${Math.round(g.img.b)} / 文字顶 ${Math.round(g.sayBox.t)}`);
    const cw = g.content.r - g.content.l;
    chk(`${L} 逐步：文字卡片铺满内容区（不是窄的一栏）`, g.sayBox.w >= cw - 2, `卡片 ${Math.round(g.sayBox.w)} / 内容区 ${Math.round(cw)}`);
    chk(`${L} 逐步：底栏「上一步」「下一步」等宽、铺满`, Math.abs(g.prevW - g.nextW) <= 2 && g.nextW > w * 0.3, `${Math.round(g.prevW)} / ${Math.round(g.nextW)}`);
    chk(`${L} 逐步：无横向溢出`, g.sw <= w, `${g.sw}/${w}`);
    const h2 = await c.ev(`getComputedStyle(document.querySelector('.page[data-i="0"] .say h2')).fontSize`);
    chk(`${L} 逐步：卡片里标题 22px`, h2 === '22px', h2);
    // 正文很长时：卡片里能展开（高度超过 34vh 的收起上限）、「更多」的渐隐跟卡片同色
    // 异步要在页面里先 await 再自己序列化（J() 会把 Promise 直接 stringify 成 {}）
    const ex = JSON.parse(await c.ev(`(async () => {
      const s = document.querySelector('.page[data-i="0"] .say'), q = s.querySelector('.txt p');
      q.textContent = q.textContent.repeat(40); dispatchEvent(new Event('resize'));
      await new Promise(r => setTimeout(r, 400));
      const can = s.classList.contains('can-open'), h0 = s.getBoundingClientRect().height;
      const more = getComputedStyle(s.querySelector('.more')).backgroundImage, card = getComputedStyle(s).backgroundColor;
      s.click(); await new Promise(r => setTimeout(r, 600));
      return JSON.stringify({ can, h0: Math.round(h0), h1: Math.round(s.getBoundingClientRect().height), cap: Math.round(innerHeight * .34), fadeToCard: more.includes(card) });
    })()`));
    chk(`${L} 逐步：长正文在卡片里能展开、「更多」渐隐跟卡片同色`, ex.can && ex.h1 > ex.cap && ex.h1 > ex.h0 && ex.fadeToCard, JSON.stringify(ex));

    await enter(c, 'long');
    g = await J(c, GEO);
    chk(`${L} 长文：每步是通栏卡片（左右各留约 12px）`, g.page.l <= 13 && g.page.r >= w - 13 - 15, `卡片 ${Math.round(g.page.l)}~${Math.round(g.page.r)}（视口 ${g.vw}）`);
    const pc = (g.page.l + g.page.r) / 2, ic = (g.img.l + g.img.r) / 2;
    chk(`${L} 长文：截图在卡片里水平居中`, Math.abs(pc - ic) <= 2, `卡片中线 ${Math.round(pc)} / 图中线 ${Math.round(ic)}`);
    chk(`${L} 长文：文字在截图下面`, g.img.b <= g.say.t + 1, `图底 ${Math.round(g.img.b)} / 标题顶 ${Math.round(g.say.t)}`);
    chk(`${L} 长文：电脑上没有时间轴竖线`, !g.timeline);
    chk(`${L} 长文：无横向溢出`, g.sw <= w, `${g.sw}/${w}`);
  } finally { c.close(); }
}

/** 手机版式（文字在截图上面、长文有时间轴）。mouse=true 时关掉触摸模拟（测「鼠标但不够宽」） */
async function phone(w, h, mouse, narrowCol) {
  const L = `${w}×${h}${mouse ? '（鼠标）' : '（触屏）'}`;
  const c = mouse ? await openDesk(w, h) : await open(w, h, 2);
  try {
    await enter(c, 'step');
    let g = await J(c, GEO);
    chk(`${L} 逐步：手机版式，文字在截图上面`, g.sayBox.b <= g.img.t + 1, `文字底 ${Math.round(g.sayBox.b)} / 图顶 ${Math.round(g.img.t)}`);
    // 触屏宽屏（横屏手机、iPad）维持改动前的样子：文字仍收在居中的 640px 一栏
    if (narrowCol) chk(`${L} 逐步：触屏宽屏文字栏仍是居中的 640px（跟改动前一样）`, Math.round(g.sayBox.w) === 640, `${Math.round(g.sayBox.w)}px`);
    await enter(c, 'long');
    g = await J(c, GEO);
    chk(`${L} 长文：手机版式，标题在截图上面、有时间轴`, g.say.b <= g.img.t + 1 && g.timeline, JSON.stringify({ t: g.timeline }));
  } finally { c.close(); }
}

(async () => {
  for (const [w, h] of [[900, 700], [1280, 720], [1280, 650], [1707, 873]]) await desk(w, h);
  await phone(390, 844);
  await phone(932, 430, false, true);    // 横屏手机：够宽但是触屏，仍是手机版式
  await phone(1024, 1366, false, true);  // 竖屏 iPad
  await phone(899, 800, true);    // 有鼠标但不够宽
  console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
