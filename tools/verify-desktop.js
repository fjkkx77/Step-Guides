/* 2026-10-17 电脑版式回归：用户看了对比图，选「电脑上恢复改版前的通栏布局」（手机保持新版式）。
   改版那次只按手机设计，电脑上文字收进 640px、长文整列收进 760px、长文截图贴左——用户：「很窄、很拧巴很挤、浪费大屏」。
   ① 电脑（1280/1707）逐步模式：文字卡片在上、截图在下（同日用户要求文字放回图上面）；文字卡片铺满内容区（不是窄的一栏）；底栏两个按钮等宽
   ② 电脑长文模式：每步一张通栏卡片（左右各留 12px）、标题和说明在截图上面、截图在卡片里水平居中
   ⑥ 长正文默认展开（2026-10-17 用户要求）：电脑上一律展开，只有挤到截图不到一半宽的极端长文先收着（跟 reader.js 同一条规则）；点一下能切换、收起时「更多」渐隐跟卡片同色
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
  return { page: pr, content, say: R(p.querySelector('.say .h')), txt: R(p.querySelector('.txt')), sayBox: R(p.querySelector('.say')), img: R(p.querySelector('.shot img')),
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

const RH = `(async () => {
  const s = document.querySelector('.page[data-i="0"] .say'), img = s.parentNode.querySelector('.shot img');
  const open = s.classList.contains('open');
  s.classList.remove('open'); const w0 = img.getBoundingClientRect().width;
  s.classList.add('open'); const w1 = img.getBoundingClientRect().width;
  s.classList.toggle('open', open);
  return JSON.stringify({ open, w0: Math.round(w0), w1: Math.round(w1), fits: w1 >= w0 * (window.__sgFit ? window.__sgFit.FIT_DESK : .5) - 1, key: s.dataset.autoW });
})()`;

async function desk(w, h) {
  const L = `${w}×${h}`;
  const c = await openDesk(w, h);
  try {
    chk(`${L} 前提：这是有鼠标的电脑（any-hover:hover + any-pointer:fine）`, await c.ev(`matchMedia('(any-hover:hover) and (any-pointer:fine)').matches`));
    await enter(c, 'step');
    let g = await J(c, GEO);
    chk(`${L} 逐步：文字卡片在上、截图在下`, g.sayBox.b <= g.img.t + 1, `文字底 ${Math.round(g.sayBox.b)} / 图顶 ${Math.round(g.img.t)}`);
    const cw = g.content.r - g.content.l;
    chk(`${L} 逐步：文字卡片铺满内容区（不是窄的一栏）`, g.sayBox.w >= cw - 2, `卡片 ${Math.round(g.sayBox.w)} / 内容区 ${Math.round(cw)}`);
    chk(`${L} 逐步：底栏「上一步」「下一步」等宽、铺满`, Math.abs(g.prevW - g.nextW) <= 2 && g.nextW > w * 0.3, `${Math.round(g.prevW)} / ${Math.round(g.nextW)}`);
    chk(`${L} 逐步：无横向溢出`, g.sw <= w, `${g.sw}/${w}`);
    const h2 = await c.ev(`getComputedStyle(document.querySelector('.page[data-i="0"] .say h2')).fontSize`);
    chk(`${L} 逐步：卡片里标题 22px`, h2 === '22px', h2);
    // 长正文（放得下才展开，跟 reader.js 同一条规则）：n 倍长度的说明，默认状态要跟规则算出来的一致；
    // 一般长度（8 倍，宽窗口里也超过 3 行）在每个电脑尺寸都必须是展开的（电脑上「默认展开」真的生效），特别长（40 倍）会把截图挤成一条、该收着。
    // 点一下切换，收起时「更多」渐隐跟卡片同色。新开页面再改文字：自动判过的会被锁住，得清掉锁再量
    // 异步要在页面里先 await 再自己序列化（J() 会把 Promise 直接 stringify 成 {}）
    const longText = async n => JSON.parse(await c.ev(`(async () => {
      const s = document.querySelector('.page[data-i="0"] .say'), q = s.querySelector('.txt p'), img = s.parentNode.querySelector('.shot img');
      q.dataset.orig = q.dataset.orig || q.textContent;
      q.textContent = q.dataset.orig.repeat(${n}); delete s.dataset.auto; delete s.dataset.autoW; delete s.dataset.folded;
      dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 400));
      await img.decode().catch(() => {});
      const open0 = s.classList.contains('open'), label0 = s.querySelector('.more-t').textContent;
      s.classList.remove('open'); const w0 = img.getBoundingClientRect().width;
      s.classList.add('open'); const w1 = img.getBoundingClientRect().width;
      s.classList.toggle('open', open0);
      const fits = w1 >= w0 * (window.__sgFit ? window.__sgFit.FIT_DESK : .5) - 1;   // 电脑版式：一律展开，只有挤到不到一半宽才先收着（阈值读 reader.js 的）
      s.click(); await new Promise(r => setTimeout(r, 600));
      const open1 = s.classList.contains('open');
      const more = getComputedStyle(s.querySelector('.more')).backgroundImage, card = getComputedStyle(s).backgroundColor;
      return JSON.stringify({ can: s.classList.contains('can-open'), open0, label0, fits, w0: Math.round(w0), w1: Math.round(w1),
        open1, label1: s.querySelector('.more-t').textContent, fadeToCard: !open1 ? more.includes(card) : null });
    })()`));
    for (const n of [8, 40]) {
      const ex = await longText(n);
      const okState = ex.can && ex.open0 === ex.fits && ex.label0 === (ex.open0 ? '收起' : '更多') && ex.open1 !== ex.open0 && ex.label1 === (ex.open1 ? '收起' : '更多');
      const okFade = ex.open0 ? ex.fadeToCard === true : true;
      chk(`${L} 逐步：${n} 倍长的说明默认${ex.fits ? '展开' : '收起'}（截图 收起 ${ex.w0} / 展开 ${ex.w1}px），点一下能切换、收起时渐隐跟卡片同色`, okState && okFade, JSON.stringify(ex));
      if (n === 8) chk(`${L} 逐步：一般长度的说明在电脑上默认展开`, ex.can && ex.open0 === true, JSON.stringify(ex));
    }
    // 电脑窗口只改高度（拖矮窗口、开底部 DevTools）也要重新判断：截图被高度限住，变矮后可能就放不下了（审查指出）
    if (w === 1280 && h === 720) {
      await longText(8);
      // longText 里点过一下＝「亲手点过」，会被照用户的来、不再自动判：清掉，在 720 高先自动判一次（应是展开）
      const at720 = JSON.parse(await c.ev(`(async () => { const s = document.querySelector('.page[data-i="0"] .say');
        delete s.dataset.folded; delete s.dataset.auto; delete s.dataset.autoW; dispatchEvent(new Event('resize'));
        await new Promise(r => setTimeout(r, 400)); return JSON.stringify({ open: s.classList.contains('open'), key: s.dataset.autoW }); })()`));
      chk(`${L} 逐步：（前提）720 高时一般长度的说明是展开的`, at720.open && at720.key === '1280x720d', JSON.stringify(at720));
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 430, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: 430 });
      await sleep(600);
      const rh = JSON.parse(await c.ev(RH));
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h });
      await sleep(400);
      chk(`${L} 逐步：窗口拖矮到 430 高后重新判断（按新高度该${rh.fits ? '展开' : '收着'}）`, rh.open === rh.fits && /x430d$/.test(rh.key || ''), JSON.stringify(rh));
    }

    await enter(c, 'long');
    g = await J(c, GEO);
    chk(`${L} 长文：每步是通栏卡片（左右各留约 12px）`, g.page.l <= 13 && g.page.r >= w - 13 - 15, `卡片 ${Math.round(g.page.l)}~${Math.round(g.page.r)}（视口 ${g.vw}）`);
    const pc = (g.page.l + g.page.r) / 2, ic = (g.img.l + g.img.r) / 2;
    chk(`${L} 长文：截图在卡片里水平居中`, Math.abs(pc - ic) <= 2, `卡片中线 ${Math.round(pc)} / 图中线 ${Math.round(ic)}`);
    // 长文里 .say 是 display:contents，自己没有盒子（量出来是 0），要量里面的标题和说明
    chk(`${L} 长文：标题 → 说明 → 截图，从上往下`, g.say.b <= g.txt.t + 1 && g.txt.b <= g.img.t + 1 && g.txt.b > 0, `标题底 ${Math.round(g.say.b)} / 说明 ${Math.round(g.txt.t)}~${Math.round(g.txt.b)} / 图顶 ${Math.round(g.img.t)}`);
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
