/* 发布用的图清不清楚（2026-10-10 用户问"清晰度有没有保证"）。守三件事：
   ① 截图走无损：编出来再解回去，逐像素和原图一样
   ② 电脑整屏截图（宽 2560）不再被缩；更宽的才缩到 2560；手机竖屏截图不缩；永远不放大
   ③ 无损装不下（照片）才走有损；不能出 WebP 的浏览器（Safari）截图走 PNG、照片走 JPEG
   旧版（宽度压到 1440 + 有损 0.85）跑这个脚本必须 FAIL。
   用法：node tools/verify-img.js [--base=http://127.0.0.1:端口] */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const url = (BASE ? BASE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`) + '/w/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };

// 页面里造图：像界面截图的（大色块 + 细线 + 彩色字）、像照片的（每个像素都是随机色，无损压不动）
const LIB = `window.__I = (() => {
  const shot = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.fillStyle = '#F2F2F7'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.fillRect(w * .05, h * .1, w * .9, h * .3);
    x.strokeStyle = '#E0483D'; x.lineWidth = 3; x.strokeRect(w * .1 + .5, h * .15 + .5, w * .4, h * .12);
    x.fillStyle = '#5B57D8'; x.font = Math.round(h * .03) + 'px sans-serif'; x.fillText('Settings 设置专注模式 12:34', w * .12, h * .22);
    x.fillStyle = '#1C1C1E'; for (let i = 0; i < 12; i++) x.fillRect(w * .1, h * (.5 + i * .03), w * (.3 + (i % 4) * .1), 2);
    return c; };
  const photo = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const d = x.createImageData(w, h);
    for (let i = 0; i < d.data.length; i += 65536) crypto.getRandomValues(d.data.subarray(i, Math.min(d.data.length, i + 65536)));   // 一次最多取 65536 字节
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
    x.putImageData(d, 0, 0); return c; };
  const blobOf = c => new Promise(r => c.toBlob(r, 'image/png'));
  // 跑一遍 compress，再把结果解回来和"按同样尺寸画出来的原图"逐像素比
  const run = async (canvas) => {
    const out = await SGImg.compress(await blobOf(canvas));
    const back = await createImageBitmap(out.blob);
    let same = null;
    if (!out.scaled) {
      const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const c2 = document.createElement('canvas'); c2.width = back.width; c2.height = back.height;
      const x2 = c2.getContext('2d'); x2.drawImage(back, 0, 0);
      const b = x2.getImageData(0, 0, back.width, back.height).data;
      let diff = 0; if (a.length === b.length) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++; } else diff = -1;
      same = diff;
    }
    return { w: out.w, h: out.h, bw: back.width, bh: back.height, ext: out.ext, type: out.blob.type, kb: Math.round(out.blob.size / 1024),
             scaled: out.scaled, lossless: out.lossless === true, diff: same };
  };
  return { shot, photo, run };
})(), true`;

(async () => {
  /* ── 能出 WebP 的浏览器（Chrome / Edge / 安卓） ─────────── */
  let c = await open(1280, 800, 1);
  try {
    await c.goto(url);
    await sleep(600);
    await c.ev(LIB);
    const r = JSON.parse(await c.ev(`(async () => JSON.stringify({
      desk: await __I.run(__I.shot(2560, 1440)),
      phone: await __I.run(__I.shot(1290, 2796)),
      uhd: await __I.run(__I.shot(3840, 2160)),
      small: await __I.run(__I.shot(412, 915)),
      photo: await __I.run(__I.photo(1200, 1600)),
      max: SGImg.LOSSLESS_MAX
    }))()`));
    chk('电脑整屏截图 2560 宽：不缩', r.desk.w === 2560 && r.desk.h === 1440 && !r.desk.scaled, `${r.desk.w}×${r.desk.h}`);
    chk('电脑截图：无损（解回来 0 个像素分量不同）', r.desk.lossless && r.desk.diff === 0, `不同 ${r.desk.diff} 个，${r.desk.kb}KB，.${r.desk.ext}`);
    chk('手机竖屏截图 1290×2796：不缩、无损', r.phone.w === 1290 && r.phone.lossless && r.phone.diff === 0, `${r.phone.w}×${r.phone.h}，不同 ${r.phone.diff} 个，${r.phone.kb}KB`);
    chk('4K 截图 3840 宽：缩到 2560（比例不变）', r.uhd.w === 2560 && r.uhd.h === 1440 && r.uhd.scaled, `${r.uhd.w}×${r.uhd.h}`);
    chk('小图 412 宽：绝不放大', r.small.w === 412 && r.small.bw === 412 && r.small.diff === 0, `${r.small.w}×${r.small.h}`);
    chk('记下的宽高和文件实际宽高一致', [r.desk, r.phone, r.uhd, r.small, r.photo].every(o => o.w === o.bw && o.h === o.bh));
    chk('照片（无损装不下）：走有损 WebP', !r.photo.lossless && r.photo.ext === 'webp' && r.photo.type === 'image/webp',
        `${r.photo.kb}KB，.${r.photo.ext}，无损上限 ${Math.round(r.max / 1024)}KB`);
    const tag = JSON.parse(await c.ev(`(async () => { const cv = __I.shot(300, 200);
      const b1 = await new Promise(r => cv.toBlob(r, 'image/webp', 1)), b2 = await new Promise(r => cv.toBlob(r, 'image/webp', 0.9));
      return JSON.stringify({ a: await SGImg.isLosslessWebp(b1), b: await SGImg.isLosslessWebp(b2), c: await SGImg.isLosslessWebp(new Blob(['not an image'])) }); })()`));
    chk('能认出一个 WebP 是无损还是有损（看文件里的块，不靠猜）', tag.a === true && tag.b === false && tag.c === false, JSON.stringify(tag));
    chk('没有脚本报错', c.errors.length === 0, c.errors.join(' | '));
  } finally { c.close(); }

  /* ── 出不了 WebP 的浏览器（Safari）：把 canvas 的 WebP 导出掐掉来模拟 ───
     Safari 的表现是：要 WebP 却给回 PNG。这里照这个行为打桩 */
  c = await open(390, 844, 2);
  try {
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const tb = HTMLCanvasElement.prototype.toBlob, tu = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toBlob = function (cb, type, q) { return tb.call(this, cb, type === 'image/webp' ? 'image/png' : type, q); };
      HTMLCanvasElement.prototype.toDataURL = function (type, q) { return tu.call(this, type === 'image/webp' ? 'image/png' : type, q); };
    })()` });
    await c.goto(url);
    await sleep(600);
    await c.ev(LIB);
    const r = JSON.parse(await c.ev(`(async () => JSON.stringify({
      webp: SGImg.supportsWebp(),
      phone: await __I.run(__I.shot(1290, 2796)),
      photo: await __I.run(__I.photo(1200, 1600))
    }))()`));
    chk('（模拟 Safari）确实出不了 WebP', r.webp === false);
    chk('（模拟 Safari）截图走 PNG：无损、不缩', r.phone.ext === 'png' && r.phone.type === 'image/png' && r.phone.lossless && r.phone.diff === 0 && r.phone.w === 1290,
        `.${r.phone.ext}，${r.phone.kb}KB，不同 ${r.phone.diff} 个`);
    chk('（模拟 Safari）照片走 JPEG', r.photo.ext === 'jpg' && r.photo.type === 'image/jpeg' && !r.photo.lossless, `.${r.photo.ext}，${r.photo.kb}KB`);
    chk('（模拟 Safari）没有脚本报错', c.errors.length === 0, c.errors.join(' | '));
  } finally { c.close(); }

  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
