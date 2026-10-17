/* 2026-10-16 电脑上「双击放大/缩小后查看器自己关掉」的回归测试。
   根因：pointerdown 里 setPointerCapture 之后，pointerup 的 target 一律是 .box 而不是 <img>，
   于是「单击 300ms 后若点的不是图就关闭」对每一下鼠标点击都成立——双击的第二下也会排一个关闭。
   旧测试只派发合成的 dblclick 事件（没有 pointerdown/up），所以一直测不出来。
   这里用 CDP Input.dispatchMouseEvent 发真实的鼠标按下/抬起（clickCount 1、2），跟手按鼠标一样。
   ① 双击图片放大 → 600ms 后查看器还开着、倍率 > 1
   ② 再双击缩回 → 还开着、倍率 = 1
   ③ 双击空白处 → 也不关（双击＝缩放，不是两次单击）
   ④ 单击图片 → 不关（照片里单击图片不关）
   ⑤ 单击空白处 → 关（原有行为保留）
   用法：node tools/verify-dblclick.js [--base=https://jc.wbztl.xyz] */
const { open, sleep } = require('./cdp.js');
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const ROOT = BASE ? BASE.replace(/\/$/, '') : 'http://127.0.0.1:8879';
const T = ROOT + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const J = async (c, expr) => JSON.parse(await c.ev(`JSON.stringify(${expr})`));

(async () => {
  const c = await open(1280, 800, 1);
  // 这是电脑鼠标的测试：关掉 cdp.js 默认的触摸模拟，否则媒体查询报 pointer:coarse，拿到的是手机版式（2026-10-17 起电脑版式只认有鼠标的屏）
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  const mouse = (type, x, y, n) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: n });
  const click = async (x, y, n) => { await mouse('mousePressed', x, y, n); await mouse('mouseReleased', x, y, n); };
  const dbl = async (x, y) => { await click(x, y, 1); await sleep(60); await click(x, y, 2); };
  const state = () => J(c, `(() => { const d = document.querySelector('dialog#zoom'), im = d && d.querySelector('img');
    const tf = (im && im.style.transform) || '', k = tf.indexOf('scale(');
    return { open: !!d && d.open, s: k < 0 ? 1 : parseFloat(tf.slice(k + 6)), tf }; })()`);
  try {
    await c.goto(T);
    await c.ev(`localStorage.clear();localStorage.setItem('sg.readMode','step');1`);
    await c.goto(T);
    await sleep(800);
    await c.ev(`(() => { const b = document.querySelector('.pv.cover .pv-go'); if (b) b.click(); })()`);
    await sleep(600);
    const openViewer = async () => {
      await c.ev(`(() => { const d = document.querySelector('dialog#zoom'); if (d && d.open) d.close(); })()`);
      await sleep(200);
      const r = await J(c, `(() => { const im = document.querySelector('.page[data-i="0"] .shot img'); im.scrollIntoView({block:'center'});
        const b = im.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      await click(r.x, r.y, 1);
      await sleep(700);
      return J(c, `(() => { const im = document.querySelector('dialog#zoom img'), b = im.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left }; })()`);
    };

    let p = await openViewer();
    chk('点截图打开查看器', (await state()).open);

    await dbl(p.x, p.y); await sleep(700);
    let s = await state();
    chk('① 双击图片放大，查看器不关', s.open && s.s > 1.5, JSON.stringify(s));

    await dbl(p.x, p.y); await sleep(700);
    s = await state();
    chk('② 再双击缩回，查看器不关', s.open && Math.abs(s.s - 1) < 0.02, JSON.stringify(s));

    p = await openViewer();
    await dbl(Math.max(20, p.l - 150), p.y); await sleep(700);
    s = await state();
    chk('③ 双击空白处，查看器不关', s.open, JSON.stringify(s));

    // 慢一点的双击（两下隔 400ms，Windows 默认 500ms 内仍算双击）：以前等 300ms 就把第一下当单击关掉了
    p = await openViewer();
    await click(Math.max(20, p.l - 150), p.y, 1); await sleep(400); await click(Math.max(20, p.l - 150), p.y, 2); await sleep(800);
    s = await state();
    chk('⑥ 慢双击空白处（间隔 400ms），查看器不关', s.open, JSON.stringify(s));

    // 三连击空白处：第三下不能被当成新的单击去关（第二轮审查）
    // 点在屏幕最左边：双击放大后图片会长大，点得离图太近，第三下其实落在图上，测不到要测的东西（第一版就这样，旧代码也全过）。
    // 所以第三下之前先确认这个点仍是空白，场景不成立就直接判失败
    p = await openViewer();
    { const bx = 8;
      await click(bx, p.y, 1); await sleep(60); await click(bx, p.y, 2); await sleep(120);
      const blank = await c.ev(`document.elementFromPoint(${bx}, ${p.y}) !== document.querySelector('dialog#zoom img')`);
      chk('⑦ 场景成立：双击放大后，第三下的位置仍是空白', blank);
      await click(bx, p.y, 3); await sleep(900); }
    s = await state();
    chk('⑦ 三连击空白处，查看器不关', s.open, JSON.stringify(s));

    p = await openViewer();
    await click(p.x, p.y, 1); await sleep(700);
    s = await state();
    chk('④ 单击图片，查看器不关', s.open, JSON.stringify(s));

    await click(Math.max(20, p.l - 150), p.y, 1); await sleep(700);
    s = await state();
    chk('⑤ 单击空白处，查看器关闭', !s.open, JSON.stringify(s));
  } finally { c.close(); }
  console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
