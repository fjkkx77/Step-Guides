/* 验「正文被裁时，看得出来还能展开」——2026-09-20 的回归点。
   2026-10-17 起长正文默认展开、但放得下才展开（用户要求+二选一选的）：展开后截图仍 ≥ 屏宽 46% 的默认展开（提示「收起」），否则默认收起（提示「更多」）；收起状态的「更多」仍须满足下面这些要求。
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

/* 逐步检查（2026-10-17 起长正文默认展开，但放得下才展开——用户二选一选的）：
   「收起时会被裁」的步骤（长正文）：
     · 默认展开的：截图仍 ≥ 屏宽 46%、正文露全、提示「收起」且另起一行（position:static，不压在字上）
     · 默认收起的：必须是「展开就会把截图挤到 < 屏宽 46%」（量一下展开后的截图宽度来核对），提示「更多」
     · 不管默认哪种，收起状态下的「更多」都要满足 2026-09-20 的要求：看得见、绝对定位叠在正文末行、背后有渐隐、不溢出卡片
   收起时放得下的步骤 → 不挂提示。量的时候临时切 .open，量完原样放回 */
const CHECK = `(async () => {
  const imgs = [...document.querySelectorAll('.shot img')];
  imgs.forEach(i => i.loading = 'eager');
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const out = { total: 0, cut: 0, opened: 0, bad: [] };
  const N = i => '第' + (i + 1) + '步';
  document.querySelectorAll('.page').forEach((p, idx) => {
    const say = p.querySelector('.say'), para = say.querySelector('.txt p'), more = say.querySelector('.more');
    const label = say.querySelector('.more-t').textContent, img = p.querySelector('.shot img');
    out.total++;
    const wasOpen = say.classList.contains('open');
    const clippedNow = para.scrollHeight > para.clientHeight + 1;
    const staticNow = getComputedStyle(more).position;

    say.classList.remove('open');
    const shown = para.clientHeight;
    para.classList.add('unclamp');
    const full = para.scrollHeight;
    para.classList.remove('unclamp');
    const cut = full > shown + 1;
    const visible = !more.hidden && getComputedStyle(more).display !== 'none';
    if (!cut) {
      if (wasOpen) say.classList.add('open');
      if (visible) out.bad.push(N(idx) + '收起时也放得下，却还挂着提示「' + label + '」');
      return;
    }
    out.cut++;
    // 收起状态下「更多」的样子（每一个长正文步骤都查，不只第一个）
    const cs = getComputedStyle(more), r = more.getBoundingClientRect(), pr = para.getBoundingClientRect(), sr = say.getBoundingClientRect();
    if (more.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0)
      out.bad.push(N(idx) + '收起时看不到「更多」(' + cs.display + '/' + cs.visibility + ')');
    else {
      if (r.width < 24 || r.height < 10) out.bad.push(N(idx) + '收起时「更多」尺寸不对 ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (cs.position !== 'absolute') out.bad.push(N(idx) + '收起时「更多」不是绝对定位，会把版面顶高 → ' + cs.position);
      if (Math.abs(r.bottom - pr.bottom) > 6) out.bad.push(N(idx) + '收起时「更多」没对齐正文末行，差 ' + Math.round(r.bottom - pr.bottom) + 'px');
      if (r.right > sr.right + 1 || r.left < sr.left - 1) out.bad.push(N(idx) + '收起时「更多」溢出了卡片');
      if (!/gradient/.test(cs.backgroundImage)) out.bad.push(N(idx) + '收起时「更多」背后没有渐隐');
    }
    // 收起/展开时截图各有多宽（图都已解码，渲染宽度可信）。「放得下」跟 reader.js 同一条规则：
    // 展开后 ≥ 屏宽 46%；或收起时本来就不到 46%（被高度限住）且展开只窄了 ≤15%
    const wClosed = img.getBoundingClientRect().width;
    say.classList.add('open');
    const wOpen = img.getBoundingClientRect().width;
    if (!wasOpen) say.classList.remove('open');
    const vw = innerWidth;
    const F = window.__sgFit || { FIT_MIN: 0.46, FIT_LOSS: 0.15 };   // 阈值读 reader.js 自己的，不抄数字
    // 容差 3px：reader.js 按截图区宽高 × 宽高比算，渲染宽度多了图片 1px 边框，卡在线上的步骤两边会差 2px
    const fitsHi = wOpen >= vw * F.FIT_MIN - 3 || (wClosed < vw * F.FIT_MIN && wOpen >= wClosed * (1 - F.FIT_LOSS) - 3);
    const fitsLo = wOpen >= vw * F.FIT_MIN + 3 || (wClosed < vw * F.FIT_MIN - 3 && wOpen >= wClosed * (1 - F.FIT_LOSS) + 3);

    if (wasOpen) {
      out.opened++;
      if (!fitsHi) out.bad.push(N(idx) + '默认展开了，可截图被挤到 ' + Math.round(wOpen) + 'px（收起时 ' + Math.round(wClosed) + 'px，屏宽 46%＝' + Math.round(vw * .46) + 'px）');
      if (clippedNow) out.bad.push(N(idx) + '默认展开了，正文却还被裁着');
      if (label !== '收起') out.bad.push(N(idx) + '默认展开，提示却写「' + label + '」');
      if (staticNow !== 'static') out.bad.push(N(idx) + '展开时「收起」压在正文末行上（position=' + staticNow + '）');
    } else {
      if (fitsLo) out.bad.push(N(idx) + '展开后截图 ' + Math.round(wOpen) + 'px 放得下，却没有默认展开');
      if (label !== '更多') out.bad.push(N(idx) + '默认收起，提示却写「' + label + '」');
    }
    if (say.getAttribute('role') !== 'button') out.bad.push(N(idx) + '整块不可点（缺 role=button）');
    if (say.getAttribute('aria-expanded') !== String(wasOpen)) out.bad.push(N(idx) + 'aria-expanded 跟实际状态不符');
  });
  return JSON.stringify(out);
})()`;

