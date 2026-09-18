/* 真实窄屏视口验证（不是注入 CSS 假装断点）
   用法：node tools/verify.js [站内路径] [--shots] [--mode=long]
   默认跑 320 / 390 / 430 三档，逐条打印断言 */
const { open, sleep } = require('./cdp.js');
const fs = require('fs');
const PORT = 8879;
const WIDTHS = [320, 390, 430];
const HEIGHT = { 320: 568, 390: 844, 430: 932 };   // 各档常见的真实高度

let page = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 't/qhftq5kz/';
// Git Bash 会把以 / 开头的参数改写成 Windows 路径，统一按「相对站点根」处理
page = '/' + String(page).replace(/^[A-Za-z]:.*?[\\/](?=t\/|w\/|mine\/|$)/, '').replace(/^\/+/, '');
const SHOTS = process.argv.includes('--shots');
// --base=https://user.github.io/Repo/ 可以直接验线上（子路径部署很容易出相对路径问题）
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '').split('=')[1] || '';

const SAME_SCREEN = `(async () => {
  const pages = [...document.querySelectorAll('.page')];
  if (!pages.length) return null;
  // 懒加载的图不量不准：先全部转 eager 再等解码
  const imgs = [...document.querySelectorAll('.shot img')];
  imgs.forEach(i => i.loading = 'eager');
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  let worst = null;
  for (const p of pages) {
    const img = p.querySelector('.shot img'), say = p.querySelector('.say');
    const ri = img.getBoundingClientRect(), rs = say.getBoundingClientRect(), rp = p.getBoundingClientRect();
    const overlay = getComputedStyle(say).position === 'absolute';
    const cover = overlay
      ? Math.max(0, Math.min(ri.bottom, rs.bottom) - Math.max(ri.top, rs.top)) / ri.height
      : 0;
    const rec = {
      step: +p.dataset.i + 1,
      imgW: Math.round(ri.width), imgH: Math.round(ri.height),
      sayH: Math.round(rs.height), overlay, cover: Math.round(cover * 100),
      inPage: ri.top >= rp.top - 1 && ri.bottom <= rp.bottom + 1 && rs.bottom <= rp.bottom + 1
    };
    if (!worst || rec.imgW < worst.imgW) worst = rec;
  }
  return worst;
})()`;

const probes = {
  viewport: 'innerWidth',                                   // 没 viewport meta 的话这里会是 980
  scrollWidth: 'document.documentElement.scrollWidth',      // 横向溢出
  bodyFont: 'parseFloat(getComputedStyle(document.body).fontSize)',
  minTap: `(() => {
      const bs = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      if (!bs.length) return null;
      return Math.min(...bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    })()`,
  sameScreen: SAME_SCREEN,
  // 子路径部署时相对路径最容易出错：CSS 没加载页面照样"能看"，但布局全错
  assetsOk: `(() => {
      const styled = getComputedStyle(document.querySelector('.deck') || document.body).display === 'flex';
      const jsRan = !!document.querySelector('.page');
      return { styled, jsRan };
    })()`
};

(async () => {
  let bad = 0;
  for (const w of WIDTHS) {
    const h = HEIGHT[w] || 844;
    const c = await open(w, h, 2);
    const target = BASE ? BASE.replace(/\/$/, '') + page : `http://127.0.0.1:${PORT}${page}`;
    await c.goto(target);
    if (MODE) {
      await c.ev(`localStorage.setItem('sg.readMode', ${JSON.stringify(MODE)})`);
      await c.goto(target);
    }
    await sleep(800);

    const out = {};
    for (const [k, expr] of Object.entries(probes)) out[k] = await c.ev(expr);

    const lines = [];
    const chk = (name, pass, detail) => {
      lines.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
      if (!pass) bad++;
    };
    chk('布局视口 = ' + w, out.viewport === w, '实际 ' + out.viewport);
    chk('无横向溢出', out.scrollWidth <= w + 1, `scrollWidth=${out.scrollWidth}`);
    chk('正文 ≥16px', out.bodyFont >= 16, out.bodyFont + 'px');
    if (out.assetsOk) {
      chk('CSS 真的加载了', out.assetsOk.styled, JSON.stringify(out.assetsOk));
      chk('JS 真的跑了（渲染出步骤）', out.assetsOk.jsRan, '');
    }
    if (out.minTap != null) chk('触摸目标 ≥44px', out.minTap >= 44, '最小 ' + Math.round(out.minTap) + 'px');
    if (out.sameScreen) {
      const s = out.sameScreen;
      chk('图与文字同屏（最差步）', s.inPage,
          `第 ${s.step} 步：图 ${s.imgW}×${s.imgH} / 文字 ${s.sayH}px${s.overlay ? '（浮层）' : ''}`);
      chk('最差步图宽 ≥ 屏宽 55%', s.imgW >= w * 0.55, `第 ${s.step} 步 ${s.imgW}px vs ${Math.round(w * 0.55)}px`);
      if (s.overlay) chk('浮层遮挡 ≤ 图高 35%', s.cover <= 35, s.cover + '%');
    }
    console.log(`\n── ${w}×${h} ${page}${MODE ? ' [' + MODE + ']' : ''}`);
    lines.forEach(l => console.log('   ' + l));

    if (SHOTS) {
      fs.mkdirSync('shots', { recursive: true });
      await c.vshot(`shots/v${w}${MODE ? '-' + MODE : ''}.png`);
    }
    await c.close();
  }
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
