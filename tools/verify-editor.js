/* 写作页新加的东西：缩略图放大、换图（含粘贴）、发布前预览、保存/返回按钮 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;

const SEED = `(async () => {
  const names = ['01.webp', '04.webp'];
  const files = [];
  for (const n of names) {
    const b = await fetch('../t/qhftq5kz/i/' + n).then(r => r.blob());
    files.push(new File([b], n, { type: b.type }));
  }
  await window.SGWriter.addFiles(files);
  document.getElementById('title').value = '预览测试';
  document.getElementById('title').dispatchEvent(new Event('input', { bubbles: true }));
  return document.querySelectorAll('.step').length;
})()`;

(async () => {
  const c = await open(1280, 900, 1);
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(700);
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };

  chk('顶栏有返回键', await c.ev(`!!document.getElementById('btn-back')`));
  chk('底栏有「预览 / 保存草稿 / 发布」三个键', await c.ev(`
    !!document.getElementById('btn-preview') && !!document.getElementById('btn-save') && !!document.getElementById('btn-publish')`));
  chk('设置里有 我的教程/回首页/导出/丢弃', await c.ev(`
    ['btn-mine','btn-home','btn-export','btn-discard'].every(id => !!document.getElementById(id))`));

  const n = await c.ev(SEED);
  chk('灌入 2 步', n === 2, '实际 ' + n);

  // ① 点缩略图放大
  await c.ev(`document.querySelector('.step .thumb').click()`);
  await sleep(600);
  const z = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('zoom').open,
    hasBar: !!document.querySelector('#zoom .zbar'),
    src: (document.getElementById('zoomimg') || {}).src ? 'yes' : 'no'
  })`));
  chk('点缩略图能放大看', z.open === true && z.src === 'yes');
  chk('放大层带工具栏（关闭/还原/倍率）', z.hasBar === true);
  await c.ev(`document.querySelector('#zoom .zclose').click()`);
  await sleep(200);

  // ② 换图弹层
  await c.ev(`window.SGWriter.swap(0)`);
  await sleep(400);
  const sw = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('dlg-swap').open,
    title: document.getElementById('swap-title').textContent,
    filePick: !!document.getElementById('swap-pick'),
    clip: !!document.getElementById('swap-clip'),
    box: !!document.getElementById('swap-paste')
  })`));
  chk('换图弹层打开', sw.open === true, sw.title);
  chk('换图有「选文件」和「粘贴剪贴板」两个键', sw.filePick && sw.clip);
  chk('换图弹层里平时看不到粘贴框', (await c.ev(`document.getElementById('swap-paste').hidden`)) === true);

  // 用粘贴换图：往粘贴框里派发一个带文件的 paste
  const swapped = await c.ev(`(async () => {
    document.getElementById('swap-paste').hidden = false;   // 模拟"读不到剪贴板"时的兜底路径
    const before = window.SGWriter.draft.steps[0].key + '|' + window.SGWriter.draft.steps[0].w;
    const b = await fetch('../t/qhftq5kz/i/09.webp').then(r => r.blob());
    const dt = new DataTransfer();
    dt.items.add(new File([b], '09.webp', { type: b.type }));
    document.getElementById('swap-paste').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 900));
    const after = window.SGWriter.draft.steps[0].key + '|' + window.SGWriter.draft.steps[0].w;
    return JSON.stringify({ before, after, steps: window.SGWriter.draft.steps.length,
                            dlg: document.getElementById('dlg-swap').open });
  })()`);
  const sp = JSON.parse(swapped);
  chk('粘贴能换掉这一步的图', sp.before !== sp.after, `${sp.before} -> ${sp.after}`);
  chk('换图不会多出一步', sp.steps === 2, '步数 ' + sp.steps);
  chk('换完自动关掉弹层', sp.dlg === false);

  // ③ 发布前预览
  await c.ev(`window.SGWriter.openPreview()`);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const ok = await c.ev(`(() => { const f = document.getElementById('pvframe');
      return !!(f && f.contentDocument && f.contentDocument.querySelector('.page')); })()`);
    if (ok) break;
  }
  const pv = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('dlg-preview').open,
    pages: document.getElementById('pvframe').contentDocument.querySelectorAll('.page').length,
    title: document.getElementById('pvframe').contentDocument.getElementById('title').textContent,
    imgOk: (() => { const im = document.getElementById('pvframe').contentDocument.querySelector('.page img');
      return !!im && im.naturalWidth > 0; })(),
    notPublished: /还没发布/.test(document.querySelector('.pvbar').textContent)
  })`));
  chk('预览打开并渲染出步骤', pv.open === true && pv.pages === 2, pv.pages + ' 步');
  chk('预览里标题正确', pv.title === '预览测试', pv.title);
  chk('预览里图片真的显示出来了', pv.imgOk === true);
  chk('预览上明确写着「还没发布」', pv.notPublished === true);
  // 预览里点图放大：必须和正式页面长得一样（漏内联 zoom.css 时这里会退化成小白框）
  const pvZoom = JSON.parse(await c.ev(`(async () => {
    const d = document.getElementById('pvframe').contentDocument;
    d.querySelector('.page img').click();
    await new Promise(r => setTimeout(r, 700));
    const dlg = d.getElementById('zoom');
    const cs = dlg ? getComputedStyle(dlg) : null;
    const close = d.querySelector('#zoom .zclose');
    const cr = close ? close.getBoundingClientRect() : null;
    return JSON.stringify({
      open: !!(dlg && dlg.open),
      bg: cs ? cs.backgroundColor : '',
      fullW: cs ? Math.round(parseFloat(cs.width)) : 0,
      closeH: cr ? Math.round(cr.height) : 0,
      closeBg: close ? getComputedStyle(close).backgroundColor : ''
    });
  })()`));
  chk('预览里点图能放大', pvZoom.open === true);
  chk('预览里的放大器样式完整（zoom.css 已内联）',
      /rgba\(12, 12, 14/.test(pvZoom.bg) && pvZoom.closeH >= 44,
      `底色 ${pvZoom.bg} / 关闭键高 ${pvZoom.closeH} 底色 ${pvZoom.closeBg}`);
  await c.ev(`document.getElementById('pvframe').contentDocument.querySelector('#zoom .zclose').click()`);
  await sleep(200);

  await c.ev(`document.getElementById('pv-close').click()`);
  await sleep(200);
  chk('能关掉预览', (await c.ev(`document.getElementById('dlg-preview').open`)) === false);

  // ④ 保存草稿的回执
  await c.ev(`document.getElementById('btn-save').click()`);
  await sleep(400);
  const tag = JSON.parse(await c.ev(`JSON.stringify({
    hidden: document.getElementById('savetag').hidden,
    text: document.getElementById('savetag').textContent
  })`));
  chk('点保存有看得见的回执', tag.hidden === false && /已保存/.test(tag.text), tag.text);

  // ⑤ 返回键要回到「来的那一页」，不是一律跳教程库
  await c.goto(`http://127.0.0.1:${PORT}/`);
  await sleep(500);
  await c.ev(`document.querySelector('a[href="w/"]').click()`);
  await sleep(900);
  chk('从首页点进写作页', /\/w\//.test(await c.ev(`location.pathname`)));
  await c.ev(`document.getElementById('btn-back').click()`);
  await sleep(900);
  const backTo = await c.ev(`location.pathname`);
  chk('从首页进来的，返回回首页（不是教程库）', backTo === '/' || /\/index\.html$/.test(backTo), '落在 ' + backTo);

  await c.goto(`http://127.0.0.1:${PORT}/mine/`);
  await sleep(500);
  await c.ev(`document.getElementById('btn-new').click()`);
  await sleep(900);
  await c.ev(`document.getElementById('btn-back').click()`);
  await sleep(900);
  chk('从教程库进来的，返回回教程库', /\/mine\//.test(await c.ev(`location.pathname`)),
      '落在 ' + await c.ev(`location.pathname`));

  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(600);
  chk('顶栏另有一个主页键', await c.ev(`!!document.getElementById('btn-home2')`));

  // ⑥ 离开的逻辑：没改动就别拦人
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(700);
  await c.ev(`document.getElementById('btn-back').click()`);
  await sleep(900);
  const wentStraight = await c.ev(`location.pathname`);
  // 判据是"离开了写作页"，不是"落在某个固定页面"——落在哪由来源决定
  chk('什么都没改时，点返回直接走（不弹任何东西）', !/\/w\//.test(wentStraight), '落在 ' + wentStraight);

  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(700);
  await c.ev(`(() => { const t = document.getElementById('title');
    t.value = '改了点东西'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await c.ev(`document.getElementById('btn-back').click()`);
  await sleep(500);
  const lv = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('dlg-leave').open,
    path: location.pathname,
    save: document.getElementById('lv-save').textContent.trim(),
    drop: document.getElementById('lv-drop').textContent.trim(),
    stay: document.getElementById('lv-stay').textContent.trim()
  })`));
  chk('改过东西时，点返回弹三选一', lv.open === true && /\/w\//.test(lv.path),
      `${lv.save} / ${lv.drop} / ${lv.stay}`);
  chk('三个出口都说人话', /保存/.test(lv.save) && /不保存|放弃/.test(lv.drop) && /留下/.test(lv.stay));

  await c.ev(`document.getElementById('lv-drop').click()`);
  await sleep(1000);
  chk('选「不保存直接离开」真的走了', !/\/w\//.test(await c.ev(`location.pathname`)),
      '落在 ' + await c.ev(`location.pathname`));

  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(1000);
  chk('丢弃后不会再被问「要不要接着上次的」', (await c.ev(`window.SGWriter.draft.steps.length`)) === 0);

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
