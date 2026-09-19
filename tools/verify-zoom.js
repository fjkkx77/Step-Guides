/* 放大查看器：电脑端滚轮/双击/拖动、关闭按钮看不看得清、老教程能不能用上 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const PAGE = process.argv[2] || 't/qhftq5kz/';
// --base=https://…/ 可以直接验线上（老教程能不能自动用上新放大器，只有线上说了算）
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');

const scaleOf = `(() => {
  const t = getComputedStyle(document.getElementById('zoomimg')).transform;
  if (!t || t === 'none') return 1;
  return +t.match(/matrix\\(([-\\d.]+)/)[1];
})()`;

(async () => {
  const c = await open(1280, 800, 1);
  await c.goto(BASE ? BASE.replace(/\/$/, '') + '/' + PAGE : `http://127.0.0.1:${PORT}/${PAGE}`);
  for (let i = 0; i < 30; i++) { await sleep(200); if (await c.ev(`!!document.querySelector('.page img')`)) break; }

  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };

  // 点图打开放大层（老教程的壳子里没有 zoom.js，应该被自动加载进来）
  await c.ev(`document.querySelector('.page img').click()`);
  // zoom.js/zoom.css 是按需取的，线上首次加载要等一会儿。
  // 用固定 sleep 会在慢网络下测早（本地秒开看不出来，已经踩过三次），改成等条件成立
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await c.ev(`!!(window.SGZoom && document.getElementById('zoom').open
                       && document.querySelector('#zoom .zclose'))`)) break;
  }
  await sleep(200);
  const st = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('zoom').open,
    zoomLib: !!window.SGZoom,
    hasBar: !!document.querySelector('#zoom .zbar'),
    closeText: (document.querySelector('#zoom .zclose') || {}).textContent || '',
    closeBox: (() => { const b = document.querySelector('#zoom .zclose');
      if (!b) return null; const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return { h: Math.round(r.height), w: Math.round(r.width), bg: cs.backgroundColor, fg: cs.color }; })(),
    tip: (document.querySelector('#zoom .ztip') || {}).textContent || ''
  })`));
  chk('点图打开放大层', st.open === true);
  chk('zoom.js 被自动加载（老教程也能用上）', st.zoomLib === true);
  chk('有工具栏', st.hasBar === true);
  chk('关闭按钮带文字且 ≥44px', /关闭/.test(st.closeText) && st.closeBox && st.closeBox.h >= 44,
      st.closeBox ? `${st.closeText.trim()} ${st.closeBox.w}×${st.closeBox.h} 底色${st.closeBox.bg}` : '没有');
  chk('底部有操作提示', /滚轮|双指/.test(st.tip), st.tip);

  const s0 = await c.ev(scaleOf);
  // 滚轮放大（电脑端的核心诉求）
  for (let i = 0; i < 4; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -240 });
    await sleep(120);
  }
  const s1 = await c.ev(scaleOf);
  chk('滚轮能放大', s1 > s0 * 1.3, `${s0.toFixed(2)} -> ${s1.toFixed(2)}`);

  const pct = await c.ev(`document.querySelector('#zoom .zpct').textContent`);
  chk('倍率显示跟着变', pct !== '100%', pct);

  // 滚轮缩小回去
  for (let i = 0; i < 8; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 240 });
    await sleep(100);
  }
  const s2 = await c.ev(scaleOf);
  chk('滚轮能缩小，且不会小于适应屏幕', s2 < s1 && s2 >= 0.999, s2.toFixed(2));

  // 双击放大
  await c.ev(`document.querySelector('#zoom .box').dispatchEvent(
    new MouseEvent('dblclick', { clientX: 640, clientY: 400, bubbles: true, cancelable: true }))`);
  await sleep(200);
  const s3 = await c.ev(scaleOf);
  chk('双击能放大', s3 > 2, s3.toFixed(2));

  // 还原
  await c.ev(`document.querySelector('#zoom .zreset').click()`);
  await sleep(200);
  chk('「还原」回到适应屏幕', Math.abs((await c.ev(scaleOf)) - 1) < 0.01);

  // 放大后拖动
  await c.ev(`document.querySelector('#zoom .box').dispatchEvent(
    new MouseEvent('dblclick', { clientX: 640, clientY: 400, bubbles: true, cancelable: true }))`);
  await sleep(200);
  const moved = await c.ev(`(() => {
    const box = document.querySelector('#zoom .box');
    const before = getComputedStyle(document.getElementById('zoomimg')).transform;
    const ev = (t, x, y) => box.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'mouse',
      clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', 640, 400); ev('pointermove', 500, 320); ev('pointerup', 500, 320);
    return JSON.stringify({ before, after: getComputedStyle(document.getElementById('zoomimg')).transform });
  })()`);
  const mv = JSON.parse(moved);
  chk('放大后可以按住拖动', mv.before !== mv.after);

  // 关闭
  await c.ev(`document.querySelector('#zoom .zclose').click()`);
  await sleep(200);
  chk('点关闭能退出', (await c.ev(`document.getElementById('zoom').open`)) === false);
  chk('关掉后倍率复位', Math.abs((await c.ev(scaleOf)) - 1) < 0.01);

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