/* 点一下切换 → 真改屏宽（触发重新判断）后仍照用户点的 → 再点一下切回来。
   优先找默认展开的那一步（测「收起」），没有就找默认收起的（测「展开」）。高屏上第 1 步可能本来就放得下，所以不死盯第 1 步。
   「改屏宽」必须真改（主循环里用 CDP 改宽度）：只派一个 resize 事件、宽度没变的话，自动判断的缓存就会让它照旧，
   测不出「记住用户亲手点过」这条有没有坏（审查指出） */
const TOGGLE_A = `(async () => {
  const all = [...document.querySelectorAll('.page .say')].filter(s => s.classList.contains('can-open'));
  const say = all.find(s => s.classList.contains('open')) || all[0];
  if (!say) return JSON.stringify({skip:'这一档一步都没有长到要折叠'});
  window.__tgl = say;
  say.scrollIntoView({block:'nearest'});
  const para = say.querySelector('.txt p'), lab = () => say.querySelector('.more-t').textContent;
  const open0 = say.classList.contains('open'), label0 = lab(), h0 = say.offsetHeight, p0 = para.clientHeight;
  say.click();
  await new Promise(r => setTimeout(r, 560));
  const open1 = say.classList.contains('open'), label1 = lab(), h1 = say.offsetHeight, p1 = para.clientHeight;
  const clipped1 = para.scrollHeight > para.clientHeight + 1;
  return JSON.stringify({ open0, label0, h0, p0, open1, label1, h1, p1, clipped1 });
})()`;
const KEPT = `JSON.stringify({ open: window.__tgl.classList.contains('open'), label: window.__tgl.querySelector('.more-t').textContent })`;
const TOGGLE_B = `(async () => {
  const say = window.__tgl; say.click();
  await new Promise(r => setTimeout(r, 560));
  return JSON.stringify({ open: say.classList.contains('open'), h2: say.offsetHeight });
})()`;
/* 长文模式里点文字（比如选字）：不能切换、不能记成「亲手点过」带回逐步模式、不能挂着按钮标记（审查指出） */
const LONGTAP = `(async () => {
  const say = [...document.querySelectorAll('.page .say')].find(s => s.classList.contains('can-open'));
  if (!say) return JSON.stringify({ skip: true });
  const f0 = say.dataset.folded || '', o0 = say.classList.contains('open');
  document.getElementById('modebtn').click(); await new Promise(r => setTimeout(r, 500));
  // 不派 resize：切到长文本身就得摘掉按钮标记（以前要等 resize 才摘，审查指出测试替它掩盖了）
  const role = say.getAttribute('role');
  say.click(); await new Promise(r => setTimeout(r, 560));
  const f1 = say.dataset.folded || '';
  document.getElementById('modebtn').click(); await new Promise(r => setTimeout(r, 600));
  return JSON.stringify({ f0, f1, roleInLong: role, same: say.classList.contains('open') === o0 });
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
        // 只改高度（模拟 iPhone Safari 工具栏出没，只触发 resize、宽度不变）：已经自动判过的步骤状态不能跟着变。
        // 只比「改之前就判过」的：高度跨过矮屏断点（≤660 裁成 1 行）时，原来不算长的步骤会变长、头一回被判，那是正常的
        const SNAP = `JSON.stringify([...document.querySelectorAll('.page .say')].map(s => s.dataset.auto ? s.classList.contains('open') : null))`;
        const before = await c.ev(SNAP);
        await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h - 40, deviceScaleFactor: 3, mobile: true, screenWidth: w, screenHeight: h - 40 });
        await sleep(500);
        const after = await c.ev(SNAP);
        await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true, screenWidth: w, screenHeight: h });
        await sleep(500);
        { const b = JSON.parse(before), a = JSON.parse(after);
          const flipped = b.map((x, i) => x !== null && x !== a[i] ? i + 1 : 0).filter(Boolean);
          if (flipped.length) r.bad.push('只变了高度（像 Safari 工具栏出没），第 ' + flipped.join('、') + ' 步自动判过的展开/收起却跟着变了'); }
        const t = JSON.parse(await c.ev(TOGGLE_A));
        if (!t.skip) {
          // 真改屏宽（宽度变了，自动判断会重做）：用户亲手点过的那一步仍要照用户点的
          await c.send('Emulation.setDeviceMetricsOverride', { width: w - 12, height: h, deviceScaleFactor: 3, mobile: true, screenWidth: w - 12, screenHeight: h });
          await sleep(500);
          const k = JSON.parse(await c.ev(KEPT));
          await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true, screenWidth: w, screenHeight: h });
          await sleep(500);
          t.kept = k.open === t.open1 && k.label === t.label1;
          const b2 = JSON.parse(await c.ev(TOGGLE_B));
          t.back = b2.open === t.open0; t.h2 = b2.h2;
        }
        if (r.cut < minCut) { r.bad.push(`只有 ${r.cut}/${r.total} 步收起时会被裁，这一档至少该有 ${minCut} 步——裁剪规则多半没生效`); }
        const ok = !r.bad.length;
        if (!ok) bad++;
        console.log(`${ok ? '✓' : '✗'} ${name.padEnd(22)} ${r.cut}/${r.total} 步是长正文，默认展开 ${r.opened} 步（其余展开会挤小截图，先收着）`);
        r.bad.forEach(x => console.log('    ✗ ' + x));

        if (t.skip) { console.log('    · 展开测试跳过：' + t.skip); }
        else {
          const bads = [];
          if (t.open1 === t.open0) bads.push('点了没有切换');
          if (t.open0) {
            if (t.label0 !== '收起') bads.push(`默认展开时提示应写「收起」，是「${t.label0}」`);
            if (!t.clipped1) bads.push('收起后正文居然没被裁');
            if (t.p1 >= t.p0 || t.h1 >= t.h0 - 4) bads.push(`收起后没变矮 卡片 ${t.h0}→${t.h1} 正文 ${t.p0}→${t.p1}`);
            if (t.label1 !== '更多') bads.push(`收起后文案应是「更多」，是「${t.label1}」`);
          } else {
            if (t.label0 !== '更多') bads.push(`默认收起时提示应写「更多」，是「${t.label0}」`);
            if (t.clipped1) bads.push('展开后正文仍然被裁');
            if (t.p1 <= t.p0 || t.h1 <= t.h0 + 4) bads.push(`展开后没变高 卡片 ${t.h0}→${t.h1} 正文 ${t.p0}→${t.p1}`);
            if (t.label1 !== '收起') bads.push(`展开后文案应是「收起」，是「${t.label1}」`);
          }
          if (!t.kept) bads.push('亲手点过之后改了屏宽，又被自动改回去了');
          if (!t.back || Math.abs(t.h2 - t.h0) > 2) bads.push(`再点没切回去 ${t.h2} vs ${t.h0}`);
          if (bads.length) { bad++; bads.forEach(x => console.log('    ✗ ' + x)); }
          else {
            toggled++;
            console.log(`    ✓ 默认${t.open0 ? '展开' : '收起'}（卡片 ${t.h0}px、提示「${t.label0}」）→ 点一下${t.open0 ? '收起' : '展开'}成 ${t.h1}px、文案「${t.label1}」→ 改屏宽后保持 → 再点回 ${t.h2}px`);
          }
        }
        if (name.startsWith('390×844')) {
          const lm = JSON.parse(await c.ev(LONGTAP));
          if (!lm.skip) {
            const okL = lm.f0 === lm.f1 && lm.roleInLong === null && lm.same;
            if (!okL) bad++;
            console.log(`    ${okL ? '✓' : '✗'} 长文模式里点文字：不切换、不记成亲手点过、不挂按钮标记，切回逐步状态不变 ${JSON.stringify(lm)}`);
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
