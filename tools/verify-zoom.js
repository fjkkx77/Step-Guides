/* 放大查看器：电脑端滚轮/双击/拖动/关闭 + 手机端捏合/双击/下滑关闭/工具栏自动隐藏
   重点盯这次修的三个根因：
   ① will-change 不能常驻（常驻＝GPU 按旧倍率拉伸＝放大后糊）
   ② 第二根手指落下不能被误判成双击（那就是"一放上去就闪"）
   ③ 双击要有过渡动画，不能一帧跳变 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const PAGE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 't/qhftq5kz/';
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');

const scaleOf = `(() => {
  const t = getComputedStyle(document.getElementById('zoomimg')).transform;
  if (!t || t === 'none') return 1;
  const m = t.match(/matrix\\(([-\\d.]+)/);
  return m ? +m[1] : 1;
})()`;

(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  const url = BASE ? BASE.replace(/\/$/, '') + '/' + PAGE : `http://127.0.0.1:${PORT}/${PAGE}`;
  const waitFor = async (c, expr, n = 40) => {
    for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; }
    return false;
  };

  /* ══════════ 电脑端 ══════════ */
  const c = await open(1280, 800, 1);
  await c.goto(url);
  await waitFor(c, `!!document.querySelector('.page img')`);

  chk('进页面就预载了放大器样式（不等点图）', await c.ev(`(() => {
    const l = document.querySelector('link[data-sg-zoom]');
    return !!(l && l.sheet && l.sheet.cssRules.length > 5);
  })()`));

  await c.ev(`document.querySelector('.page img').click()`);
  await waitFor(c, `!!(window.SGZoom && document.getElementById('zoom').open && document.querySelector('#zoom .zclose'))`);
  await waitFor(c, `(() => { const i = document.getElementById('zoomimg');
    return !!(i && i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0); })()`);
  await sleep(200);

  const st = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('zoom').open,
    bar: !!document.querySelector('#zoom .zbar'),
    closeText: ((document.querySelector('#zoom .zclose') || { getAttribute: () => '' }).getAttribute('aria-label')) || '',
    extra: !!document.querySelector('#zoom .zpct, #zoom .zreset'),
    closeH: (() => { const b = document.querySelector('#zoom .zclose');
      return b ? Math.round(b.getBoundingClientRect().height) : 0; })(),
    tip: !!document.querySelector('#zoom .ztip'),
    willChange: getComputedStyle(document.getElementById('zoomimg')).willChange
  })`));
  chk('点图打开放大层', st.open === true);
  // 2026-09-26 照 iPhone「照片」：左上角一个圆形返回键（读屏名"关闭"），没有倍率牌和还原键
  chk('工具栏在，返回键可读屏且 ≥44px', st.bar && /关闭/.test(st.closeText) && st.closeH >= 44,
      `${st.closeText.trim()} 高 ${st.closeH}`);
  chk('照「照片」：没有倍率牌和还原键', st.extra === false);
  chk('底部那条操作提示已去掉', st.tip === false);
  chk('静止时没有 will-change（常驻会让放大后发糊）',
      ['auto', ''].includes(st.willChange), st.willChange);

  const s0 = await c.ev(scaleOf);
  for (let i = 0; i < 3; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -160 });
    await sleep(120);
  }
  const s1 = await c.ev(scaleOf);
  chk('滚轮能放大', s1 > s0 * 1.2, `${s0.toFixed(2)} -> ${s1.toFixed(2)}`);

  await sleep(500);
  chk('滚轮停下后摘掉 will-change（画面重新栅格化＝清晰）',
      ['auto', ''].includes(await c.ev(`getComputedStyle(document.getElementById('zoomimg')).willChange`)),
      await c.ev(`getComputedStyle(document.getElementById('zoomimg')).willChange`));

  // 没有还原键了：放大状态下双击＝复原（照片的做法）
  await c.ev(`document.querySelector('#zoom .box').dispatchEvent(
    new MouseEvent('dblclick', { clientX: 640, clientY: 400, bubbles: true, cancelable: true }))`);
  await sleep(400);
  chk('放大状态下双击复原到 1×', Math.abs((await c.ev(scaleOf)) - 1) < 0.01, (+(await c.ev(scaleOf))).toFixed(2));
  await c.ev(`document.querySelector('#zoom .box').dispatchEvent(
    new MouseEvent('dblclick', { clientX: 640, clientY: 400, bubbles: true, cancelable: true }))`);
  await sleep(60);
  const anim = JSON.parse(await c.ev(`JSON.stringify({
    cls: document.getElementById('zoomimg').classList.contains('zanim'),
    trans: getComputedStyle(document.getElementById('zoomimg')).transitionDuration
  })`));
  chk('双击带过渡动画（不是一帧跳变）', anim.cls && parseFloat(anim.trans) > 0.1, anim.trans);
  await sleep(400);
  chk('双击后确实放大了', (await c.ev(scaleOf)) > 2, (+(await c.ev(scaleOf))).toFixed(2));

  const mv = JSON.parse(await c.ev(`(() => {
    const box = document.querySelector('#zoom .box');
    const before = getComputedStyle(document.getElementById('zoomimg')).transform;
    const ev = (t, x, y) => box.dispatchEvent(new PointerEvent(t, { pointerId: 1, pointerType: 'mouse',
      clientX: x, clientY: y, bubbles: true, cancelable: true }));
    ev('pointerdown', 640, 400); ev('pointermove', 520, 320); ev('pointerup', 520, 320);
    return JSON.stringify({ before, after: getComputedStyle(document.getElementById('zoomimg')).transform });
  })()`));
  chk('放大后可以按住拖动', mv.before !== mv.after);

  await sleep(3300);
  // 照片：控件不会自己消失，轻点才隐藏（Apple 官方说明）
  chk('闲置 3 秒控件仍在（照片的做法：不自动消失）',
      (await c.ev(`document.getElementById('zoom').classList.contains('chrome-off')`)) === false);
  await c.ev(`document.getElementById('zoom').classList.add('chrome-off')`);
  await c.ev(`document.querySelector('#zoom .box').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
  await sleep(250);
  chk('动一下鼠标工具栏就回来',
      (await c.ev(`!document.getElementById('zoom').classList.contains('chrome-off')`)) === true);

  await c.ev(`document.querySelector('#zoom .zclose').click()`);
  await sleep(300);
  chk('点关闭能退出', (await c.ev(`document.getElementById('zoom').open`)) === false);
  await c.close();

  /* ══════════ 手机端 ══════════ */
  const m = await open(390, 844, 2);
  await m.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await m.goto(url);
  await waitFor(m, `!!document.querySelector('.page img')`);
  await m.ev(`document.querySelector('.page img').click()`);
  await waitFor(m, `!!document.querySelector('#zoom .zclose')`);
  // 必须等图片真的加载并排好版再做手势：线上比本地慢，早一步做手势就什么都不会发生
  // （这一条让我误判成"线上捏合坏了"）
  await waitFor(m, `(() => { const i = document.getElementById('zoomimg');
    return !!(i && i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0); })()`);
  await sleep(250);

  const T = (type, pts) => m.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const mScale = async () => +(await m.ev(scaleOf));

  await T('touchStart', [{ x: 150, y: 400, id: 1 }]);
  await sleep(80);
  await T('touchStart', [{ x: 150, y: 400, id: 1 }, { x: 250, y: 400, id: 2 }]);
  await sleep(200);
  const afterTwoDown = await mScale();
  chk('两指落下不会被误判成双击（"一放上去就闪"的根因）',
      Math.abs(afterTwoDown - 1) < 0.02, afterTwoDown.toFixed(2));

  const seq = [];
  for (let d = 20; d <= 120; d += 20) {
    await T('touchMove', [{ x: 150 - d, y: 400, id: 1 }, { x: 250 + d, y: 400, id: 2 }]);
    await sleep(70);
    seq.push(+(await mScale()).toFixed(2));
  }
  const rising = seq.every((v, i) => i === 0 || v >= seq[i - 1] - 0.01);
  chk('捏合时倍率连续上升（不来回跳＝不抖）', rising && seq[seq.length - 1] > 1.3, seq.join(' → '));
  chk('捏合进行中开着 will-change（跟手）',
      (await m.ev(`document.getElementById('zoomimg').style.willChange`)) === 'transform');

  // 抬起其中一根手指：剩下那根继续动时不能跳（旧版会拿"按下瞬间的坐标"算位移）
  const beforeLift = await m.ev(`document.getElementById('zoomimg').style.transform`);
  await T('touchEnd', [{ x: 30, y: 400, id: 1 }]);
  await sleep(120);
  const afterLift = await m.ev(`document.getElementById('zoomimg').style.transform`);
  chk('抬起一根手指的瞬间画面不跳', beforeLift === afterLift, `${beforeLift} -> ${afterLift}`);

  // 剩下那根手指移动 40px，位移也应该只变 40px 左右，不是几百
  const num = t => +((/translate\(([-\d.]+)px/.exec(t) || [0, 0])[1]);
  await T('touchMove', [{ x: 410, y: 400, id: 2 }]);
  await sleep(150);
  const afterMove = await m.ev(`document.getElementById('zoomimg').style.transform`);
  chk('单指接着拖是连续的（没有几百像素的跳变）',
      Math.abs(num(afterMove) - num(afterLift)) < 60,
      `${num(afterLift).toFixed(0)} -> ${num(afterMove).toFixed(0)}`);

  await T('touchEnd', [{ x: 410, y: 400, id: 2 }]);
  await sleep(300);
  chk('手一松就摘掉 will-change（重新栅格化＝清晰）',
      (await m.ev(`document.getElementById('zoomimg').style.willChange`)) === '');

  await m.ev(`document.getElementById('zoom').classList.remove('chrome-off')`);
  await T('touchStart', [{ x: 200, y: 520, id: 1 }]);
  await T('touchEnd', []);
  await sleep(450);
  chk('手机上点一下能收起工具栏（不挡图）',
      (await m.ev(`document.getElementById('zoom').classList.contains('chrome-off')`)) === true);
  await sleep(350);                       // 等背景色过渡跑完
  chk('收起控件后背景转纯黑（沉浸看图）',
      (await m.ev(`getComputedStyle(document.getElementById('zoom')).backgroundColor`)).replace(/\s/g, '') === 'rgb(0,0,0)',
      await m.ev(`getComputedStyle(document.getElementById('zoom')).backgroundColor`));

  // 再点一下唤回：这次不能再自动消失（用户反馈"还没来得及点就没了"）
  await T('touchStart', [{ x: 200, y: 520, id: 1 }]);
  await T('touchEnd', []);
  await sleep(500);
  const backOn = await m.ev(`!document.getElementById('zoom').classList.contains('chrome-off')`);
  chk('再点一下工具栏回来', backOn === true);
  await sleep(350);
  chk('控件显示时背景跟系统外观（浅色＝白，不是大黑边）',
      (await m.ev(`getComputedStyle(document.getElementById('zoom')).backgroundColor`)).replace(/\s/g, '') === 'rgb(255,255,255)',
      await m.ev(`getComputedStyle(document.getElementById('zoom')).backgroundColor`));
  await sleep(3800);                      // 比自动淡出的 3 秒还久
  chk('主动唤回后不会自己再消失',
      (await m.ev(`!document.getElementById('zoom').classList.contains('chrome-off')`)) === true);

  await m.ev(`document.getElementById('zoom').classList.remove('chrome-off')`);
  // 没有还原键：双击复原（照片的做法），为下面的"下滑关闭"回到 1×
  await T('touchStart', [{ x: 200, y: 520, id: 1 }]); await T('touchEnd', []);
  await sleep(120);
  await T('touchStart', [{ x: 200, y: 520, id: 1 }]); await T('touchEnd', []);
  await sleep(500);
  chk('手机双击复原到 1×', Math.abs((await mScale()) - 1) < 0.01, (await mScale()).toFixed(2));
  await T('touchStart', [{ x: 195, y: 260, id: 1 }]);
  for (let y = 290; y <= 460; y += 30) { await T('touchMove', [{ x: 195, y, id: 1 }]); await sleep(45); }
  const drag = JSON.parse(await m.ev(`JSON.stringify({
    t: document.getElementById('zoomimg').style.transform,
    fade: getComputedStyle(document.getElementById('zoom')).getPropertyValue('--zfade')
  })`));
  const dyNum = (/translate\(\s*[-\d.]+px,\s*([-\d.]+)px/.exec(drag.t) || [0, 0])[1];
  chk('下滑时图片跟着手指走', +dyNum > 80, `位移 ${dyNum}px`);
  chk('下滑时背景跟着变淡', drag.fade !== '' && +drag.fade < 1, '--zfade=' + drag.fade);
  await T('touchEnd', []);
  await sleep(500);
  chk('下滑到位就关闭（Apple 相册的做法）', (await m.ev(`document.getElementById('zoom').open`)) === false);

  await m.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过（真机手感仍需用户确认）');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
