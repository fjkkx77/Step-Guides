/* 写作页的窄屏验证：灌进 3 张真实截图再量，空页面量不出真问题 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const WIDTHS = [320, 390, 430];
const HEIGHT = { 320: 568, 390: 844, 430: 932 };

const FILL = `(async () => {
  const names = ['01.webp','04.webp','09.webp'];
  const files = [];
  for (const n of names) {
    const b = await fetch('../t/demo/i/' + n).then(r => r.blob());
    files.push(new File([b], n, { type: b.type }));
  }
  await window.SGWriter.addFiles(files);
  const ta = document.querySelectorAll('.stext');
  ta[1].value = '① 在方框里打上名字（比如你的名字）；② 挑一个喜欢的颜色；③ 再挑一个图标。都选好以后，最下面灰色的「下一步」会变成可以点的。';
  ta[1].dispatchEvent(new Event('input', { bubbles: true }));
  return document.querySelectorAll('.step').length;
})()`;

const MEASURE = `(() => {
  const btns = [...document.querySelectorAll('button, .addbtn, .handle')].filter(b => b.offsetParent !== null);
  const minTap = Math.min(...btns.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  const fields = [...document.querySelectorAll('input, textarea')].filter(b => b.offsetParent !== null);
  const minFont = Math.min(...fields.map(f => parseFloat(getComputedStyle(f).fontSize)));
  // 有没有元素横向捅出屏幕
  let over = null;
  document.querySelectorAll('*').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width && r.right > innerWidth + 1 && !over) over = n.className || n.tagName;
  });
  return { minTap: Math.round(minTap), minFont, over,
           scrollW: document.documentElement.scrollWidth, vw: innerWidth };
})()`;

(async () => {
  let bad = 0;
  for (const w of WIDTHS) {
    const h = HEIGHT[w] || 844;
    const c = await open(w, h, 2);
    await c.goto(`http://127.0.0.1:${PORT}/w/`);
    await sleep(600);
    const n = await c.ev(FILL);
    await sleep(400);
    const m = await c.ev(MEASURE);
    const lines = [];
    const chk = (name, pass, d) => { lines.push(`${pass ? 'PASS' : 'FAIL'} ${name}${d ? ' — ' + d : ''}`); if (!pass) bad++; };
    chk('灌入 3 步', n === 3, '实际 ' + n);
    chk('布局视口 = ' + w, m.vw === w, '实际 ' + m.vw);
    chk('无横向溢出', m.scrollW <= w + 1, `scrollWidth=${m.scrollW}`);
    chk('没有元素捅出屏幕', !m.over, String(m.over));
    chk('可点元素 ≥44px', m.minTap >= 44, '最小 ' + m.minTap + 'px');
    chk('输入框字号 ≥16px（否则 iOS 会放大整页）', m.minFont >= 16, m.minFont + 'px');
    console.log(`\n── ${w}×${h} /w/`);
    lines.forEach(l => console.log('   ' + l));
    require('fs').mkdirSync('shots', { recursive: true });
    await c.vshot(`shots/w${w}.png`);
    await c.close();
  }
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
