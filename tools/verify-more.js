/* 验「正文被裁时，看得出来还能展开」——2026-09-20 的回归点。
   起因：矮屏那档曾写死 `.more{display:none}`「省高度」，结果把唯一的可展开提示，
   恰恰在文字被裁得最狠（1~2 行）的那一档藏掉了，用户在 iPhone 上根本不知道有下文。
   所以这里**必须带上矮屏档**，只测 390×844 是测不出来的。

   用法：node tools/verify-more.js [站内路径] [--base=https://…]
   带 --base 就直接验线上（发布后必须核一次，别只信本地）。
*/
const { open, sleep } = require('./cdp.js');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

/* 端口写死会踩到「别的会话/上一轮遗留的服务还占着」——
   而 spawn 的 stdio:'ignore' 会把 EADDRINUSE 吞掉，表现成「页面是空的」，极难查。
   所以先问系统要一个空闲端口。 */
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
let page = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 't/qhftq5kz/';
page = '/' + String(page).replace(/^[A-Za-z]:.*?[\\/](?=t\/|w\/|mine\/|$)/, '').replace(/^\/+/, '');

/* 档位：前三档是常规宽度，后两档专打「矮」——
   iPhone 在 Safari 里带上下工具栏后可视高度就落在 640~700，正是出事的那一档 */
/* 第 4 个数是「这一档至少该有几步被裁」。
   不设这个下限的话，裁剪规则一旦失效（比如选择器特异性被改高了、覆盖不动），
   测试会因为"没有被裁的步骤"而全部跳过，然后报全绿 —— 假绿。2026-09-20 真踩到过。 */
const VIEWS = [
  [320, 568, '320×568 小屏', 4],
  [390, 844, '390×844 常规', 1],
  [430, 932, '430×932 大屏', 1],
  [390, 690, '390×690 矮屏(≤700 档)', 4],
  [390, 630, '390×630 更矮(≤660 档)', 8]
];

/* 逐步检查：被裁的步骤必须有看得见的「更多」，且它不占额外高度、不溢出 */
const CHECK = `(async () => {
  const imgs = [...document.querySelectorAll('.shot img')];
  imgs.forEach(i => i.loading = 'eager');
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const out = { total: 0, cut: 0, bad: [] };
  document.querySelectorAll('.page').forEach((p, idx) => {
    const say = p.querySelector('.say');
    const para = say.querySelector('.txt p');
    const more = say.querySelector('.more');
    out.total++;

    // 真实是否被裁：临时取消裁剪再量（不依赖 line-clamp 下 scrollHeight 的实现细节）
    const shown = para.clientHeight;
    para.classList.add('unclamp');
    const full = para.scrollHeight;
    para.classList.remove('unclamp');
    const cut = full > shown + 1;
    if (!cut) {
      if (more && !more.hidden && getComputedStyle(more).display !== 'none')
        out.bad.push('第' + (idx+1) + '步没被裁却还挂着「更多」');
      return;
    }
    out.cut++;

    const cs = getComputedStyle(more);
    const r = more.getBoundingClientRect();
    const pr = para.getBoundingClientRect();
    const sr = say.getBoundingClientRect();

    if (more.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0)
      out.bad.push('第' + (idx+1) + '步被裁了却看不到「更多」(' + cs.display + '/' + cs.visibility + ')');
    else {
      if (r.width < 24 || r.height < 10)
        out.bad.push('第' + (idx+1) + '步「更多」尺寸不对 ' + Math.round(r.width) + 'x' + Math.round(r.height));
      // 不占额外行高：绝对定位，且底边压在正文末行上
      if (cs.position !== 'absolute')
        out.bad.push('第' + (idx+1) + '步「更多」不是绝对定位，会把版面顶高 → ' + cs.position);
      if (Math.abs(r.bottom - pr.bottom) > 6)
        out.bad.push('第' + (idx+1) + '步「更多」没对齐正文末行，差 ' + Math.round(r.bottom - pr.bottom) + 'px');
      // 不能横向溢出卡片
      if (r.right > sr.right + 1 || r.left < sr.left - 1)
        out.bad.push('第' + (idx+1) + '步「更多」溢出了卡片');
      // 背后要有渐隐垫底，否则压在文字上糊成一团
      if (!/gradient/.test(cs.backgroundImage))
        out.bad.push('第' + (idx+1) + '步「更多」背后没有渐隐');
    }
    if (say.getAttribute('role') !== 'button')
      out.bad.push('第' + (idx+1) + '步整块不可点（缺 role=button）');
  });
  return JSON.stringify(out);
})()`;

