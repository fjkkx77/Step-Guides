/* 手机端粘贴入口的验证。
   手机没有 Ctrl+V，只能靠两条路，两条都要测：
     ① paste 事件里带 File（安卓多半是这样）
     ② 浏览器直接把 <img> 塞进可编辑框里，事件里没有 File（iOS 有时这样）
   另外验一下这个框不能被当成打字框用（打进去的字要被清掉）。 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;

(async () => {
  const c = await open(390, 844, 2);
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(800);

  const r = await c.ev(`(async () => {
    const out = {};
    const box = document.getElementById('pastebox');
    out.boxExists = !!box;
    out.editable = box.isContentEditable;
    out.hint = box.getAttribute('data-ph') || '';
    out.clipBtn = !!document.getElementById('btn-clip');
    const tap = document.getElementById('btn-clip').getBoundingClientRect();
    out.clipTap = Math.min(tap.width, tap.height);

    const sample = await fetch('../t/qhftq5kz/i/01.webp').then(r => r.blob());

    // ① paste 事件带 File
    const dt = new DataTransfer();
    dt.items.add(new File([sample], 'shot.webp', { type: 'image/webp' }));
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 700));
    out.afterFilePaste = window.SGWriter.draft.steps.length;

    // ② 事件里没有 File，浏览器把 <img> 塞进框里（iOS 那种）
    const url = URL.createObjectURL(sample);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    const im = document.createElement('img');
    im.src = url;
    box.appendChild(im);
    await new Promise(r => setTimeout(r, 900));
    out.afterImgPaste = window.SGWriter.draft.steps.length;
    out.boxCleared = box.querySelectorAll('img').length === 0;

    // ③ 当打字框用：字要被清掉，别让它变成一个能写字的地方
    box.textContent = '随便打点字';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    out.textCleared = box.textContent === '';

    return JSON.stringify(out);
  })()`);
  await c.close();

  const o = JSON.parse(r);
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  chk('粘贴框存在且可长按选中', o.boxExists && o.editable, o.hint);
  chk('有「粘贴图片」按钮且热区 ≥44px', o.clipBtn && o.clipTap >= 44, Math.round(o.clipTap) + 'px');
  chk('① 剪贴板里带文件 -> 加成一步', o.afterFilePaste === 1, '步数 ' + o.afterFilePaste);
  chk('② 只塞进 <img>（iOS 那种）也能接住', o.afterImgPaste === 2, '步数 ' + o.afterImgPaste);
  chk('粘完把框清空', o.boxCleared);
  chk('当打字框用会被清掉', o.textCleared);
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
