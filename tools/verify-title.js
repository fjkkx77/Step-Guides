/* 两件事：
   ① 点被截断的标题 → 浮出完整标题；点别处/翻页收起；没截断时点了没反应、不挤版面
   ② 「更多」提示：上次停在长文模式 → 重开 → 切回逐步，被裁的步骤必须都有「更多」
      （2026-09-26 的偶发 bug：长文模式下量出来全是"没被裁"，切回来没人重量）
   用法：node tools/verify-title.js [--base=https://jc.wbztl.xyz] */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const url = (BASE ? BASE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`) + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };

// 逐页判断"真被裁了"（临时取消裁剪量真实高度）和"提示有没有显示"
const clampStat = `JSON.stringify((() => { let cut = 0, shown = 0, wrong = 0;
  document.querySelectorAll('.page').forEach(p => {
    const para = p.querySelector('.txt p'), more = p.querySelector('.more');
    const vis = para.clientHeight; para.classList.add('unclamp'); const full = para.scrollHeight; para.classList.remove('unclamp');
    const isCut = full > vis + 1;
    if (isCut) { cut++; if (!more.hidden) shown++; } else if (!more.hidden) wrong++;
  });
  return { mode: document.documentElement.dataset.mode, cut, shown, wrong }; })())`;

async function run(w, h, label) {
  const c = await open(w, h, 2);
  try {
    await c.goto(url);
    await waitFor(c, `!!document.querySelector('.page')`);
    await c.ev(`document.documentElement.dataset.mode === 'long' && document.getElementById('modebtn').click()`);
    await sleep(500);

    // ── ① 标题
    const t = JSON.parse(await c.ev(`JSON.stringify((() => { const h = document.getElementById('title');
      return { cut: h.scrollWidth > h.clientWidth + 1, cls: h.classList.contains('is-cut'), full: h.textContent,
               deckH: document.getElementById('deck').offsetHeight }; })())`));
    chk(`${label} 截断状态标得对`, t.cut === t.cls, `截断=${t.cut}`);
    await c.ev(`document.getElementById('title').click()`); await sleep(350);
    const p = JSON.parse(await c.ev(`JSON.stringify((() => { const x = document.querySelector('.title-pop');
      if (!x) return { has: false, deckH: document.getElementById('deck').offsetHeight };
      const r = x.getBoundingClientRect(), top = document.querySelector('.top').getBoundingClientRect();
      return { has: true, text: x.textContent, l: r.left, r: r.right, t: r.top, topB: top.bottom, vw: innerWidth,
               sw: document.documentElement.scrollWidth, deckH: document.getElementById('deck').offsetHeight }; })())`));
    if (t.cut) {
      chk(`${label} 点截断的标题 → 浮出完整标题`, p.has && p.text === t.full, p.text);
      chk(`${label} 浮层在顶栏下方、左右都在屏内`, p.has && p.t >= p.topB && p.l >= 0 && p.r <= p.vw && p.sw <= p.vw, p.has ? `top=${Math.round(p.t)} 顶栏底=${Math.round(p.topB)} [${Math.round(p.l)},${Math.round(p.r)}]` : '');
      chk(`${label} 浮层不挤版面（截图区高度不变）`, p.deckH === t.deckH, `${t.deckH}→${p.deckH}`);
      // 点别处收起（用真实指针事件，捕获阶段的 pointerdown 才会触发）
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(w / 2), y: Math.round(h / 2), button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(w / 2), y: Math.round(h / 2), button: 'left', clickCount: 1 });
      await sleep(250);
      chk(`${label} 点别处收起`, !(await c.ev(`!!document.querySelector('.title-pop')`)));
      await c.ev(`document.getElementById('title').click()`); await sleep(200);
      await c.ev(`document.getElementById('title').click()`); await sleep(200);
      chk(`${label} 再点标题收起`, !(await c.ev(`!!document.querySelector('.title-pop')`)));
      await c.ev(`document.getElementById('title').click()`); await sleep(200);
      await c.ev(`document.getElementById('next').click()`); await sleep(700);
      chk(`${label} 翻页后收起`, !(await c.ev(`!!document.querySelector('.title-pop')`)));
      await c.ev(`document.getElementById('prev').click()`); await sleep(700);
    } else {
      chk(`${label} 标题没截断时点了不出浮层`, !p.has);
    }

    // ── ② 「更多」
    const a = JSON.parse(await c.ev(clampStat));
    chk(`${label} 直接进逐步：被裁的都有「更多」`, a.shown === a.cut && a.wrong === 0, `被裁 ${a.cut}，有提示 ${a.shown}，多余 ${a.wrong}`);
    await c.ev(`document.getElementById('modebtn').click()`); await sleep(400);          // 停在长文（会被记住）
    await c.goto(url); await waitFor(c, `!!document.querySelector('.page')`); await sleep(600);
    const mode = await c.ev(`document.documentElement.dataset.mode`);
    await c.ev(`document.getElementById('modebtn').click()`); await sleep(600);          // 切回逐步
    const b = JSON.parse(await c.ev(clampStat));
    chk(`${label} 上次停在长文→重开→切回逐步：被裁的都有「更多」`, mode === 'long' && b.mode === 'step' && b.cut === a.cut && b.shown === b.cut && b.wrong === 0,
        `重开时模式=${mode}，被裁 ${b.cut}，有提示 ${b.shown}，多余 ${b.wrong}`);
    await c.ev(`try { localStorage.removeItem('sg.readMode') } catch (e) {}`);
    if (c.errors && c.errors.length) chk(`${label} 无 JS 报错`, false, c.errors.join(' | '));
  } finally { await c.close(); }
}

(async () => {
  for (const [w, h, l] of [[320, 568, '320×568'], [390, 844, '390×844'], [390, 640, '390×640'], [430, 932, '430×932'], [1280, 800, '1280×800']])
    await run(w, h, l);
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
