// 「真实页面方案对比图」：在真站上注入几套 CSS 各截一张，横向拼成一张大图让用户挑。
// 用法见 README「方案对比图」一节。2026-09-17 从日程卡片（过期样式三选一）的临时脚本抽出——第二次用到。
const { open, sleep } = require('./cdp.js');
const fs = require('fs'), path = require('path');

/**
 * @param {object} o
 *   url       被测页面
 *   variants  [{key, label, css, url}]，第一项建议是 {key:'cur', label:'现在', css:''} 作对照
 *             v.url 可以单独指定这一档的地址（方案由 URL 参数/不同页面驱动时用，不只靠注入 CSS）
 *   prepare   可选，每次 goto 前在页面里跑的 JS（比如写 localStorage 造数据）。会先 goto 一次再跑、再重新 goto
 *   after     可选，注入 CSS 之后跑的 JS（比如给目标元素挂 class；注意页面脚本若包在 IIFE 里，全局函数是拿不到的）
 *   width/height/scale  视口，默认 390×844@2
 *   out       输出目录；单张存 <name>-<key>.png，拼图存 对比-<name>.png
 *   name      这组图的名字
 *   dark      拼图底色用深色（深色主题的截图配深底才看得准）
 */
async function compare(o) {
  const w = o.width || 390, h = o.height || 844;
  fs.mkdirSync(o.out, { recursive: true });
  const c = await open(w, h, o.scale || 2);
  const files = [];
  try {
    if (o.prepare) { await c.goto(o.url); await c.ev(o.prepare); }
    for (const v of o.variants) {
      await c.goto(v.url || o.url);
      await c.ev(`(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(v.css || '')};document.head.appendChild(s);window.scrollTo(0,0);return 1})()`);
      if (o.after) await c.ev(o.after);
      await sleep(400);
      const f = path.join(o.out, `${o.name}-${v.key}.png`);
      await c.vshot(f);            // 只截视口：整页长图 × DPR 会吃光内存（见 README 坑 6）
      files.push(f);
    }
    if (c.errors.length) console.warn('页面 JS 异常：', c.errors);
  } finally { c.close(); }
  return stitch(files, o.variants.map(v => v.label), path.join(o.out, `对比-${o.name}.png`), o.dark, w);
}

/* 横向拼图：每列一个标题 + 一张截图。拼图页 DPR=1，否则图太大 */
async function stitch(files, labels, outFile, dark, colW) {
  colW = colW || 390;
  const gap = 16, W = files.length * (colW + gap) + gap;
  const g = await open(W, 900, 1);
  try {
    const cols = files.map((f, i) => `<div><h3>${labels[i]}</h3><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"></div>`).join('');
    const html = `<style>body{margin:0;background:${dark ? '#0e1013' : '#cfd5dc'};color:${dark ? '#eee' : '#111'};font:700 22px sans-serif}
      .w{display:flex;gap:${gap}px;padding:12px ${gap}px}.w div{width:${colW}px}h3{margin:0 0 8px}img{width:${colW}px;display:block;border-radius:8px}</style><div class="w">${cols}</div>`;
    await g.goto('about:blank');
    await g.ev(`document.open();document.write(${JSON.stringify(html)});document.close();1`);
    await sleep(500);
    const hgt = await g.ev('document.body.scrollHeight');
    await g.send('Emulation.setDeviceMetricsOverride', { width: W, height: hgt, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await g.vshot(outFile);
  } finally { g.close(); }
  return outFile;
}

module.exports = { compare, stitch };
