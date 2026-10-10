/* 放大查看器「顺不顺」：把"缩放过程中有点掉帧、卡卡的"变成能量的数（2026-10-10 用户反馈）。
   量出来的两个原因，各守一组：
   ① 鼠标滚轮一格就把倍率直接跳过去（旧版：滚 6 格只有 6 帧在变，单帧跳 17%）
      → 现在滚轮只改目标、画面每帧追过去：有变化的帧要多、单帧跳变要小、终点倍率不能变、光标下那一点不能跑
   ② 每个 pointermove 都写一次样式、读一次布局（旧版：两指 × 高回报率下每帧写 4 次读 4 次）
      → 现在一帧只写一次、手势中不读布局
   另外守住几条容易顺手改坏的：连着滚目标要累加、追到一半按下去要立刻停、触控板的细增量直接跟、
   停下后摘掉 will-change、松手那一下不拖帧。
   同一个脚本跑旧版必须 FAIL（--base=https://jc.wbztl.xyz 可以验线上）。
   注意：这里量的是"主线程每帧干多少活、画面有没有中间帧"，量不了真机的实际帧率——那个要在手机上看。
   用法：node tools/verify-zoom-smooth.js [--base=https://jc.wbztl.xyz] */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const url = (BASE ? BASE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`) + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };

async function openZoom(c) {
  await c.goto(url);
  await waitFor(c, `!!document.querySelector('.page img')`);
  await c.ev(`document.querySelector('.page img').click()`);
  await waitFor(c, `!!(window.SGZoom && document.getElementById('zoom').open)`);
  await waitFor(c, `(() => { const i = document.getElementById('zoomimg'); return !!(i && i.complete && i.naturalWidth && i.getBoundingClientRect().width); })()`);
  await sleep(400);
  // 页面里的小工具：读当前倍率、等一帧、合成滚轮
  await c.ev(`window.__Q = (() => {
    const box = document.querySelector('#zoom .box'), img = document.getElementById('zoomimg');
    const scale = () => { const t = getComputedStyle(img).transform; return t && t !== 'none' ? new DOMMatrix(t).a : 1; };
    const frame = () => new Promise(r => requestAnimationFrame(() => r()));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const wheel = (x, y, dy, ctrl) => box.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: dy, ctrlKey: !!ctrl, bubbles: true, cancelable: true }));
    const uv = (x, y) => { const r = img.getBoundingClientRect(); return { u: (x - r.left) / r.width, v: (y - r.top) / r.height }; };
    const where = (u, v) => { const r = img.getBoundingClientRect(); return { x: r.left + u * r.width, y: r.top + v * r.height }; };
    const reset = async () => { if (scale() > 1.01) { const b = box.getBoundingClientRect();
      box.dispatchEvent(new MouseEvent('dblclick', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true })); await wait(450); } };
    return { box, img, scale, frame, wait, wheel, uv, where, reset };
  })(), true`);
}
const run = async (c, body) => JSON.parse(await c.ev(`(async () => { const Q = window.__Q; ${body} })().then(JSON.stringify)`));

(async () => {
  /* ── 电脑：滚轮 ─────────────────────────────── */
  let c = await open(1280, 800, 1);
  try {
    await openZoom(c);

    // ① 滚 6 格（每格间隔 120ms），逐帧记倍率
    const w = await run(c, `
      const r = Q.img.getBoundingClientRect(), x = r.left + r.width * 0.3, y = r.top + r.height * 0.4, a = Q.uv(x, y);
      const ss = [Q.scale()]; let on = true, drift = 0;
      (async () => { while (on) { await Q.frame(); ss.push(Q.scale()); const p = Q.where(a.u, a.v); drift = Math.max(drift, Math.abs(p.y - y)); } })();
      for (let i = 0; i < 6; i++) { Q.wheel(x, y, -100); await Q.wait(120); }
      await Q.wait(600); on = false; await Q.frame();
      let changed = 0, jump = 0;
      for (let i = 1; i < ss.length; i++) { const k = Math.abs(ss[i] / ss[i - 1] - 1); if (k > 0.0005) changed++; jump = Math.max(jump, k); }
      return { frames: ss.length, changed, jump, end: ss[ss.length - 1], drift, wc: getComputedStyle(Q.img).willChange };`);
    chk('滚轮放大有中间帧（6 格至少 30 帧在变）', w.changed >= 30, `${w.frames} 帧里 ${w.changed} 帧有变化`);
    chk('滚轮放大单帧跳变 < 8%', w.jump < 0.08, (w.jump * 100).toFixed(1) + '%');
    chk('终点倍率和以前一样（6 格 = e^(600/420) ≈ 4.17×）', Math.abs(w.end - Math.exp(600 / 420)) < 0.03, w.end.toFixed(3) + '×');
    // 只看纵向：竖图比窗口窄，横向按设计一直居中（图没铺满那一边不让偏），纵向才是钉在光标上的。
    // 容差给 6px：图在 1× 时上下各留一点空，刚开始放大、还没铺满高度的那几帧纵向也是居中的，会带来 3px 左右的固定偏差
    // （新旧版一样，是"没铺满就居中"的规则，不是追的过程引入的）；锚点真锚错的话是几十上百像素
    chk('全程光标底下那一点纵向不跑（≤6px）', w.drift <= 6, w.drift.toFixed(2) + 'px');
    chk('滚轮停下后摘掉 will-change（重新栅格化＝清晰）', ['auto', ''].includes(w.wc), w.wc);

    // ② 追到一半按下去：立刻停，不再自己动
    await run(c, `await Q.reset(); return 1;`);
    const g = await run(c, `
      const b = Q.box.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      Q.wheel(x, y, -300); await Q.frame(); await Q.frame(); await Q.frame();
      Q.box.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      await Q.frame(); const s1 = Q.scale(); await Q.wait(300); const s2 = Q.scale();
      Q.box.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      await Q.wait(500);
      return { s1, s2, target: Math.exp(300 / 420) };`);
    chk('追到一半按下去就停住（不会自己接着放大）', g.s1 > 1.02 && g.s1 < g.target - 0.05 && Math.abs(g.s2 - g.s1) < 0.002,
        `按下时 ${g.s1.toFixed(3)}×，300ms 后 ${g.s2.toFixed(3)}×，目标 ${g.target.toFixed(3)}×`);

    // ③ 触控板捏合（ctrl+滚轮）/ 细增量：直接跟，不再追一遍（追了反而滞后）
    await c.ev(`document.getElementById('zoom').close()`);
    await openZoom(c);
    const t = await run(c, `
      const b = Q.box.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
      Q.wheel(x, y, -20, true); await Q.frame(); await Q.frame();
      const a = Q.scale();
      Q.wheel(x, y, -12); await Q.frame(); await Q.frame();
      return { a, b: Q.scale(), ea: Math.exp(20 / 100), eb: Math.exp(20 / 100) * Math.exp(12 / 420) };`);
    chk('触控板捏合两帧内到位', Math.abs(t.a - t.ea) < 0.004, `${t.a.toFixed(4)}× / 应为 ${t.ea.toFixed(4)}×`);
    chk('细增量滚轮两帧内到位', Math.abs(t.b - t.eb) < 0.004, `${t.b.toFixed(4)}× / 应为 ${t.eb.toFixed(4)}×`);

    // ④ 往回滚到 1× 以下：停在 1×、图回正中
    const o = await run(c, `
      const b = Q.box.getBoundingClientRect();
      for (let i = 0; i < 8; i++) { Q.wheel(b.left + 200, b.top + 200, 100); await Q.wait(60); }
      await Q.wait(600);
      const r = Q.img.getBoundingClientRect();
      return { s: Q.scale(), off: Math.hypot((r.left + r.right) / 2 - (b.left + b.right) / 2, (r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) };`);
    chk('滚回去停在 1×、图回到正中', Math.abs(o.s - 1) < 0.002 && o.off < 1, `${o.s.toFixed(3)}×，偏 ${o.off.toFixed(1)}px`);
    chk('电脑端全程没有脚本报错', c.errors.length === 0, c.errors.join(' | '));
  } finally { c.close(); }

  /* ── 手机：捏合 / 拖动 ─────────────────────── */
  c = await open(390, 844, 3);
  try {
    await openZoom(c);
    const p = await run(c, `
      let reads = 0, writes = 0;
      const o = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () { reads++; return o.call(this); };
      const mo = new MutationObserver(l => { writes += l.length; }); mo.observe(Q.img, { attributes: true, attributeFilter: ['style'] });
      const ev = (type, id, x, y) => Q.box.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev('pointerdown', 1, 150, 420); ev('pointerdown', 2, 240, 420); await Q.frame(); await Q.frame();
      mo.takeRecords(); reads = 0; writes = 0;
      const FR = 40;
      for (let f = 1; f <= FR; f++) {            // 每帧 4 次 move：两根手指 × 120Hz 采样
        for (let k = 0; k < 2; k++) { const d = 45 + (f + k / 2) * 2; ev('pointermove', 1, 195 - d, 420); ev('pointermove', 2, 195 + d, 420); }
        await Q.frame();
      }
      writes += mo.takeRecords().length;
      const pinchReads = reads / FR, pinchWrites = writes / FR, s = Q.scale();
      ev('pointerup', 2, 320, 420); await Q.frame();
      // 剩一根手指接着拖
      reads = 0; writes = 0; mo.takeRecords();
      for (let f = 1; f <= 20; f++) { for (let k = 0; k < 2; k++) ev('pointermove', 1, 70 + f * 3 + k, 420 + f * 2); await Q.frame(); }
      writes += mo.takeRecords().length;
      const dragReads = reads / 20, dragWrites = writes / 20;
      // 松手那一下：同一瞬间"移动 + 抬起"，最后的位置要立刻画上（不拖到下一帧）
      await Q.frame(); const before = Q.img.style.transform;
      ev('pointermove', 1, 180, 500); ev('pointerup', 1, 180, 500); const after = Q.img.style.transform;
      Element.prototype.getBoundingClientRect = o; mo.disconnect();
      await Q.wait(700);
      return { pinchReads, pinchWrites, dragReads, dragWrites, s, flushed: before !== after, wc: Q.img.style.willChange };`);
    chk('捏合：一帧只写一次样式', p.pinchWrites <= 1.05, `每帧 ${p.pinchWrites.toFixed(2)} 次`);
    chk('捏合：手势中不读布局', p.pinchReads <= 0.1, `每帧 ${p.pinchReads.toFixed(2)} 次`);
    chk('捏合确实放大了', p.s > 2, p.s.toFixed(2) + '×');
    chk('拖动：一帧只写一次样式、不读布局', p.dragWrites <= 1.05 && p.dragReads <= 0.1, `写 ${p.dragWrites.toFixed(2)} / 读 ${p.dragReads.toFixed(2)}`);
    chk('松手那一下立刻画上最后的位置', p.flushed);
    chk('松手后摘掉 will-change', p.wc === '', p.wc || '(空)');
    chk('手机端全程没有脚本报错', c.errors.length === 0, c.errors.join(' | '));
  } finally { c.close(); }

  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
