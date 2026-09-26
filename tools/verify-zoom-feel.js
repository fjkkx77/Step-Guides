/* 放大查看器的「手感」：把"跟不跟手、拖不拖沓"变成能量的数（2026-09-26 用户反馈"不跟手、很拖沓、放大不动缩小不动"）
   ① 跟手：捏合全程，手指中点底下那一点必须一直在手指中点底下（误差 ≤1.5px），靠近 1×、靠边时也一样
   ② 不顶死：捏到 1× 以下 / 8× 以上、拖出边界，画面还得跟着动（有阻力），松手再弹回合法范围
   ③ 不拖沓：回弹途中再按下去，第一下移动必须 1:1 跟手（旧版这里带着 0.24s 缓动）
   ④ 利落：快速一甩松手后有惯性滑行、最终停在边界内；慢慢拖停住再松手不滑
   用页面内合成的 PointerEvent 驱动（时间可控）；真实触摸通路由 verify-zoom.js 覆盖。
   用法：node tools/verify-zoom-feel.js [--base=https://jc.wbztl.xyz] */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const url = (BASE ? BASE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`) + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };

// 页面里的工具：合成指针事件、读当前画面状态、等一帧
const LIB = `(() => {
  const box = document.querySelector('#zoom .box'), img = document.getElementById('zoomimg');
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ev = (type, id, x, y) => box.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch',
    isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const st = () => { const m = /matrix\\(([^)]+)\\)/.exec(getComputedStyle(img).transform || '');
    const v = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    const r = img.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { s: v[0], x: v[4], y: v[5], r, b, anim: img.classList.contains('zanim'), wc: img.style.willChange }; };
  // 以 (u,v) 表示"图上的一点"（相对图片当前外框的比例），看它现在在屏幕哪
  const where = (u, v) => { const r = img.getBoundingClientRect(); return { x: r.left + u * r.width, y: r.top + v * r.height }; };
  const uv = (x, y) => { const r = img.getBoundingClientRect(); return { u: (x - r.left) / r.width, v: (y - r.top) / r.height }; };
  const inBounds = () => { const r = img.getBoundingClientRect(), b = box.getBoundingClientRect();
    const okX = r.width <= b.width + 1 ? Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2) < 1.5 : (r.left <= b.left + 1 && r.right >= b.right - 1);
    const okY = r.height <= b.height + 1 ? Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) < 1.5 : (r.top <= b.top + 1 && r.bottom >= b.bottom - 1);
    return okX && okY; };
  // 双指捏合：两指从 (c±d0) 到 (c'±d1)，分 n 帧，每帧检查锚点误差
  async function pinch(c0, d0, c1, d1, n = 24, holdEnd = true) {
    ev('pointerdown', 1, c0.x - d0, c0.y); ev('pointerdown', 2, c0.x + d0, c0.y); await frame();
    const a = uv(c0.x, c0.y); let err = 0; const ss = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n, cx = c0.x + (c1.x - c0.x) * t, cy = c0.y + (c1.y - c0.y) * t, d = d0 + (d1 - d0) * t;
      ev('pointermove', 1, cx - d, cy); ev('pointermove', 2, cx + d, cy); await frame();
      const p = where(a.u, a.v); err = Math.max(err, Math.hypot(p.x - cx, p.y - cy)); ss.push(st().s);
    }
    const end = st();
    if (holdEnd) { ev('pointerup', 2, c1.x + d1, c1.y); ev('pointerup', 1, c1.x - d1, c1.y); }
    return { err, ss, end };
  }
  return { box, img, frame, wait, ev, st, where, uv, inBounds, pinch };
})()`;

(async () => {
  const c = await open(390, 844, 2);
  try {
    await c.goto(url);
    await waitFor(c, `!!document.querySelector('.page img')`);
    await c.ev(`document.querySelector('.page img').click()`);
    await waitFor(c, `!!(window.SGZoom && document.getElementById('zoom').open)`);
    await waitFor(c, `(() => { const i = document.getElementById('zoomimg'); return !!(i && i.complete && i.naturalWidth && i.getBoundingClientRect().width); })()`);
    await sleep(300);
    await c.ev(`window.__Z = ${LIB}`);
    const run = async body => JSON.parse(await c.ev(`(async () => { const Z = window.__Z; ${body} })().then(JSON.stringify)`));
    // 复位：没有还原键了（2026-09-26 照「照片」去掉），放大状态下双击＝复原
    const resetZ = () => c.ev(`(async () => {
      const m = /matrix\\(([^,]+)/.exec(getComputedStyle(document.getElementById('zoomimg')).transform || '');
      if (m && +m[1] > 1.01) {
        const b = document.querySelector('#zoom .box').getBoundingClientRect();
        document.querySelector('#zoom .box').dispatchEvent(new MouseEvent('dblclick', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 450));
    })()`);

    // ① 跟手：从 1× 开始捏大，同时两指中点往左上挪（靠近图片边缘）——旧版在这里会夹位移，锚点溜走
    let r = await run(`const b = Z.box.getBoundingClientRect();
      return await Z.pinch({ x: b.left + b.width * 0.3, y: b.top + b.height * 0.3 }, 30,
                           { x: b.left + b.width * 0.2, y: b.top + b.height * 0.2 }, 110);`);
    chk('捏合放大全程跟手（手指中点下那一点不溜走）', r.err <= 1.5, `最大偏差 ${r.err.toFixed(2)}px，结束倍率 ${r.end.s.toFixed(2)}`);
    await sleep(400);
    chk('松手后回到边界内', await c.ev(`__Z.inBounds()`));

    // 从放大状态往回捏到 1× 附近（旧版：一碰到 1× 就吸回正中，手指下那点瞬间跳走）
    r = await run(`const b = Z.box.getBoundingClientRect();
      return await Z.pinch({ x: b.left + b.width * 0.5, y: b.top + b.height * 0.5 }, 110,
                           { x: b.left + b.width * 0.6, y: b.top + b.height * 0.55 }, 45);`);
    chk('捏小回 1× 附近也跟手（不会突然吸回正中）', r.err <= 1.5, `最大偏差 ${r.err.toFixed(2)}px`);
    await sleep(400); await resetZ();

    // ② 缩到 1× 以下：要有阻力地继续变小，而不是顶死在 1×；松手弹回 1× 居中
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const p = await Z.pinch(cc, 120, cc, 40, 20);
      await Z.wait(450); const e = Z.st();
      return { min: Math.min(...p.ss), after: e.s, x: e.x, y: e.y };`);
    chk('捏到 1× 以下还能继续缩（有阻力，不顶死）', r.min < 0.97 && r.min > 0.5, `最小 ${r.min.toFixed(3)}×（手指捏到 1/3）`);
    chk('松手弹回 1× 并居中', Math.abs(r.after - 1) < 0.005 && Math.abs(r.x) < 0.5 && Math.abs(r.y) < 0.5, `${r.after.toFixed(3)}× (${r.x.toFixed(1)},${r.y.toFixed(1)})`);

    // 放到 8× 以上
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      await Z.pinch(cc, 20, cc, 150, 20); await Z.wait(400);           // 先放到 7.5×
      const p = await Z.pinch(cc, 20, cc, 150, 20);                     // 再捏 7.5 倍（手指想到 ~56×）
      await Z.wait(450);
      return { max: Math.max(...p.ss), after: Z.st().s };`);
    chk('放到 8× 以上还能再大一点（有阻力，不顶死）', r.max > 8.05 && r.max < 12, `最大 ${r.max.toFixed(2)}×`);
    chk('松手弹回 8×', Math.abs(r.after - 8) < 0.01, `${r.after.toFixed(3)}×`);
    await resetZ();

    // ②' 拖出边界：继续动但越来越难拖；松手弹回边界内
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      await Z.pinch(cc, 30, cc, 75, 12); await Z.wait(400);             // ≈2.5×
      const x0 = Z.st().x;
      // 往右拖 600px，分 30 帧：前面在边界内，后面出界
      Z.ev('pointerdown', 1, 60, cc.y); await Z.frame();
      const xs = [];
      for (let i = 1; i <= 30; i++) { Z.ev('pointermove', 1, 60 + i * 20, cc.y); await Z.frame(); xs.push(Z.st().x); }
      await Z.wait(120);                                                // 停住再松手：不该甩出去
      Z.ev('pointerup', 1, 660, cc.y);
      await Z.wait(450);
      const steps = xs.map((v, i) => i ? v - xs[i - 1] : v - x0);
      return { first: steps[0], lastStep: steps[steps.length - 1], total: xs[xs.length - 1] - x0, inB: Z.inBounds() };`);
    chk('边界内拖动 1:1 跟手', Math.abs(r.first - 20) < 0.6, `手指 20px → 图 ${r.first.toFixed(2)}px`);
    chk('拖出边界还能动、但越来越难拖（不顶死）', r.lastStep > 0.3 && r.lastStep < 12, `最后一帧手指 20px → 图 ${r.lastStep.toFixed(2)}px`);
    chk('松手弹回边界内', r.inB);

    // ③ 回弹途中再按下去：立刻 1:1 跟手（旧版：0.24s 缓动挂着，"慢慢跟上来"）
    r = await run(`const b = Z.box.getBoundingClientRect(), cy = b.top + b.height / 2;
      Z.ev('pointerdown', 1, 60, cy); await Z.frame();
      for (let i = 1; i <= 25; i++) { Z.ev('pointermove', 1, 60 + i * 20, cy); await Z.frame(); }
      await Z.wait(100); Z.ev('pointerup', 1, 560, cy);                  // 出界松手 → 开始回弹
      await Z.wait(60);                                                  // 回弹进行到一小半
      const before = Z.st();
      Z.ev('pointerdown', 1, 200, cy + 100); await Z.frame();
      const caught = Z.st();
      Z.ev('pointermove', 1, 170, cy + 100); await Z.frame();
      const after = Z.st();
      // "拖沓"的本质是画面落后于目标：比较同一帧里 屏幕上的位置(computed) 和 目标位置(inline style)
      const tgt = /translate\\(([-\\d.]+)px/.exec(Z.img.style.transform);
      const lag = tgt ? Math.abs(after.x - +tgt[1]) : 999;
      Z.ev('pointerup', 1, 170, cy + 100); await Z.wait(400);
      return { animBefore: before.anim, animAfterDown: caught.anim, jump: Math.abs(caught.x - before.x),
               step: after.x - caught.x, lag };`);
    chk('回弹途中确实在过渡（场景成立）', r.animBefore === true);
    chk('按下瞬间接住：过渡立刻摘掉、画面不跳', r.animAfterDown === false && r.jump < 25, `按下时位移变化 ${r.jump.toFixed(1)}px`);
    chk('接住后移动不落后于手指（画面=目标，没有缓动）', r.lag < 0.5 && r.step < -1,
        `画面与目标差 ${r.lag.toFixed(2)}px；此刻仍在边界外，手指 -30px → 图 ${r.step.toFixed(2)}px（边界外有阻力，iPhone 也这样）`);

    // ③' 双击放大后马上拖（新旧版都有这个场景）：旧版 .zanim 挂 260ms，这期间拖动每一下都带 0.24s 缓动
    await resetZ();
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      for (let k = 0; k < 2; k++) { Z.ev('pointerdown', 1, cc.x, cc.y); Z.ev('pointerup', 1, cc.x, cc.y); await Z.wait(60); }
      await Z.wait(40);                                                  // 双击放大动画还在跑
      Z.ev('pointerdown', 1, cc.x, cc.y); await Z.frame();
      const lags = [];
      for (let i = 1; i <= 6; i++) {
        Z.ev('pointermove', 1, cc.x - i * 15, cc.y); await Z.frame();
        const tgt = /translate\\(([-\\d.]+)px/.exec(Z.img.style.transform);
        lags.push(tgt ? Math.abs(Z.st().x - +tgt[1]) : 999);
      }
      Z.ev('pointerup', 1, cc.x - 90, cc.y); await Z.wait(1500);
      return { lag: Math.max(...lags), s: Z.st().s };`);
    chk('双击放大后立刻拖：画面不落后于手指', r.lag < 0.5, `画面最多落后目标 ${r.lag.toFixed(1)}px（倍率 ${r.s.toFixed(2)}）`);

    // ④ 快速一甩：松手后还在滑、减速、最后停在边界内且摘掉 will-change
    await resetZ();
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      await Z.pinch(cc, 30, cc, 120, 12); await Z.wait(400);            // ≈4×，留足滑行空间
      Z.ev('pointerdown', 1, cc.x, cc.y + 150); await Z.frame();
      for (let i = 1; i <= 6; i++) { Z.ev('pointermove', 1, cc.x, cc.y + 150 - i * 25); await Z.frame(); }
      const atUp = Z.st().y;
      Z.ev('pointerup', 1, cc.x, cc.y);
      await Z.wait(120); const y1 = Z.st().y;
      await Z.wait(300); const y2 = Z.st().y;
      await Z.wait(2500); const fin = Z.st();
      return { d1: atUp - y1, d2: y1 - y2, total: atUp - fin.y, inB: Z.inBounds(), wc: fin.wc };`);
    chk('快速一甩：松手后继续滑行', r.d1 > 5, `松手后 120ms 又滑了 ${r.d1.toFixed(1)}px，共 ${r.total.toFixed(1)}px`);
    chk('滑行在减速（不是匀速）', r.d2 > 0 && r.d2 / 300 < r.d1 / 120, `前段 ${(r.d1 / 120).toFixed(2)} → 后段 ${(r.d2 / 300).toFixed(2)} px/ms`);
    chk('滑完停在边界内、摘掉 will-change（清晰）', r.inB && !r.wc, `will-change="${r.wc}"`);

    // 慢慢拖、停住再松手：不该滑
    r = await run(`const b = Z.box.getBoundingClientRect(), cc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      Z.ev('pointerdown', 1, cc.x, cc.y); await Z.frame();
      for (let i = 1; i <= 5; i++) { Z.ev('pointermove', 1, cc.x + i * 4, cc.y); await Z.frame(); }
      await Z.wait(150); const a = Z.st().x;
      Z.ev('pointerup', 1, cc.x + 20, cc.y); await Z.wait(300);
      return { drift: Math.abs(Z.st().x - a) };`);
    chk('停住再松手不会滑走', r.drift < 0.5, `松手后漂移 ${r.drift.toFixed(2)}px`);

    if (c.errors && c.errors.length) chk('无 JS 报错', false, c.errors.join(' | '));
  } finally { await c.close(); }
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过（真机手感仍需用户确认）');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
