/* 手机手势：左滑删除 + 长按拖动排序。
   按配方 §6：必须用 Input.dispatchTouchEvent 真实触摸，el.click() 测了等于没测。
   另外：元素在页面下方时要先 scrollIntoView，否则事件落到屏外，静默失败。 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;

const SEED = `(async () => {
  const names = ['01.webp', '04.webp', '09.webp'];
  const files = [];
  for (const n of names) {
    const b = await fetch('../t/qhftq5kz/i/' + n).then(r => r.blob());
    files.push(new File([b], n, { type: b.type }));
  }
  await window.SGWriter.addFiles(files);
  const ta = document.querySelectorAll('.stext');
  ['第一步','第二步','第三步'].forEach((t, i) => {
    ta[i].value = t; ta[i].dispatchEvent(new Event('input', { bubbles: true }));
  });
  return document.querySelectorAll('.step').length;
})()`;

const order = `JSON.stringify(window.SGWriter.draft.steps.map(s => s.text))`;

(async () => {
  const c = await open(390, 844, 2);
  // 让页面认为自己是触屏设备，否则 matchMedia('(pointer: coarse)') 为假、手势根本不装
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(800);

  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };

  chk('触屏环境下装上了手势', await c.ev(`!!window.SGWriter.swipe && !!window.SGWriter.drag`),
      await c.ev(`matchMedia('(pointer: coarse)').matches ? 'pointer:coarse ✓' : 'pointer 不是 coarse'`));

  const n = await c.ev(SEED);
  chk('灌入 3 步', n === 3, '实际 ' + n);
  await sleep(300);

  const touch = (type, x, y) => c.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
  });

  // 拿第 2 张卡的坐标（先滚到可见处，否则事件落到屏外）
  const rect = async i => JSON.parse(await c.ev(`(() => {
    const el = document.querySelectorAll('.step')[${i}];
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                            top: Math.round(r.top), h: Math.round(r.height) });
  })()`));

  // ── ① 左滑露出删除 ──
  let r = await rect(1);
  await touch('touchStart', r.x, r.y);
  for (let dx = 12; dx <= 120; dx += 18) { await touch('touchMove', r.x - dx, r.y); }
  await touch('touchEnd', 0, 0);
  await sleep(500);
  const sw = JSON.parse(await c.ev(`JSON.stringify({
    acts: document.querySelectorAll('.lsw-acts').length,
    openCls: !!document.querySelector('.lsw-acts.is-open'),
    label: (document.querySelector('.lsw-btn .lsw-txt') || {}).textContent || '',
    shifted: (document.querySelectorAll('.step')[1].style.transform || '')
  })`));
  chk('左滑露出了操作按钮', sw.acts === 1 && sw.openCls, `按钮「${sw.label}」 卡片位移 ${sw.shifted}`);

  // ── ② 点删除 → 二次确认 → 真删 ──
  await c.ev(`document.querySelector('.lsw-btn').click()`);
  await sleep(400);
  const confirming = await c.ev(`document.getElementById('dlg-del').open`);
  chk('删除要二次确认（且不是原生 confirm）', confirming === true);
  await c.ev(`document.getElementById('del-yes').click()`);
  await sleep(500);
  const after = JSON.parse(await c.ev(order));
  chk('确认后真的删掉了那一步', after.length === 2 && !after.includes('第二步'), after.join(','));
  chk('删完按钮层也清掉了', (await c.ev(`document.querySelectorAll('.lsw-acts').length`)) === 0);

  // ── ③ 纵向滑动不该触发左滑 ──
  r = await rect(0);
  await touch('touchStart', r.x, r.y);
  for (let dy = 12; dy <= 90; dy += 18) await touch('touchMove', r.x, r.y - dy);
  await touch('touchEnd', 0, 0);
  await sleep(300);
  chk('纵向滑动不会误触左滑', (await c.ev(`document.querySelectorAll('.lsw-acts').length`)) === 0);

  // ── ④ 长按拖动排序 ──
  await c.ev(`(async () => { const b = await fetch('../t/qhftq5kz/i/11.webp').then(r => r.blob());
    await window.SGWriter.addFiles([new File([b], '11.webp', { type: b.type })]);
    const ta = document.querySelectorAll('.stext'); const last = ta[ta.length - 1];
    last.value = '第四步'; last.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  const before = JSON.parse(await c.ev(order));

  // 坐标必须一次性取完：中途再调 scrollIntoView 会把页面滚走，
  // 先算好的坐标就失效了，触摸落到别的元素上（这个坑我自己踩过一次）
  await c.ev(`scrollTo(0, 0)`);
  await sleep(300);
  const geo = JSON.parse(await c.ev(`(() => {
    const els = [...document.querySelectorAll('.step')];
    const h = els[0].querySelector('.handle').getBoundingClientRect();
    const t = els[2].getBoundingClientRect();
    return JSON.stringify({
      hx: Math.round(h.left + h.width / 2), hy: Math.round(h.top + h.height / 2),
      ty: Math.round(t.top + t.height / 2)
    });
  })()`));
  const hr = { x: geo.hx, y: geo.hy };
  const r2 = { y: geo.ty };
  await touch('touchStart', hr.x, hr.y);
  await sleep(300);                                   // 抓手上按住 90ms 就进入拖拽
  const dragging = await c.ev(`!!document.querySelector('.lpd-drag')`);
  chk('按住抓手进入拖拽态', dragging === true);
  r = { x: hr.x, y: hr.y };
  // 一路拖到第 3 张卡的位置
  for (let y = r.y; y <= r2.y + 20; y += 24) { await touch('touchMove', r.x, y); }
  await touch('touchEnd', 0, 0);
  await sleep(500);
  const now = JSON.parse(await c.ev(order));
  chk('拖动后顺序真的变了', JSON.stringify(now) !== JSON.stringify(before), `${before.join(',')} -> ${now.join(',')}`);
  chk('步数没变（只是换了位置）', now.length === before.length, now.length + ' 步');
  chk('拖完清掉了行内样式', (await c.ev(`[...document.querySelectorAll('.step')].every(s => !s.style.transform)`)) === true);

  // ── ⑤ 短按不该触发拖拽 ──
  r = await rect(1);
  await touch('touchStart', r.x, r.y);
  await sleep(150);
  await touch('touchEnd', 0, 0);
  await sleep(200);
  chk('短按不会误进拖拽', (await c.ev(`!document.querySelector('.lpd-drag')`)) === true);

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过（真机手感仍需用户确认）');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