/* 找第一个真被裁的步骤点开：高屏上第 1 步可能本来就没裁，死盯第 1 步会让这条测试永远跳过。
   判据用**段落高度**，不用 getClientRects().length —— 后者对块级元素恒为 1，量不出行数（踩过）。 */
const TOGGLE = `(async () => {
  const say = [...document.querySelectorAll('.page .say')].find(s => s.classList.contains('can-open'));
  if (!say) return JSON.stringify({skip:'这一档一步都没被裁'});
  say.scrollIntoView({block:'nearest'});
  const para = say.querySelector('.txt p');
  const h0 = say.offsetHeight, p0 = para.clientHeight;
  const clipped0 = para.scrollHeight > para.clientHeight + 1;
  say.click();
  await new Promise(r => setTimeout(r, 560));
  const h1 = say.offsetHeight, p1 = para.clientHeight;
  const clipped1 = para.scrollHeight > para.clientHeight + 1;
  const label = say.querySelector('.more-t').textContent;
  const opened = say.classList.contains('open');
  const moreStatic = getComputedStyle(say.querySelector('.more')).position;
  say.click();
  await new Promise(r => setTimeout(r, 560));
  return JSON.stringify({ h0, h1, h2: say.offsetHeight, p0, p1, clipped0, clipped1,
                          label, opened, moreStatic,
                          closed: !say.classList.contains('open') });
})()`;

(async () => {
  let srv = null, target;
  if (BASE) {
    target = BASE.replace(/\/$/, '') + page;
  } else {
    const PORT = await freePort();
    srv = spawn(process.execPath, [path.join(__dirname, 'mock.js'), path.resolve(__dirname, '..'), String(PORT)], { stdio: ['ignore', 'ignore', 'inherit'] });
    await sleep(600);
    target = `http://127.0.0.1:${PORT}${page}`;
    // 服务真起来了才往下走，否则后面每一档都是在测一个空页面
    const probe = await fetch(target).then(r => r.ok).catch(() => false);
    if (!probe) { console.error('本地服务没起来，端口 ' + PORT); process.exit(2); }
  }
  console.log('验的是：' + target);

  let bad = 0, toggled = 0;
  try {
    for (const [w, h, name, minCut] of VIEWS) {
      const c = await open(w, h, 3);
      try {
        await c.goto(target);
        await sleep(500);
        const r = JSON.parse(await c.ev(CHECK));
        const t = JSON.parse(await c.ev(TOGGLE));
        if (r.cut < minCut) { r.bad.push(`只有 ${r.cut}/${r.total} 步被裁，这一档至少该有 ${minCut} 步——裁剪规则多半没生效`); }
        const ok = !r.bad.length;
        if (!ok) bad++;
        console.log(`${ok ? '✓' : '✗'} ${name.padEnd(22)} ${r.cut}/${r.total} 步被裁`);
        r.bad.forEach(x => console.log('    ✗ ' + x));

        if (t.skip) { console.log('    · 展开测试跳过：' + t.skip); }
        else {
          const bads = [];
          if (!t.clipped0) bads.push('展开前正文居然没被裁');
          if (t.p1 <= t.p0) bads.push(`展开后正文没变高 ${t.p0}→${t.p1}`);
          if (t.clipped1) bads.push('展开后正文仍然被裁（没真正露全）');
          if (t.h1 <= t.h0 + 4) bads.push(`卡片没变高 ${t.h0}→${t.h1}`);
          if (!t.opened) bads.push('没有进入 open 状态');
          if (t.label !== '收起') bads.push(`文案没变成「收起」，是「${t.label}」`);
          if (t.moreStatic !== 'static') bads.push(`展开后「更多」还压在末行上（position=${t.moreStatic}）`);
          if (!t.closed || Math.abs(t.h2 - t.h0) > 2) bads.push(`再点没收回去 ${t.h2} vs ${t.h0}`);
          if (bads.length) { bad++; bads.forEach(x => console.log('    ✗ ' + x)); }
          else {
            toggled++;
            console.log(`    ✓ 展开：卡片 ${t.h0}→${t.h1}px、正文 ${t.p0}→${t.p1}px 且不再被裁，文案变「收起」，再点收回 ${t.h2}px`);
          }
        }
        if ((c.errors || []).length) { bad++; console.log('    ⚠️ 页面报错 ' + JSON.stringify(c.errors).slice(0, 200)); }
      } catch (e) { bad++; console.log(`✗ ${name} 挂了：${e.message}`); }
      finally { await c.close(); }
    }
  } finally { if (srv) srv.kill(); }
  console.log(bad ? `\n${bad} 档没过` : '\n全部档位通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(2); });
