/* 扫码链路的验证——不碰摄像头。
   2026-09-18：原先想用 Chrome 的「假摄像头」参数做端到端测试，结果那个参数没生效，
   打开的是用户的真摄像头。教训：**任何会申请摄像头/麦克风的自动化测试一律不跑**。
   这里改成把静态二维码图片喂给「扫码时真正用的那个解码函数」，验的是：
     解码器选取 -> 解码 -> 从链接里扒载荷 -> 弹出导入确认 -> 确认后写入
   摄像头本身能不能打开、扫得顺不顺，由用户在真机上确认（那才是这功能的实际运行环境）。 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const FAKE = 'github_pat_11SCANTEST' + 'y'.repeat(59) + 'Q7';

(async () => {
  const c = await open(390, 844, 2);
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await sleep(800);

  const payload = JSON.stringify({ o: 'fjkkx77', r: 'Step-Guides', b: 'main', t: FAKE });
  const r = await c.ev(`(async () => {
    const out = {};
    const W = window.SGWriter;
    const url = 'https://fjkkx77.github.io/Step-Guides/w/#cfg=' + W.b64url(${JSON.stringify(payload)});

    // 1) 取扫码时真正会用的那个解码函数（BarcodeDetector 或按需加载的 jsQR）
    const decode = await W.ensureDecoder();
    out.decoderReady = typeof decode === 'function';
    out.usedJsQR = !!window.jsQR;      // 这台机器没有 BarcodeDetector，应该落到 jsQR

    // 2) 画一张码，按扫码循环里的同款尺寸（缩到 480 宽）喂给它
    const qr = qrcode(0, 'L'); qr.addData(url); qr.make();
    const img = new Image(); img.src = qr.createDataURL(6, 2); await img.decode();
    const cv = document.createElement('canvas');
    const k = Math.min(1, 480 / img.naturalWidth);
    cv.width = Math.round(img.naturalWidth * k);
    cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, cv.width, cv.height);
    out.frame = cv.width + 'x' + cv.height;
    const text = await decode(cv);
    out.decoded = text === url;

    // 3) 从解出来的串里扒载荷，走和扫到码之后一模一样的那条路
    const raw = W.cfgFromUrl(text);
    out.rawOk = !!raw;
    W.askImport(raw);
    await new Promise(r => setTimeout(r, 200));
    out.dlgOpen = document.getElementById('dlg-import').open;
    out.kv = document.getElementById('imp-kv').textContent;
    out.masked = out.kv.includes('…') && !out.kv.includes(${JSON.stringify(FAKE)});

    // 4) 确认后才写入
    document.getElementById('btn-imp-yes').click();
    await new Promise(r => setTimeout(r, 200));
    out.saved = localStorage.getItem('sg.cfg');

    // 5) 扫到别的码（不是本站设置码）不应该误导入
    out.strangerIgnored = W.cfgFromUrl('https://example.com/hello') === null;
    return JSON.stringify(out);
  })()`);
  await c.close();

  const o = JSON.parse(r);
  const saved = JSON.parse(o.saved || '{}');
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  chk('解码器就绪', o.decoderReady, o.usedJsQR ? '这台机器没有 BarcodeDetector，落到 jsQR（iOS 走的也是这条）' : '用的 BarcodeDetector');
  chk('按扫码时的尺寸能解出来', o.decoded, o.frame + ' 像素');
  chk('能从链接里扒出载荷', o.rawOk);
  chk('弹出导入确认', o.dlgOpen === true);
  chk('确认框里 token 是打码的', o.masked, o.kv.replace(/\s+/g, ' ').slice(0, 52));
  chk('确认后写入这台设备', saved.token === FAKE && saved.owner === 'fjkkx77');
  chk('扫到无关的码不会误导入', o.strangerIgnored);
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过（摄像头本身需用户在真机确认）');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
