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
  // 子路径部署时相对路径最容易出错：CSS 没加载页面照样"能看"，但布局全错。
  // 判据要挑「两种模式下都成立」的信号——早先拿 .deck 的 display==='flex' 当判据，
  // 结果长文模式本来就是 block，误报了一轮。
  assetsOk: `(() => {
      const base = getComputedStyle(document.documentElement).getPropertyValue('--tap').trim();
      const badge = document.querySelector('.badge');
      const radius = badge ? getComputedStyle(badge).borderRadius : '';
      return {
        baseCss: base !== '',                                  // base.css 里的变量
        readerCss: !!radius && radius !== '0px',               // reader.css 给 .badge 的圆角
        jsRan: !!document.querySelector('.page')
      };
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
    // 别用固定 sleep 当"页面好了"：本地秒开、线上要等 data.json，
    // 800ms 在线上会把"还没渲染完"误判成"渲染不出来"（2026-09-19 踩过）
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (await c.ev(`!!document.querySelector('.page')`)) { ready = true; break; }
    }
    if (!ready) console.log('   （等了 10 秒仍没渲染出步骤，下面的断言会照实报 FAIL）');
    await sleep(300);

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
      chk('base.css 真的加载了', out.assetsOk.baseCss, JSON.stringify(out.assetsOk));
      chk('reader.css 真的加载了', out.assetsOk.readerCss, '');
      chk('JS 真的跑了（渲染出步骤）', out.assetsOk.jsRan, '');
    }
    if (out.minTap != null) chk('触摸目标 ≥44px', out.minTap >= 44, '最小 ' + Math.round(out.minTap) + 'px');
    if (out.sameScreen) {
      const s = out.sameScreen;
      chk('图与文字同屏（最差步）', s.inPage,
          `第 ${s.step} 步：图 ${s.imgW}×${s.imgH} / 文字 ${s.sayH}px${s.overlay ? '（浮层）' : ''}`);
      // 阈值按屏高分档：1:2.2 的竖屏截图 + 文字块 + 上下栏，在 600px 高以下
      // 几何上就拿不到 55%（除非把文字改成浮在图上，但那个形态已被否掉——
      // 用户反馈「割裂、挡图」，移动端标准也是"压尺寸不换形态"）。
      // 主流机型（≥700 高）仍按 55% 要求。
      const want = h >= 700 ? 0.55 : 0.46;
      chk(`最差步图宽 ≥ 屏宽 ${Math.round(want * 100)}%`, s.imgW >= w * want,
          `第 ${s.step} 步 ${s.imgW}px vs ${Math.round(w * want)}px（屏高 ${h}）`);
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
