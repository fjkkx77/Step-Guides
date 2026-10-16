/* 2026-10-16 封面两处改动的回归测试（用户真机反馈）：
   ① 点封面里的某一步 → 直接跳到那一步（逐步模式、长文模式各测一次；续看封面也测）
   ② 「还有 N 步」全部展开后：列表是自己的滚动容器——
      · 列表底边不超过按钮区顶边（以前步骤从按钮后面、按钮下面露出来）
      · 列表放不下时能滚、滚到底最后一步能完整看到；按钮在屏内
      · 展开底部折叠行后，新出来的第一行在列表可见范围内
   ③ 封面开着时，在封面上滑动不带动下面的页面（长文模式页面本身能滚）；在列表上滑动滚的是列表
   每档都查无横向溢出。320×568 / 390×844 / 430×932 三档。
   用法：node tools/verify-cover.js [--base=https://jc.wbztl.xyz] [--shots=目录]（默认本地 8879，由 run-all 起服务） */
const { open, sleep } = require('./cdp.js');
const path = require('path');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const BASE = arg('base'), SHOTS = arg('shots');
const ROOT = BASE ? BASE.replace(/\/$/, '') : 'http://127.0.0.1:8879';
const T = ROOT + '/t/qhftq5kz/';
const POS = 'sg.pos:/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };
const J = async (c, expr) => JSON.parse(await c.ev(`JSON.stringify(${expr})`));

async function fresh(c, mode, pos) {
  await c.goto(T);
  await c.ev(`localStorage.clear();localStorage.setItem('sg.readMode','${mode}');` +
    (pos ? `localStorage.setItem('${POS}',JSON.stringify({i:${pos},t:Date.now()}));` : '') + '1');
  await c.goto(T);
  await waitFor(c, `document.querySelectorAll('.page').length > 1 && !!document.querySelector('.pv.cover.on')`, 16);
  await sleep(350);
}

/** 用真实触摸在 (x,y) 竖直滑 dy */
async function swipe(c, x, y, dy) {
  const tp = (type, yy) => c.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy }] });
  await tp('touchStart', y);
  for (let k = 1; k <= 8; k++) { await tp('touchMove', y + dy * k / 8); await sleep(16); }
  await tp('touchEnd');
  await sleep(500);
}

const ROWS = `[...document.querySelectorAll('.pv.cover .pv-road li')]`;

