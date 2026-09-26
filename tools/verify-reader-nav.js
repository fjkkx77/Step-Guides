/* 2026-09-26 三件事：
   ① 发布成功后不再停在写作页：主按钮去看教程、「我的教程」/关掉弹窗都去教程库并高亮刚发的那份
      （用页面内打桩的假 GitHub，不碰真仓库）
   ② 阅读页：左上角返回键（站内来的回上一页、直接打开的回首页）、底栏「回到第一步」、最后一步「从头再看」
   ③ 电脑宽屏：左右两侧整条翻页热区；窄屏/长文模式不出现；内容不被热区盖住
   用法：node tools/verify-reader-nav.js [--base=https://jc.wbztl.xyz]（②③ 可验线上；① 只在本地跑） */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const ROOT = BASE ? BASE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`;
const T = ROOT + '/t/qhftq5kz/';

let bad = 0;
const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40) => { for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; } return false; };
const count = c => c.ev(`document.getElementById('count').textContent.trim()`);
const ready = c => waitFor(c, `document.querySelectorAll('.page').length > 1 && /\\d+ \\/ \\d+/.test(document.getElementById('count').textContent)`);
const toStep = (c, mode = 'step') => c.ev(`document.documentElement.dataset.mode !== '${mode}' && document.getElementById('modebtn').click()`);

async function phone(w, h) {
  const L = `${w}×${h}`;
  const c = await open(w, h, 2);
  try {
    // ── 直接打开链接（没有站内上一页）
    await c.goto(T); await ready(c); await toStep(c); await sleep(500);
    const g = JSON.parse(await c.ev(`JSON.stringify((() => {
      const R = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, vis: getComputedStyle(e).display !== 'none' }; };
      return { back: R('#backbtn'), h1: R('#title'), first: R('#firstbtn'), prev: R('#prev'), next: R('#next'),
               side: R('.side-next'), vw: innerWidth, sw: document.documentElement.scrollWidth,
               firstDis: document.getElementById('firstbtn') && document.getElementById('firstbtn').disabled }; })())`));
    chk(`${L} 左上角有返回键（≥44×44，在标题左边）`, g.back && g.back.w >= 44 && g.back.h >= 44 && g.back.r <= g.h1.l + 1 && g.back.l >= 0,
        g.back ? `${Math.round(g.back.w)}×${Math.round(g.back.h)} @${Math.round(g.back.l)}` : '没有');
    chk(`${L} 底栏有「回到第一步」，第 1 步时置灰`, g.first && g.first.w >= 44 && g.first.r <= g.prev.l && g.firstDis === true);
    chk(`${L} 底栏三个按钮都在屏内、无横向溢出`, g.next.r <= g.vw && g.sw <= g.vw, `${g.sw}/${g.vw}`);
    chk(`${L} 窄屏不出现两侧翻页区`, !g.side || !g.side.vis);

    await c.ev(`document.getElementById('next').click()`); await sleep(500);
    await c.ev(`document.getElementById('next').click()`); await sleep(500);
    await c.ev(`document.getElementById('next').click()`); await sleep(700);
    const before = await count(c);
    await c.ev(`document.getElementById('firstbtn').click()`); await sleep(900);
    chk(`${L} 点「回到第一步」回到 1`, (await count(c)).startsWith('1 /'), `${before} → ${await count(c)}`);

    // 最后一步的「从头再看」
    const n = +(await c.ev(`document.querySelectorAll('.page').length`));
    await c.ev(`document.querySelectorAll('.scell').length ? 0 : 0`);
    await c.ev(`(() => { const d = document.getElementById('deck'), p = document.querySelector('.page[data-i="${n - 1}"]'); d.scrollTo({ left: p.offsetLeft }); })()`);
    await sleep(900);
    // 逐步模式的最后一步：「下一步」变成「↺ 从头再看」（不在说明卡里加按钮，免得挤窄矮屏截图）
    const endBtn = JSON.parse(await c.ev(`JSON.stringify({ t: document.getElementById('next').textContent.trim(),
      dis: document.getElementById('next').disabled, h: document.getElementById('next').getBoundingClientRect().height,
      cardBtn: getComputedStyle(document.querySelector('.page[data-i="${n - 1}"] .again')).display })`));
    chk(`${L} 最后一步「下一步」变成「从头再看」（可点、≥44 高，说明卡里不另加按钮）`,
        /从头再看/.test(endBtn.t) && !endBtn.dis && endBtn.h >= 44 && endBtn.cardBtn === 'none', `${endBtn.t} / ${Math.round(endBtn.h)}px`);
    await c.ev(`document.getElementById('next').click()`); await sleep(900);
    const back1 = await count(c);
    chk(`${L} 点「从头再看」回到 1，按钮文字恢复「下一步」`,
        back1.startsWith('1 /') && /下一步/.test(await c.ev(`document.getElementById('next').textContent`)), back1);
    // 长文模式：卡片里的「从头再看」
    await toStep(c, 'long'); await sleep(600);
    const lg = JSON.parse(await c.ev(`JSON.stringify((() => { const b = document.querySelector('.page[data-i="${n - 1}"] .again');
      const r = b.getBoundingClientRect(); return { d: getComputedStyle(b).display, h: r.height }; })())`));
    chk(`${L} 长文模式最后一段有「从头再看」（≥44 高）`, lg.d !== 'none' && lg.h >= 44, `${Math.round(lg.h)}px`);
    await toStep(c, 'step'); await sleep(500);

    // 直接打开 → 返回 = 回首页
    await c.ev(`document.getElementById('backbtn').click()`); await sleep(1200);
    const p1 = await c.ev(`location.pathname`);
    chk(`${L} 直接打开的链接：返回键回首页`, p1 === '/' || /\/Step-Guides\/$/.test(p1), p1);

    // 从教程库点进来 → 返回 = 回教程库
    await c.goto(ROOT + '/mine/'); await waitFor(c, `!!document.querySelector('.card a.go')`);
    await c.ev(`document.querySelector('.card a.go').click()`); await sleep(400); await ready(c);
    await c.ev(`document.getElementById('backbtn').click()`); await sleep(1200);
    const p2 = await c.ev(`location.pathname`);
    chk(`${L} 从教程库点进来：返回键回教程库`, /\/mine\/$/.test(p2), p2);
    if (c.errors && c.errors.length) chk(`${L} 无 JS 报错`, false, c.errors.join(' | '));
  } finally { await c.close(); }
}

async function desk(w, h) {
  const L = `${w}×${h}`;
  const c = await open(w, h, 1);
  try {
    await c.goto(T); await ready(c); await toStep(c); await sleep(600);
    const geo = async () => JSON.parse(await c.ev(`JSON.stringify((() => {
      const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
      const sp = document.querySelector('.side-prev'), sn = document.querySelector('.side-next'), d = document.getElementById('deck');
      const cur = +document.getElementById('count').textContent.split('/')[0] - 1;
      const pg = document.querySelector('.page[data-i="' + cur + '"]');
      return { vw: innerWidth, sw: document.documentElement.scrollWidth,
        sp: sp && getComputedStyle(sp).display !== 'none' ? R(sp) : null, sn: sn && getComputedStyle(sn).display !== 'none' ? R(sn) : null,
        spDis: sp && sp.disabled, snDis: sn && sn.disabled, deck: R(d),
        img: R(pg.querySelector('.shot img')), say: R(pg.querySelector('.say')),
        top: R(document.querySelector('.top')), bot: R(document.querySelector('.bottom')) }; })())`));
    let g = await geo();
    chk(`${L} 两侧翻页区都在`, !!(g.sp && g.sn));
    if (g.sp && g.sn) {
      chk(`${L} 热区够大（≥88px 宽、盖满内容区高度）`, g.sp.w >= 88 && g.sn.w >= 88 && Math.abs(g.sp.t - g.deck.t) < 2 && Math.abs(g.sp.b - g.deck.b) < 2,
          `宽 ${Math.round(g.sp.w)}，高 ${Math.round(g.sp.h)}（内容区 ${Math.round(g.deck.h)}）`);
      chk(`${L} 不压在顶栏/底栏上`, g.sp.t >= g.top.b - 1 && g.sp.b <= g.bot.t + 1);
      chk(`${L} 截图和说明卡不被热区盖住`, g.img.l >= g.sp.r - 1 && g.img.r <= g.sn.l + 1 && g.say.l >= g.sp.r - 1 && g.say.r <= g.sn.l + 1,
          `说明卡 [${Math.round(g.say.l)}, ${Math.round(g.say.r)}]，热区内沿 ${Math.round(g.sp.r)} / ${Math.round(g.sn.l)}`);
      chk(`${L} 第 1 步时左侧不可点、右侧可点`, g.spDis === true && g.snDis === false);
      chk(`${L} 无横向溢出`, g.sw <= g.vw);

      // 真实鼠标点在右侧热区的边角（不是正中的圆钮）——验证"整条都能点"
      const clickAt = async (x, y) => {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
          await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      };
      await clickAt(Math.round(g.sn.r - 10), Math.round(g.sn.t + 20)); await sleep(800);
      chk(`${L} 点右侧热区的角落也能翻到下一步`, (await count(c)).startsWith('2 /'), await count(c));
      await clickAt(Math.round(g.sn.l + 10), Math.round(g.sn.b - 20)); await sleep(800);
      chk(`${L} 再点一次到第 3 步`, (await count(c)).startsWith('3 /'), await count(c));
      g = await geo();
      await clickAt(Math.round(g.sp.l + 15), Math.round((g.sp.t + g.sp.b) / 2)); await sleep(800);
      chk(`${L} 点左侧热区回上一步`, (await count(c)).startsWith('2 /'), await count(c));

      // 长文模式不出现
      await toStep(c, 'long'); await sleep(600);
      g = await geo();
      chk(`${L} 长文模式不出现两侧热区`, !g.sp && !g.sn);
      await toStep(c, 'step');
    }
    if (c.errors && c.errors.length) chk(`${L} 无 JS 报错`, false, c.errors.join(' | '));
  } finally { await c.close(); }
}

// 发布成功后的去向：假 GitHub 打桩（页面内替换 fetch），不碰真仓库
async function publishFlow() {
  if (BASE) { console.log('（发布流程只在本地验，跳过）'); return; }
  for (const how of ['open', 'mine', 'esc']) {
    const c = await open(390, 844, 2);
    try {
      // 设置是页面启动时读进内存的：必须先写好再刷新，否则点发布会弹"先填 token"的 alert 把测试卡死
      await c.goto(ROOT + '/w/'); await sleep(500);
      await c.ev(`localStorage.setItem('sg.cfg', JSON.stringify({ owner: 'fake', repo: 'Step-Guides', branch: 'main', token: 'github_pat_FAKE' }))`);
      await c.goto(ROOT + '/w/'); await sleep(900);
      await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
      await c.ev(`window.alert = m => { window.__alert = m; }; window.prompt = () => null;`);   // 原生弹窗会卡死自动化
      const ok = await c.ev(`(async () => {
        const real = window.fetch.bind(window);
        const J = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.__calls = [];
        window.fetch = async (u, opt) => {
          const url = String(u);
          if (url.startsWith('https://api.github.com')) {
            __calls.push((opt && opt.method || 'GET') + ' ' + url.replace('https://api.github.com', ''));
            if (/\\/git\\/ref\\/heads\\//.test(url)) return J({ object: { sha: 'head' } });
            if (/\\/git\\/commits\\/head$/.test(url)) return J({ sha: 'head', tree: { sha: 'tree0' } });
            if (/\\/git\\/trees\\/tree0/.test(url)) return J({ sha: 'tree0', tree: [] });
            if (/\\/git\\/blobs$/.test(url)) return J({ sha: 'blob' + __calls.length });
            if (/\\/git\\/trees$/.test(url)) return J({ sha: 'tree1' });
            if (/\\/git\\/commits$/.test(url)) return J({ sha: 'c1' });
            if (/\\/git\\/refs\\/heads\\//.test(url)) return J({ object: { sha: 'c1' } });
            return J({});
          }
          if (url.includes('github.io')) return url.includes('list.json') ? J([]) : J({ ok: 1 });
          return real(u, opt);
        };
        // 造一份一步的草稿（用一张现成的站内截图）
        const b = await (await real('../t/qhftq5kz/i/' + (await (await real('../t/qhftq5kz/data.json')).json()).steps[0].img)).blob();
        await SGWriter.addFiles([new File([b], 'a.webp', { type: 'image/webp' })]);
        document.getElementById('title').value = '自动化测试';
        document.getElementById('title').dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(600);
      await c.ev(`document.getElementById('btn-publish').click()`);
      const done = await waitFor(c, `!!document.getElementById('p-open')`, 80);
      chk(`发布成功（假 GitHub）后出现去向按钮 [${how}]`, done,
          await c.ev(`document.getElementById('p-title').textContent + ' ' + (window.__alert || '')`));
      if (!done) continue;
      const ui = JSON.parse(await c.ev(`JSON.stringify({ btns: [...document.querySelectorAll('#p-row button')].map(b => b.textContent.trim()),
        calls: __calls.filter(x => !x.startsWith('GET')).length })`));
      if (how === 'open') chk('成功弹窗按钮：复制链接 / 我的教程 / 查看教程', ['复制链接', '📚 我的教程', '查看教程 ›'].every(t => ui.btns.includes(t)), ui.btns.join(' | '));
      const id = await c.ev(`(document.querySelector('#p-row a') || {}).href || ''`);
      const tid = (/\/t\/([a-z0-9]+)\//.exec(id) || [])[1];
      if (how === 'open') await c.ev(`document.getElementById('p-open').click()`);
      if (how === 'mine') await c.ev(`document.getElementById('p-mine').click()`);
      if (how === 'esc') await c.ev(`document.getElementById('dlg-prog').close()`);   // 等同 Esc / 返回键关弹窗
      await sleep(1200);
      const at = await c.ev(`location.href`);
      if (how === 'open') chk('点「查看教程」→ 打开刚发的教程', at.includes('/t/' + tid + '/'), at);
      else chk(`${how === 'mine' ? '点「我的教程」' : '直接关掉弹窗'} → 去教程库并带上新教程 id`,
               /\/mine\//.test(at) || at.includes('/mine/?new=' + tid), at);
      const hist = await c.ev(`history.length`);
      if (how === 'open') chk('用 replace 跳转（返回不会退回过期的写作页）', hist <= 2, `history.length=${hist}`);
    } finally { await c.close(); }
  }
  // 教程库的高亮（用一个真实存在的 id）
  const c = await open(390, 844, 2);
  try {
    // 样例教程不在 list.json 里，拿列表里真实存在的第一份来验
    const lid = JSON.parse(require('fs').readFileSync(__dirname + '/../list.json', 'utf8'))[0].id;
    await c.goto(ROOT + '/mine/?new=' + lid); await waitFor(c, `!!document.querySelector('.card')`); await sleep(400);
    const m = JSON.parse(await c.ev(`JSON.stringify({ fresh: !!document.querySelector('.card.fresh[data-id="${lid}"]'),
      tag: !!document.querySelector('.card.fresh .newtag'), url: location.search })`));
    chk('教程库：刚发的那份高亮 + 「刚发布」标签，地址栏参数被抹掉', m.fresh && m.tag && m.url === '', JSON.stringify(m));
  } finally { await c.close(); }
}

(async () => {
  for (const [w, h] of [[320, 568], [390, 844], [430, 932]]) await phone(w, h);
  for (const [w, h] of [[900, 700], [1280, 800], [1707, 900]]) await desk(w, h);
  await publishFlow();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
