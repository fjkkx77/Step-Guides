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
  chk('换图三条路都在（选文件/剪贴板/粘贴框）', sw.filePick && sw.clip && sw.box);

  // 用粘贴换图：往粘贴框里派发一个带文件的 paste
  const swapped = await c.ev(`(async () => {
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

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