async function phone(w, h) {
  const L = `${w}×${h}`;
  const c = await open(w, h, 2);
  try {
    // ── ① 第一次打开：点第 4 步 → 逐步模式翻到第 4 步
    await fresh(c, 'step');
    const go = await J(c, `(() => { const li = ${ROWS}.find(x => x.querySelector('.pv-n').textContent === '4');
      if (!li) return { has: false };
      const r = li.getBoundingClientRect();
      return { has: true, x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, role: li.getAttribute('role'),
        chev: !!li.querySelector('.pv-chev') }; })()`);
    chk(`${L} 封面每一步是可点的行（≥44 高、有箭头、role=button）`, go.has && go.h >= 44 && go.role === 'button' && go.chev, JSON.stringify(go));
    if (go.has) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: go.x, y: go.y }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(700);
      const s = await J(c, `(() => ({ cover: !!document.querySelector('.pv.cover'),
        count: (document.querySelector('#count') || {}).textContent,
        left: Math.round(document.querySelector('#deck').scrollLeft),
        want: Math.round(document.querySelector('.page[data-i="3"]').offsetLeft) }))()`);
      chk(`${L} 逐步模式：点第 4 步 → 封面收起、翻到第 4 步`, !s.cover && /^4\s*\//.test((s.count || '').trim()) && Math.abs(s.left - s.want) <= 2, JSON.stringify(s));
    }

    // ── ① 长文模式：点「还有 N 步」展开，再点第 10 步 → 滚到第 10 步
    await fresh(c, 'long');
    await c.ev(`document.querySelector('.pv.cover .pv-road li.fold').click(), 1`);
    await sleep(200);
    await c.ev(`(() => { const li = ${ROWS}.find(x => x.querySelector('.pv-n').textContent === '10'); li.scrollIntoView({ block: 'nearest' }); li.click(); })()`);
    await sleep(900);
    const lj = await J(c, `(() => { const p = document.querySelector('.page[data-i="9"]').getBoundingClientRect();
      const top = document.querySelector('.top').getBoundingClientRect();
      return { cover: !!document.querySelector('.pv.cover'), pTop: Math.round(p.top), topB: Math.round(top.bottom), y: Math.round(scrollY) }; })()`);
    chk(`${L} 长文模式：点第 10 步 → 封面收起、第 10 步顶在顶栏下面`, !lj.cover && lj.y > 0 && lj.pTop >= lj.topB - 2 && lj.pTop <= lj.topB + 40, JSON.stringify(lj));

    // ── ① 续看封面（做完 4 步）：点已完成的第 2 步也能跳回去
    await fresh(c, 'step', 4);
    await c.ev(`(() => { const li = ${ROWS}.find(x => x.querySelector('.pv-t').textContent && x.classList.contains('past') && !x.classList.contains('fold'));
      li.click(); })()`);
    await sleep(700);
    const rj = await J(c, `(() => ({ cover: !!document.querySelector('.pv.cover'), count: (document.querySelector('#count') || {}).textContent }))()`);
    chk(`${L} 续看封面：点已做完的一步也能跳过去`, !rj.cover && /^[1-4]\s*\//.test((rj.count || '').trim()), JSON.stringify(rj));

    // ── ② 续看封面全部展开（用户截图的场景）
    await fresh(c, 'long', 4);
    await c.ev(`(() => { [...document.querySelectorAll('.pv.cover .pv-road li.fold')].reverse().forEach(f => f.click()); })(), 1`);
    await sleep(300);
    const lay = await J(c, `(() => { const o = document.querySelector('.pv.cover'), ol = o.querySelector('.pv-road'), act = o.querySelector('.pv-act');
      const R = ol.getBoundingClientRect(), A = act.getBoundingClientRect(), go = o.querySelector('.pv-go').getBoundingClientRect();
      return { n: ol.querySelectorAll('li').length, folds: ol.querySelectorAll('li.fold').length,
        olB: Math.round(R.bottom), actT: Math.round(A.top), goB: Math.round(go.bottom), ih: innerHeight,
        scrolls: ol.scrollHeight > ol.clientHeight + 1, pvScroll: o.scrollHeight > o.clientHeight + 1, olTop: ol.scrollTop,
        sw: document.documentElement.scrollWidth, osw: o.scrollWidth, ow: o.clientWidth }; })()`);
    chk(`${L} 全部展开：12 行、没有折叠行`, lay.n === 12 && lay.folds === 0, JSON.stringify(lay));
    chk(`${L} 全部展开：列表底边在按钮区上面（不再从按钮后面/下面露出来）`, lay.olB <= lay.actT + 0.5, `列表底 ${lay.olB} / 按钮区顶 ${lay.actT}`);
    chk(`${L} 全部展开：按钮在屏内`, lay.goB <= lay.ih + 1, `${lay.goB}/${lay.ih}`);
    chk(`${L} 全部展开：整页不滚，只有列表自己滚（放得下时都不滚）`, !lay.pvScroll, JSON.stringify(lay));
    chk(`${L} 无横向溢出`, lay.sw <= w && lay.osw <= lay.ow, `${lay.sw}/${w} ${lay.osw}/${lay.ow}`);
    if (SHOTS) await c.vshot(path.join(SHOTS, `cover-expanded-${w}x${h}.png`));
    if (lay.scrolls) {
      await c.ev(`(() => { const ol = document.querySelector('.pv.cover .pv-road'); ol.scrollTop = ol.scrollHeight; })(), 1`);
      await sleep(100);
      const end = await J(c, `(() => { const ol = document.querySelector('.pv.cover .pv-road'), R = ol.getBoundingClientRect();
        const last = [...ol.querySelectorAll('li')].pop().getBoundingClientRect();
        return { lastB: Math.round(last.bottom), olB: Math.round(R.bottom), lastT: Math.round(last.top), olT: Math.round(R.top) }; })()`);
      chk(`${L} 列表滚到底：第 12 步完整露出`, end.lastB <= end.olB + 0.5 && end.lastT >= end.olT, JSON.stringify(end));
      if (SHOTS) await c.vshot(path.join(SHOTS, `cover-expanded-bottom-${w}x${h}.png`));
    }

    // ── ② 第一次打开，点底部「还有 N 步」：新出来的第一行（第 6 步）在列表可见范围内
    await fresh(c, 'step');
    await c.ev(`document.querySelector('.pv.cover .pv-road li.fold').click(), 1`);
    await sleep(150);
    const nv = await J(c, `(() => { const ol = document.querySelector('.pv.cover .pv-road'), R = ol.getBoundingClientRect();
      const li = ${ROWS}.find(x => x.querySelector('.pv-n').textContent === '6').getBoundingClientRect();
      return { t: Math.round(li.top), b: Math.round(li.bottom), olT: Math.round(R.top), olB: Math.round(R.bottom) }; })()`);
    chk(`${L} 展开「还有 N 步」后第 6 步在列表可见范围内`, nv.t >= nv.olT - 0.5 && nv.b <= nv.olB + 0.5, JSON.stringify(nv));

    // ── ③ 背景不跟着滚：长文模式，页面先滚到中间，再开封面
    await fresh(c, 'long', 4);
    await c.ev(`(() => { [...document.querySelectorAll('.pv.cover .pv-road li.fold')].reverse().forEach(f => f.click()); })(), 1`);
    await sleep(200);
    /* 只看 scrollY 没牙齿：Chrome 里 .pv 有 overscroll-behavior:contain，拦不拦页面都不动（拿掉拦截照样全过）；
       iOS Safari 在封面本身不能滚时会把滑动交给整页，那才是要防的。所以同时记每一下 touchmove 有没有被拦 */
    await c.ev(`window.__tm = []; addEventListener('touchmove', e => __tm.push(e.defaultPrevented), { passive: true }); 1`);
    const tm = async () => { const a = await J(c, '__tm'); await c.ev('__tm = [], 1'); return { n: a.length, blocked: a.filter(Boolean).length }; };
    const y0 = await c.ev('Math.round(scrollY)');
    const tt = await J(c, `(() => { const r = document.querySelector('.pv.cover .pv-title').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    await swipe(c, tt.x, tt.y + 30, -200);
    const y1 = await c.ev('Math.round(scrollY)');
    const m1 = await tm();
    chk(`${L} 在封面标题上往上滑，下面的页面不动、每一下滑动都被拦住`, y1 === y0 && m1.n > 0 && m1.blocked === m1.n, `scrollY ${y0} → ${y1}，拦住 ${m1.blocked}/${m1.n}`);
    // 慢慢拖：每下只动 2px。判过一次以后，小于 4px 的那些也得拦（审查发现：放过去的那一下可能正是开始滚动的那一下）
    {
      const tp = (type, yy) => c.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tt.x, y: yy }] });
      await tp('touchStart', tt.y + 30);
      for (let k = 1; k <= 30; k++) { await tp('touchMove', tt.y + 30 - 2 * k); await sleep(8); }
      await tp('touchEnd'); await sleep(300);
      const m = await tm();
      // 标题底下没有能滚的东西：从第一下（还不到 4px）就要拦（第二轮审查：放过的头几下在 iOS 上可能已经让页面滚起来）
      chk(`${L} 慢慢拖（每下 2px）：从第一下起每一下都被拦住`, m.n >= 15 && m.blocked === m.n, `拦住 ${m.blocked}/${m.n}`);
    }
    const ls = await J(c, `(() => { const ol = document.querySelector('.pv.cover .pv-road'), r = ol.getBoundingClientRect();
      ol.scrollTop = 0; return { x: r.left + r.width / 2, y: r.top + Math.min(r.height - 20, 160), can: ol.scrollHeight > ol.clientHeight + 1 }; })()`);
    if (ls.can) {
      await tm();
      await swipe(c, ls.x, ls.y, -120);
      const after = await J(c, `({ st: Math.round(document.querySelector('.pv.cover .pv-road').scrollTop), y: Math.round(scrollY) })`);
      const m2 = await tm();
      chk(`${L} 在列表上往上滑：列表滚了、页面没动（列表还能滚时不拦）`, after.st > 0 && after.y === y0 && m2.blocked === 0, JSON.stringify(after) + ` 拦住 ${m2.blocked}/${m2.n}`);
      // 滚到底后继续往上滑：交给整页的那一下也要拦住
      await c.ev(`(() => { const ol = document.querySelector('.pv.cover .pv-road'); ol.scrollTop = ol.scrollHeight; })(), 1`);
      await tm();
      await swipe(c, ls.x, ls.y, -150);
      const y2 = await c.ev('Math.round(scrollY)');
      const m3 = await tm();
      chk(`${L} 列表滚到底再往上滑，页面不动、滑动被拦住`, y2 === y0 && m3.n > 0 && m3.blocked === m3.n, `scrollY ${y0} → ${y2}，拦住 ${m3.blocked}/${m3.n}`);
    } else {
      console.log(`SKIP ${L} 列表放得下、不用滚，跳过列表滑动两项`);
    }

    // ── 淡出的 280ms 里连点第二行不再生效（审查发现：以前会跳两次）
    // 真实触摸连点同一行两下：第二下既不能再跳一次，也不能穿透到下面的页面（打开看图 / 再翻一步）
    await fresh(c, 'step');
    // 先点第 3 步、紧接着点第 5 步：第二下要被淡出中的封面吃掉（同一行连点验不出来——跳两次也是同一步）
    const rr = await J(c, `${ROWS}.slice(2, 5).map(li => { const r = li.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    const tap = async p => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    await tap(rr[0]); await sleep(90); await tap(rr[2]); await sleep(900);
    const dt = await J(c, `(() => ({ cover: !!document.querySelector('.pv.cover'), count: (document.querySelector('#count') || {}).textContent,
      zoom: !!(document.querySelector('dialog#zoom') || {}).open }))()`);
    chk(`${L} 连点第 3、5 步：只跳到第 3 步、第二下没生效也没穿透`, !dt.cover && /^3\s*\//.test((dt.count || '').trim()) && !dt.zoom, JSON.stringify(dt));
  } finally { c.close(); }
}

/** 横屏这类特别矮的屏：放不下时整页兜底滚动，按钮区 sticky 贴底，主按钮始终在屏内 */
async function landscape(w, h) {
  const L = `${w}×${h}（横屏）`;
  const c = await open(w, h, 2);
  try {
    // 先只点底部「还有 N 步」：整个封面在滚的矮屏上，新出来的第一行也要在屏内、不被按钮区挡住
    await fresh(c, 'step', 4);
    await c.ev(`(() => { const f = [...document.querySelectorAll('.pv.cover .pv-road li.fold')].pop(); f.click(); })(), 1`);
    await sleep(200);
    const nr = await J(c, `(() => { const o = document.querySelector('.pv.cover'), act = o.querySelector('.pv-act').getBoundingClientRect();
      const ol = o.querySelector('.pv-road').getBoundingClientRect();
      const li = ${ROWS}.find(x => x.querySelector('.pv-n').textContent === '8').getBoundingClientRect();
      return { t: Math.round(li.top), b: Math.round(li.bottom), actT: Math.round(act.top), olT: Math.round(ol.top), olB: Math.round(ol.bottom) }; })()`);
    chk(`${L} 展开「还有 N 步」后第 8 步在屏内、没被按钮区挡住`, nr.t >= Math.max(0, nr.olT) - 0.5 && nr.b <= Math.min(nr.actT, nr.olB) + 0.5, JSON.stringify(nr));
    await c.ev(`(() => { [...document.querySelectorAll('.pv.cover .pv-road li.fold')].forEach(f => f.click()); })(), 1`);
    await sleep(200);
    const r = await J(c, `(() => { const o = document.querySelector('.pv.cover'), g = o.querySelector('.pv-go').getBoundingClientRect();
      return { goT: Math.round(g.top), goB: Math.round(g.bottom), ih: innerHeight, sw: document.documentElement.scrollWidth }; })()`);
    chk(`${L} 全部展开后「从头开始」在屏内`, r.goB <= r.ih + 1 && r.goT >= 0, JSON.stringify(r));
    await c.ev(`(() => { const o = document.querySelector('.pv.cover'); o.scrollTop = o.scrollHeight; })(), 1`);
    await sleep(100);
    const r2 = await J(c, `(() => { const o = document.querySelector('.pv.cover'), g = o.querySelector('.pv-go').getBoundingClientRect();
      const a = o.querySelector('.pv-act').getBoundingClientRect();
      return { goB: Math.round(g.bottom), actB: Math.round(a.bottom), ih: innerHeight }; })()`);
    chk(`${L} 整页滚到底：按钮仍在屏内、按钮区盖到屏幕底边（下面不露步骤）`, r2.goB <= r2.ih + 1 && r2.actB >= r2.ih - 1, JSON.stringify(r2));
    chk(`${L} 无横向溢出`, r.sw <= w, `${r.sw}/${w}`);
    if (SHOTS) await c.vshot(path.join(SHOTS, `cover-landscape-${w}x${h}.png`));
  } finally { c.close(); }
}

(async () => {
  for (const [w, h] of [[320, 568], [390, 844], [430, 932]]) await phone(w, h);
  await landscape(568, 320);
  await landscape(844, 390);
  console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
