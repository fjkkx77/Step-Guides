/* 2026-10-16 阅读页「沉浸感」改版的回归测试：
   ① 逐步模式：文字在截图上面；「第 N 步」小标签 + 大标题（不再显示圆圈序号）；主按钮「做好了，下一步」先打勾再翻页
   ② 封面：第一次打开出「开始第 1 步」；有阅读记录时出「继续第 N 步」+「从头开始」；矮屏上按钮在屏内
   ③ 最后一步 → 完成页
   ④ 长文模式：每步标题在截图上面、吸顶挂在顶栏下面；看过的步骤标 past；步与步之间的空白明显大于步内间距
   ⑤ 「目录」里的「长文只亮当前步」开关：默认关、打开后非当前步变淡、刷新后还记得
   每个视口都查无横向溢出。
   用法：node tools/verify-immersion.js [--base=https://jc.wbztl.xyz]（默认本地 8879，由 run-all 起服务） */
const { open, sleep } = require('./cdp.js');
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const ROOT = BASE ? BASE.replace(/\/$/, '') : 'http://127.0.0.1:8879';
const T = ROOT + '/t/qhftq5kz/';
const POS = 'sg.pos:/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };
const J = async (c, expr) => JSON.parse(await c.ev(`JSON.stringify(${expr})`));

async function fresh(c, mode, pos) {
  await c.goto(T);
  await c.ev(`localStorage.clear();localStorage.setItem('sg.readMode','${mode}');` +
    (pos ? `localStorage.setItem('${POS}',JSON.stringify({i:${pos},t:Date.now()}));` : '') + '1');
  await c.goto(T);
  await waitFor(c, `document.querySelectorAll('.page').length > 1 && !!document.querySelector('.pv.cover.on')`, 16);
}
// 没有封面（旧版）时什么也不做，让后面各项照常跑、各自报对错
const startCover = async c => { await c.ev(`(() => { const b = document.querySelector('.pv.cover .pv-go'); if (b) b.click(); })()`); await sleep(500); };

