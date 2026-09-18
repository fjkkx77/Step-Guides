/* 验二维码搬设置这条链路：
   ① base64url 编解码能往返（含长 token）
   ② 生成的码用浏览器自带的 BarcodeDetector 真解一次，看解出来的字符串对不对
   ③ 解出来的 URL 走 importFromHash 的同一套解析，能还原出原设置 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;

const FAKE = 'github_pat_11ABCDEFG0' + 'x'.repeat(59) + 'Z9';  // 长度照真 token 造的假串

(async () => {
  const c = await open(900, 900, 1);
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(600);
  // jsQR 是另一套独立写的解码器（Apache-2.0），只在验证时注入，不进产品页面：
  // 用生成器自己验自己没有意义，必须拿独立实现交叉验
  await c.ev(require('fs').readFileSync(__dirname + '/vendor/jsqr.js', 'utf8'));

  const r = await c.ev(`(async () => {
    const out = {};
    const W = window.SGWriter;
    const payload = JSON.stringify({ o:'fjkkx77', r:'Step-Guides', b:'main', t:${JSON.stringify(FAKE)} });

    // ① 往返
    out.roundtrip = W.unb64url(W.b64url(payload)) === payload;
    out.payloadLen = payload.length;

    // ② 出码并用 BarcodeDetector 解
    const url = 'https://fjkkx77.github.io/Step-Guides/w/#cfg=' + W.b64url(payload);
    out.urlLen = url.length;
    const qr = qrcode(0, 'L'); qr.addData(url); qr.make();
    out.modules = qr.getModuleCount();
    // 用产品里真正会用的那张图（cellSize 6, margin 2）去解，参数跟线上一致
    const img = new Image();
    img.src = qr.createDataURL(6, 2);
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    out.imgSize = cv.width + 'x' + cv.height;
    const got = jsQR(px.data, px.width, px.height);
    out.decoded = got ? got.data : null;
    out.decodeMatch = out.decoded === url;
    if (out.decoded) {
      const back = JSON.parse(W.unb64url(/#cfg=(.+)$/.exec(out.decoded)[1]));
      out.tokenBack = back.t === ${JSON.stringify(FAKE)};
      out.ownerBack = back.o === 'fjkkx77';
    }
    return JSON.stringify(out);
  })()`);
  await c.close();

  const o = JSON.parse(r);
  const chk = (n, ok, d) => console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`);
  chk('base64url 往返', o.roundtrip, `载荷 ${o.payloadLen} 字符，URL ${o.urlLen} 字符`);
  chk('码的尺寸合理（≤ 57 格，手机好扫）', o.modules <= 57, o.modules + '×' + o.modules);
  chk('独立解码器 jsQR 解出来一字不差', o.decodeMatch, o.decoded ? o.imgSize + ' 像素' : '没解出来');
  chk('还原出的 token 与原串一致', o.tokenBack);
  chk('还原出的用户名一致', o.ownerBack);

  // ④⑤ 扫码之后那一半：真的带着 #cfg 打开一次页面
  const c2 = await open(390, 844, 2);
  const payload = JSON.stringify({ o: 'fjkkx77', r: 'Step-Guides', b: 'main', t: FAKE });
  const b64 = Buffer.from(payload, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await c2.goto(`http://127.0.0.1:${PORT}/w/#cfg=${b64}`);
  await sleep(900);
  const before = JSON.parse(await c2.ev(`JSON.stringify({
    dialogOpen: document.getElementById('dlg-import').open,
    shown: document.getElementById('imp-kv').textContent,
    hash: location.hash,
    saved: localStorage.getItem('sg.cfg')
  })`));
  chk('扫码进来弹出确认框', before.dialogOpen === true);
  chk('确认框里 token 是打码的', before.shown.includes('…') && !before.shown.includes(FAKE),
      before.shown.replace(/\s+/g, ' ').slice(0, 60));
  chk('地址栏里的 token 立刻被抹掉', before.hash === '', '当前 hash="' + before.hash + '"');
  chk('没点确认之前不写入设置', !before.saved || !before.saved.includes(FAKE));

  await c2.ev(`document.getElementById('btn-imp-yes').click()`);
  await sleep(400);
  const after = JSON.parse(await c2.ev(`JSON.stringify({ saved: localStorage.getItem('sg.cfg') })`));
  const cfg = JSON.parse(after.saved || '{}');
  chk('点了导入才写进这台设备', cfg.token === FAKE && cfg.owner === 'fjkkx77' && cfg.repo === 'Step-Guides');
  await c2.close();

  process.exit(o.decodeMatch && o.tokenBack && cfg.token === FAKE ? 0 : 1);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