async function phone(w, h) {
  const L = `${w}×${h}`;
  const c = await open(w, h, 2);
  try {
    // ── ② 封面（第一次打开）
    await fresh(c, 'step');
    const cov = await J(c, `(() => { const o = document.querySelector('.pv.cover'), b = o && o.querySelector('.pv-go');
      const r = b && b.getBoundingClientRect();
      return { open: !!o, t: b && b.textContent, inView: !!r && r.bottom <= innerHeight + 1 && r.top >= 0, h: r ? r.height : 0,
        rows: o ? o.querySelectorAll('.pv-road li').length : 0, sw: document.documentElement.scrollWidth }; })()`);
    chk(`${L} 一打开先出封面，「开始第 1 步」在屏内、≥44 高`, cov.open && /开始第 1 步/.test(cov.t) && cov.inView && cov.h >= 44, JSON.stringify(cov));
    chk(`${L} 封面路线图只露 5 步 +「还有 N 步」`, cov.rows === 6, `${cov.rows} 行`);
    chk(`${L} 封面无横向溢出`, cov.sw <= w, `${cov.sw}/${w}`);
    await startCover(c);
    chk(`${L} 点「开始」封面收起`, !(await c.ev(`!!document.querySelector('.pv.cover')`)));

    // ── ① 逐步模式版式
    const g = await J(c, `(() => { const p = document.querySelector('.page[data-i="0"]');
      const R = s => p.querySelector(s).getBoundingClientRect();
      return { sayB: R('.say').bottom, imgT: R('.shot img').top, imgW: R('.shot img').width,
        kicker: p.querySelector('.kicker') ? getComputedStyle(p.querySelector('.kicker')).display : 'none', kickerT: (p.querySelector('.kicker') || {}).textContent,
        badge: getComputedStyle(p.querySelector('.badge')).display,
        h2: parseFloat(getComputedStyle(p.querySelector('.say h2')).fontSize),
        next: document.getElementById('next').textContent.trim(),
        nextBg: getComputedStyle(document.getElementById('next')).backgroundColor,
        sw: document.documentElement.scrollWidth }; })()`);
    chk(`${L} 逐步模式：文字在截图上面`, g.sayB <= g.imgT + 1, `文字底 ${Math.round(g.sayB)} / 图顶 ${Math.round(g.imgT)}`);
    chk(`${L} 「第 1 步」小标签显示、圆圈序号隐藏`, g.kicker !== 'none' && g.kickerT === '第 1 步' && g.badge === 'none', `${g.kicker}/${g.badge}`);
    chk(`${L} 步骤标题是大标题（≥22px）`, g.h2 >= 22, `${g.h2}px`);
    chk(`${L} 主按钮「做好了，下一步」，实心底色`, /做好了/.test(g.next) && !/rgba\(0, 0, 0, 0\)|transparent/.test(g.nextBg), `${g.next} ${g.nextBg}`);
    chk(`${L} 逐步模式无横向溢出`, g.sw <= w, `${g.sw}/${w}`);
    // 截图宽度下限：跟 verify.js 同一套分档（屏高 ≥700 要 55%，更矮的 46%）
    const want = h >= 700 ? 0.55 : 0.46;
    chk(`${L} 截图不被挤得太窄（≥ 屏宽 ${Math.round(want * 100)}%）`, g.imgW >= w * want, `${Math.round(g.imgW)}px`);

    // 点「做好了」：先打勾、再翻页
    await c.ev(`document.getElementById('next').click()`); await sleep(80);
    const mid = await J(c, `({ ticked: !!document.querySelector('.page[data-i="0"].ticked'), count: document.getElementById('count').textContent.trim() })`);
    chk(`${L} 点「做好了」先在当前步打勾（还没翻页）`, mid.ticked && mid.count.startsWith('1 /'), JSON.stringify(mid));
    await sleep(900);
    chk(`${L} 打勾后翻到第 2 步`, (await c.ev(`document.getElementById('count').textContent.trim()`)).startsWith('2 /'));
    // 连点不会跳两步
    await c.ev(`document.getElementById('next').click();document.getElementById('next').click();document.getElementById('next').click()`); await sleep(1000);
    chk(`${L} 连点三下只前进一步`, (await c.ev(`document.getElementById('count').textContent.trim()`)).startsWith('3 /'));

    // ── ③ 最后一步 → 完成页
    const n = +(await c.ev(`document.querySelectorAll('.page').length`));
    await c.ev(`document.getElementById('deck').scrollTo({ left: document.querySelector('.page[data-i="${n - 1}"]').offsetLeft })`); await sleep(900);
    await c.ev(`document.getElementById('next').click()`); await sleep(600);
    const fin = await J(c, `(() => { const o = document.querySelector('.pv.finish'); return { open: !!o, t: o ? o.textContent : '' }; })()`);
    chk(`${L} 最后一步点「全部做完了」出完成页`, fin.open && /全部完成/.test(fin.t));
    await c.ev(`document.querySelector('.pv.finish .pv-go')?.click()`); await sleep(500);
    chk(`${L} 完成页「好的」收起、停在最后一步`, !(await c.ev(`!!document.querySelector('.pv.finish')`)) &&
      (await c.ev(`document.getElementById('count').textContent.trim()`)).startsWith(`${n} /`));

    // ── ② 再次打开：续看封面
    await fresh(c, 'step', 6);
    const rc = await J(c, `(() => { const o = document.querySelector('.pv.cover');
      if (!o) return { go: '没有封面' };
      return { go: o.querySelector('.pv-go').textContent, sub: !!o.querySelector('.pv-sub'), meta: o.querySelector('.pv-meta').textContent,
        now: (o.querySelector('.pv-road li.now .pv-t') || {}).textContent }; })()`);
    chk(`${L} 有阅读记录时封面是「继续第 7 步」+「从头开始」`, /继续第 7 步/.test(rc.go) && rc.sub && /做完 6 步/.test(rc.meta), JSON.stringify(rc));
    await c.ev(`document.querySelector('.pv.cover .pv-sub')?.click()`); await sleep(700);
    chk(`${L} 点「从头开始」回到第 1 步`, (await c.ev(`document.getElementById('count').textContent.trim()`)).startsWith('1 /'));

    // ── ④ 长文模式
    await fresh(c, 'long');
    await startCover(c);
    const lg = await J(c, `(() => { const ps = [...document.querySelectorAll('.page')];
      const R = (p, s) => p.querySelector(s).getBoundingClientRect();
      const p0 = ps[0], p1 = ps[1];
      return { hB: R(p0, '.say .h').bottom, imgT: R(p0, '.shot img').top,
        gap: R(p1, '.say .h').top - R(p0, '.shot img').bottom,         // 步与步之间
        inner: R(p0, '.shot img').top - R(p0, '.txt').bottom,          // 步内：文字到图
        sticky: getComputedStyle(p0.querySelector('.say .h')).position,
        sw: document.documentElement.scrollWidth }; })()`);
    chk(`${L} 长文模式：标题在截图上面`, lg.hB <= lg.imgT + 1);
    // inner < 0 说明图在字上面（旧版式），这时间距比较没有意义，不能算过
    chk(`${L} 长文模式：步与步之间的空白 ≥ 步内间距的 2 倍`, lg.inner >= 0 && lg.gap >= lg.inner * 2 && lg.gap >= 32, `步间 ${Math.round(lg.gap)} / 步内 ${Math.round(lg.inner)}`);
    chk(`${L} 长文模式：步骤标题是吸顶的`, lg.sticky === 'sticky', lg.sticky);
    chk(`${L} 长文模式无横向溢出`, lg.sw <= w, `${lg.sw}/${w}`);
    // 滚到第 5 步中间：它的标题贴在顶栏下面，前 4 步标 past
    await c.ev(`(() => { const p = document.querySelector('.page[data-i="4"]'); scrollTo(0, p.getBoundingClientRect().top + scrollY + 200); dispatchEvent(new Event('scroll')); })()`);
    await sleep(700);
    const st = await J(c, `(() => { const top = document.querySelector('.top').getBoundingClientRect().bottom;
      const h = document.querySelector('.page[data-i="4"] .say .h').getBoundingClientRect();
      return { d: Math.abs(h.top - top), past: [...document.querySelectorAll('.page.past')].map(p => +p.dataset.i).join(','),
        count: document.getElementById('count').textContent.trim() }; })()`);
    chk(`${L} 滑到第 5 步中间：第 5 步标题贴在顶栏正下方`, st.d <= 2, `差 ${Math.round(st.d)}px`);
    chk(`${L} 前 4 步标成「看过」`, st.past === '0,1,2,3' && st.count.startsWith('5 /'), `${st.past} / ${st.count}`);

    // ── ⑤ 只亮当前步开关
    const off = await c.ev(`getComputedStyle(document.querySelector('.page[data-i="6"]')).opacity`);
    chk(`${L} 「只亮当前步」默认关（其他步不变淡）`, +off === 1, off);
    await c.ev(`document.querySelector('.stepsbtn').click()`); await sleep(500);
    const sw0 = await c.ev(`document.querySelector('.dimsw input')?.checked ?? null`);
    await c.ev(`document.querySelector('.dimsw input')?.click()`); await sleep(500);
    await c.ev(`document.querySelector('.steps-close').click()`); await sleep(500);
    const on = await J(c, `({ other: +getComputedStyle(document.querySelector('.page[data-i="6"]')).opacity,
      cur: +getComputedStyle(document.querySelector('.page[data-i="4"]')).opacity, saved: localStorage.getItem('sg.dim') })`);
    chk(`${L} 打开开关后：当前步亮、其他步变淡，并记在本机`, sw0 === false && on.cur === 1 && on.other < 0.6 && on.saved === '1', JSON.stringify(on));
    await c.goto(T); await waitFor(c, `!!document.querySelector('.pv.cover.on')`);
    chk(`${L} 刷新后开关还记得`, await c.ev(`document.documentElement.classList.contains('dim')`));
    if (c.errors && c.errors.length) chk(`${L} 无 JS 报错`, false, c.errors.join(' | '));
  } finally { await c.close(); }
}

(async () => {
  for (const [w, h] of [[390, 844], [320, 568], [430, 932]]) await phone(w, h);
  console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
