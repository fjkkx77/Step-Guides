/* 2026-10-09 /sc 深审发现的问题，逐条一个回归用例（判据都写成「正确行为」，FAIL = 问题还在）。
   全部在本地跑：自己起静态服务 + 页面内假 GitHub（tools/fake-github.js），不碰真仓库、不联网。
   用法：node tools/verify-audit.js [用例名前缀，如 P0 / P2-13]
   用例名就是审查报告里的编号，报告在 ~/.claude/skills/sc/reports/ 或桌面（修完会删副本）。 */
const { open, sleep } = require('./cdp.js');
const { shim, decodeBlobs } = require('./fake-github.js');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 9300 + Math.floor(Math.random() * 600);
const ROOT = `http://127.0.0.1:${PORT}`;
const ONLY = process.argv[2] || '';
const SHIM = shim(ROOT_DIR);

let bad = 0, ran = 0;
const chk = (n, ok, d) => { ran++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
const waitFor = async (c, expr, n = 40, gap = 250) => { for (let i = 0; i < n; i++) { await sleep(gap); try { if (await c.ev(expr)) return true; } catch (e) { /* 页面在跳转 */ } } return false; };

async function page(w = 390, h = 844, extra) {
  const c = await open(w, h, 2);
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIM + (extra || '') });
  return c;
}
const writerReady = c => waitFor(c, `!!(window.SGWriter && SGWriter.ready)`, 60);
const setCfg = c => c.ev(`localStorage.setItem('sg.cfg', JSON.stringify({ owner: 'fake', repo: 'Step-Guides', branch: 'main', token: 'github_pat_FAKE_FOR_TEST_ONLY' }))`);
const allDrafts = c => c.ev(`SGStore.list().then(a => JSON.stringify(a.map(d => ({ slot: d.slot, id: d.id, title: d.title, n: d.steps.length }))))`);
const addImgs = (c, n, names) => c.ev(`(async () => { const files = [];
  for (let k = 1; k <= ${n}; k++) { const b = await (await fetch('/t/qhftq5kz/i/' + String(k).padStart(2, '0') + '.webp')).blob();
    files.push(new File([b], ${names ? JSON.stringify(names) + '[k - 1]' : `'shot' + String(k).padStart(2, '0') + '.webp'`}, { type: 'image/webp' })); }
  await SGWriter.addFiles(files); return SGWriter.draft.steps.length; })()`);
const setTitle = (c, t) => c.ev(`(() => { const e = document.getElementById('title'); e.value = ${JSON.stringify(t)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const typeStep = (c, i, t) => c.ev(`(() => { const e = document.querySelectorAll('.stext')[${i}]; e.value = ${JSON.stringify(t)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const publishDone = c => waitFor(c, `!!document.getElementById('p-open') || !!document.querySelector('#p-row .err')`, 120);
const pubTitle = c => c.ev(`document.getElementById('p-title').textContent`);
const treePaths = (c, k = 0) => c.ev(`JSON.stringify((__gh.trees[${k}] || { tree: [] }).tree.map(x => (x.sha === null ? '-' : '') + x.path))`);
const committedList = async c => {
  const blobs = JSON.parse(await decodeBlobs(c));
  return blobs.map(s => { try { const j = JSON.parse(s); return Array.isArray(j) ? j : null; } catch (e) { return null; } }).filter(Boolean).pop();
};
/** 新草稿：写作页加图 + 标题，等自动保存落盘 */
async function newDraft(c, title, n = 2) {
  await c.goto(ROOT + '/w/'); await writerReady(c);
  await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
  await addImgs(c, n); await setTitle(c, title); await sleep(700);
}

const CASES = {
  async 'P0-1 编辑另一份时改字，不影响未发布的新草稿'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await newDraft(c, '草稿A');
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await typeStep(c, 0, '改一个字'); await sleep(800);
      const d = await allDrafts(c);
      chk(this.name, /草稿A/.test(d), d);
    } finally { c.close(); }
  },
  async 'P0-1 原样重发已发布教程，不清掉未发布的新草稿'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await newDraft(c, '草稿A');
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await c.ev(`document.getElementById('btn-publish').click()`);
      await sleep(4000);
      const d = await allDrafts(c);
      chk(this.name, /草稿A/.test(d), d);
    } finally { c.close(); }
  },
  async 'P0-1 编辑页还没加载完就点返回，不覆盖/不清掉新草稿'() {
    // 读线上 data.json 故意慢 3 秒
    const slow = `(() => { const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('/t/qhftq5kz/data.json')) await new Promise(r => setTimeout(r, 3000)); return f(u, o); }; })();`;
    const c = await page(390, 844, slow); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await newDraft(c, '草稿A');
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await sleep(600);
      await c.ev(`document.getElementById('btn-home2').click()`); await sleep(400);
      const dlg = await c.ev(`!!(document.getElementById('dlg-leave') && document.getElementById('dlg-leave').open)`);
      if (dlg) { await c.ev(`document.getElementById('lv-save').click()`); await sleep(800); }
      await c.goto(ROOT + '/'); await sleep(500);
      const d = await c.ev(`new Promise(res => { const s = document.createElement('script'); s.src = 'assets/store.js'; s.onload = () => SGStore.list().then(a => res(JSON.stringify(a.map(x => x.title)))); document.head.appendChild(s); })`);
      chk(this.name, /草稿A/.test(d) && !dlg, `离开时弹窗=${dlg}，草稿 ${d}`);
    } finally { c.close(); }
  },
  async 'P1-3 离开时选「删掉」要二次确认，不会直接删掉之前保存的草稿'() {
    const c = await page(); try {
      await newDraft(c, '草稿B');
      await c.ev(`document.getElementById('btn-save').click()`); await sleep(500);
      const slot = await c.ev(`SGWriter.slot`);
      await c.goto(ROOT + '/w/?draft=' + encodeURIComponent(slot.replace(/^new:/, ''))); await writerReady(c);
      await setTitle(c, '草稿B（改）'); await sleep(100);
      await c.ev(`document.getElementById('btn-home2').click()`); await sleep(400);
      await c.ev(`document.getElementById('lv-drop').click()`); await sleep(500);
      const asked = await c.ev(`!!document.querySelector('dialog.sg-ui[open]')`);
      const d = await allDrafts(c);
      chk(this.name, asked && /草稿B/.test(d), `二次确认=${asked}，草稿 ${d}`);
    } finally { c.close(); }
  },
  async 'P2-12 打开写作页时不弹原生对话框；关掉提示不会删草稿'() {
    const c = await page(); try {
      await newDraft(c, '草稿C');
      await c.ev(`localStorage.setItem('__confirm', 'no')`);
      await c.goto(ROOT + '/w/'); await writerReady(c); await sleep(500);
      const native = await c.ev(`JSON.stringify(__nativeDialogs)`);
      await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`); await sleep(300);
      const d = await allDrafts(c);
      chk(this.name, native === '[]' && /草稿C/.test(d), `原生弹框 ${native}；草稿 ${d}`);
    } finally { c.close(); }
  },
  async 'P2-6 编辑→删步→存草稿→下次接着改再发，旧图会被删'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await c.ev(`SGWriter.del(0)`); await sleep(100); await c.ev(`document.querySelector('dialog[open] .danger-solid, #del-yes').click()`); await sleep(200);
      await c.ev(`document.getElementById('btn-save').click()`); await sleep(500);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `!!document.getElementById('rs-go') && document.getElementById('dlg-resume').open`);
      await c.ev(`document.getElementById('rs-go').click()`);
      await waitFor(c, `document.querySelectorAll('.step').length === 11`);
      await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
      const t = await treePaths(c);
      chk(this.name, t.includes('-t/qhftq5kz/i/01.webp'), t.slice(0, 160));
    } finally { c.close(); }
  },
  async 'P1-2 读线上目录失败/错误页/旧版都不影响：目录从仓库读、合并后条数 = 原来 + 1'() {
    for (const f of ['error', 'html', 'stale']) {
      const c = await page(); try {
        await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__siteFail', '${f}')`);
        await newDraft(c, '新教程E', 1);
        await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
        const l = await committedList(c);
        const n0 = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'list.json'), 'utf8')).length;
        chk(`${this.name} [${f}]`, l && l.length === n0 + 1, `原 ${n0} 条 → 提交 ${l ? l.length : '?'} 条；${await pubTitle(c)}`);
      } finally { c.close(); }
    }
  },
  async 'P1-2 仓库读目录失败时中止发布并提示，不写空目录'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__repoListFail', '1')`);
      await newDraft(c, '新教程E2', 1);
      await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
      const patched = await c.ev(`__gh.patches`);
      chk(this.name, patched === 0, `移动分支次数 ${patched}；${await pubTitle(c)}`);
    } finally { c.close(); }
  },
  async 'P2-1 回应丢失后重试，发到同一个编号'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__ghMode', 'lost-once')`);
      await newDraft(c, '新教程F', 1);
      await c.ev(`document.getElementById('btn-publish').click()`);
      await waitFor(c, `!!document.getElementById('p-retry')`, 80);
      await c.ev(`document.getElementById('p-retry').click()`); await publishDone(c);
      const ids = await c.ev(`JSON.stringify(__gh.trees.map(t => (t.tree.find(x => /data\\.json$/.test(x.path)) || {}).path))`);
      const a = JSON.parse(ids);
      chk(this.name, a.length === 2 && a[0] === a[1], ids);
    } finally { c.close(); }
  },
  async 'P2-1 等构建时关页面、回来再发，发到同一个编号'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__notLive', '1')`);
      await newDraft(c, '新教程F2', 1);
      const slot = await c.ev(`SGWriter.slot`);
      await c.ev(`document.getElementById('btn-publish').click()`);
      await waitFor(c, `/构建/.test(document.getElementById('p-title').textContent)`, 80);
      const id1 = await c.ev(`(__gh.trees[0].tree.find(x => /data\\.json$/.test(x.path)) || {}).path`);
      await sleep(800);
      await c.ev(`localStorage.setItem('__notLive', '0')`);
      await c.goto(ROOT + '/w/?draft=' + encodeURIComponent(slot.replace(/^new:/, ''))); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 1`);
      await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
      const id2 = await c.ev(`(__gh.trees[0].tree.find(x => /data\\.json$/.test(x.path)) || {}).path`);
      chk(this.name, id1 === id2, `${id1} / ${id2}`);
    } finally { c.close(); }
  },
  async 'P2-2 改已发布教程：线上还是旧内容时不报「发布成功」'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await typeStep(c, 0, '（改）');
      await c.ev(`document.getElementById('btn-publish').click()`); await sleep(6000);
      const t = await pubTitle(c);
      chk(this.name, !/发布成功/.test(t), t);
    } finally { c.close(); }
  },
  async 'P2-3 token 失效时说清是 token 的问题，不建议挂代理'() {
    for (const m of ['401', '403']) {
      const c = await page(); try {
        await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__ghMode', '${m}')`);
        await newDraft(c, '新教程G', 1);
        await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
        const e = await c.ev(`document.querySelector('#p-row .err').textContent`);
        chk(`${this.name} [${m}]`, /token/.test(e) && !/代理/.test(e), e.split('\n')[0]);
      } finally { c.close(); }
    }
  },
  async 'P2-4 网络卡住时进度弹窗里有「取消」，点了就停'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__ghMode', 'hang')`);
      await newDraft(c, '新教程H', 1);
      await c.ev(`document.getElementById('btn-publish').click()`); await sleep(1500);
      const has = await c.ev(`!!document.getElementById('p-cancel') && !document.getElementById('p-cancel').hidden`);
      if (has) await c.ev(`document.getElementById('p-cancel').click()`);
      const ended = await waitFor(c, `!!document.querySelector('#p-row .err')`, 20);
      chk(this.name, has && ended, `取消键=${has}，点后出结果=${ended}`);
    } finally { c.close(); }
  },
  async 'P2-5 发布进行中 Esc 关不掉进度弹窗'() {
    const c = await page(1280, 800); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__ghMode', 'slow')`);
      await newDraft(c, '新教程I', 1);
      await c.ev(`document.getElementById('btn-publish').click()`);
      await waitFor(c, `__gh.patches > 0`, 40);
      for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(300);
      chk(this.name, await c.ev(`document.getElementById('dlg-prog').open`), '');
    } finally { c.close(); }
  },
  async 'P1-4 构造过的编辑编号被拒绝，不执行脚本'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      const evil = 'qhftq5kz/data.json?x=<img src=x onerror="window.__pwned=1">';
      await c.goto(ROOT + '/w/?edit=' + encodeURIComponent(evil)); await writerReady(c); await sleep(1200);
      const steps = await c.ev(`document.querySelectorAll('.step').length`);
      if (steps) { await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c); await sleep(500); }
      const p = await c.ev(`!!window.__pwned`);
      chk(this.name, steps === 0 && !p, `载入步数 ${steps}，脚本执行=${p}`);
    } finally { c.close(); }
  },
  async 'P1-4 教程库：目录里混进带 HTML 的编号也不执行、不显示'() {
    const evil = `(() => { const f = window.fetch; window.fetch = async (u, o) => { if (/contents\\/list\\.json/.test(String(u))) return new Response(JSON.stringify([{ id: 'x" onmouseover="1"><img src=x onerror="window.__pwned=1">', title: '<img src=x onerror="window.__pwned=2">', steps: '<b>3</b>', updated: '' }, { id: 'qhftq5kz', title: '正常', steps: 12, updated: '' }]), { status: 200 }); return f(u, o); }; })();`;
    const c = await page(390, 844, evil); try {
      await c.goto(ROOT + '/mine/'); await setCfg(c); await c.goto(ROOT + '/mine/');
      await waitFor(c, `document.querySelectorAll('.card').length > 0`); await sleep(500);
      const r = await c.ev(`JSON.stringify({ p: window.__pwned || 0, cards: document.querySelectorAll('.card').length })`);
      chk(this.name, /"p":0/.test(r) && /"cards":1/.test(r), r);
    } finally { c.close(); }
  },
  async 'P1-1 没填 token 的设备打开教程库看不到任何教程'() {
    const c = await page(); try {
      await c.goto(ROOT + '/mine/'); await sleep(1500);
      const n = await c.ev(`document.querySelectorAll('.card:not(.draft)').length`);
      const txt = await c.ev(`document.getElementById('list').textContent.slice(0, 60)`);
      chk(this.name, n === 0, `${n} 份；${txt}`);
    } finally { c.close(); }
  },
  async 'P1-1 首页不再说「猜不到」；删除确认不再说「从仓库删掉、没法撤销」那么绝对'() {
    const home = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const mine = fs.readFileSync(path.join(ROOT_DIR, 'mine/index.html'), 'utf8');
    chk(this.name, !/猜不到/.test(home) && /历史/.test(mine), '');
  },
  async 'P2-7 看到第 7 步时页面被重载，回到第 7 步'() {
    const c = await page(); try {
      await c.goto(ROOT + '/t/qhftq5kz/'); await waitFor(c, `document.querySelectorAll('.page').length > 0`);
      for (let i = 0; i < 6; i++) { await c.ev(`document.getElementById('next').click()`); await sleep(450); }
      await c.send('Page.reload', {}); await sleep(1500);
      const t = await c.ev(`document.getElementById('count').textContent`);
      chk(this.name, /^7 \//.test(t), t);
    } finally { c.close(); }
  },
  async 'P2-8 目录很大（2000 条）时照样能发布'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__listExtra', '2000')`);
      await newDraft(c, '大目录', 1);
      await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
      chk(this.name, /发布成功/.test(await pubTitle(c)), await pubTitle(c));
    } finally { c.close(); }
  },
  async 'P2-9 深浅两色下文字对比度达标'() {
    const CONTRAST = fs.readFileSync(path.join(__dirname, 'contrast.js'), 'utf8');
    for (const scheme of ['light', 'dark']) {
      const c = await page(); try {
        await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        await c.goto(ROOT + '/w/'); await setCfg(c);
        const fails = [];
        for (const p of ['/', '/w/', '/mine/', '/t/qhftq5kz/']) {
          await c.goto(ROOT + p); await sleep(900);
          if (p === '/w/') { await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`); await addImgs(c, 1); }
          const f = JSON.parse(await c.ev(CONTRAST));
          fails.push(...f.map(x => `${p} ${x.sel}「${x.text}」${x.ratio}`));
        }
        // 失败说明（红字）单独看
        await c.goto(ROOT + '/w/'); await writerReady(c); await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
        await c.ev(`localStorage.setItem('__ghMode', '401')`); await addImgs(c, 1); await setTitle(c, 'x'); await sleep(400);
        await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
        fails.push(...JSON.parse(await c.ev(CONTRAST)).filter(x => /err|danger/.test(x.sel)).map(x => `发布失败 ${x.sel} ${x.ratio}`));
        chk(`${this.name} [${scheme}]`, !fails.length, fails.slice(0, 5).join(' ; '));
      } finally { c.close(); }
    }
  },
  async 'P2-10 长网址/长密码不撑破版面（阅读页两种模式、教程库）'() {
    const edge = `(() => { const f = window.fetch; window.fetch = async (u, o) => { const s = String(u);
      if (s.split('?')[0].endsWith('data.json') && location.pathname.startsWith('/t/qhftq5kz')) { const d = await (await f(u, o)).json();
        d.steps[0].text = '打开 https://support.apple.com/zh-cn/guide/iphone/iphc5f3fde23/ios?utm_source=share&campaign=focusmode2026 照着做；Wi-Fi 密码 Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
        d.steps[0].title = 'Supercalifragilisticexpialidocious'.repeat(3); return new Response(JSON.stringify(d), { status: 200 }); }
      if (/contents\\/list\\.json/.test(s)) return new Response(JSON.stringify([{ id: 'qhftq5kz', title: 'Supercalifragilisticexpialidocious'.repeat(3), steps: 12, updated: '' }]), { status: 200 });
      return f(u, o); }; })();`;
    for (const w of [320, 390]) {
      const c = await page(w, 700, edge); try {
        const out = [];
        await c.goto(ROOT + '/t/qhftq5kz/'); await waitFor(c, `document.querySelectorAll('.page').length > 0`);
        for (const m of ['step', 'long']) {
          await c.ev(`document.documentElement.dataset.mode !== '${m}' && document.getElementById('modebtn').click()`); await sleep(400);
          out.push(await c.ev(`(() => { const s = document.querySelector('.say'); return '${m}:' + document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth + ' 卡片' + s.scrollWidth + '/' + s.clientWidth; })()`));
        }
        await c.goto(ROOT + '/mine/'); await setCfg(c); await c.goto(ROOT + '/mine/'); await waitFor(c, `document.querySelectorAll('.card').length > 0`);
        out.push(await c.ev(`'库:' + document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth`));
        const ok = out.every(s => s.split(' ').every(p => { const m = /(\d+)\/(\d+)/.exec(p); return !m || +m[1] <= +m[2] + 1; }));
        chk(`${this.name} [${w}]`, ok, out.join(' | '));
      } finally { c.close(); }
    }
  },
  async 'P2-13 编辑已发布教程时，说明框按内容撑开'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`); await sleep(300);
      const r = await c.ev(`JSON.stringify([...document.querySelectorAll('.stext')].map(t => t.clientHeight + '/' + t.scrollHeight).filter(s => { const [a, b] = s.split('/').map(Number); return a + 4 < b; }))`);
      chk(this.name, r === '[]', '被截断的框：' + r);
    } finally { c.close(); }
  },
  async 'P2-14 教程链接少了结尾「/」也能打开'() {
    const c = await page(); try {
      // 页面会自己 location.replace 补斜杠：goto 里读 readyState 时可能正好撞上跳转，这一下的报错不算
      try { await c.goto(ROOT + '/t/qhftq5kz'); } catch (e) { /* 跳转中 */ }
      await waitFor(c, `document.querySelectorAll('.page').length > 0`);
      const r = await c.ev(`document.querySelectorAll('.page').length + ' 步 @' + location.pathname`);
      chk(this.name, /^12 步/.test(r), r);
    } finally { c.close(); }
  },
  async 'P2-11 github.io 上的写作页/教程库会转去 jc.wbztl.xyz（含 # 后的设置码），并清掉那边存的 token'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/');
      const r = await c.ev(`JSON.stringify([SGPrimary.target('https://fjkkx77.github.io/Step-Guides/w/?edit=abcdefgh#cfg=xyz'), SGPrimary.target('https://fjkkx77.github.io/Step-Guides/mine/'), SGPrimary.target('https://jc.wbztl.xyz/w/'), SGPrimary.target('http://127.0.0.1:8879/w/')])`);
      chk(this.name, r === JSON.stringify(['https://jc.wbztl.xyz/w/?edit=abcdefgh#cfg=xyz', 'https://jc.wbztl.xyz/mine/', null, null]), r);
    } finally { c.close(); }
  },
  async 'P3-1 说明里写了 </script>，预览照常显示'() {
    const c = await page(); try {
      await newDraft(c, '讲网页的教程');
      await typeStep(c, 0, '在 HTML 里写 <script>alert(1)</script> 和 <!--<script> 就行'); await sleep(400);
      await c.ev(`document.getElementById('btn-preview').click()`); await sleep(2500);
      const n = await c.ev(`document.getElementById('pvframe').contentDocument.querySelectorAll('.page').length`);
      chk(this.name, n === 2, `${n} 步`);
    } finally { c.close(); }
  },
  async 'P3-2 读不出来的图会告诉用户'() {
    const c = await page(); try {
      await newDraft(c, '坏图');
      await c.ev(`SGWriter.addFiles([new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'IMG_0001.HEIC', { type: 'image/heic' })])`); await sleep(800);
      const t = await c.ev(`[...document.querySelectorAll('dialog.sg-ui[open]')].map(d => d.textContent).join('') + document.getElementById('addhint').textContent`);
      chk(this.name, /IMG_0001\.HEIC/.test(t), t.slice(0, 80));
    } finally { c.close(); }
  },
  async 'P3-3 长文模式从目录跳步，这一步的开头不被顶栏盖住'() {
    const c = await page(); try {
      await c.goto(ROOT + '/t/qhftq5kz/'); await waitFor(c, `document.querySelectorAll('.page').length > 0`);
      await c.ev(`document.documentElement.dataset.mode !== 'long' && document.getElementById('modebtn').click()`); await sleep(400);
      await c.ev(`document.querySelector('.stepsbtn').click()`); await sleep(400);
      await c.ev(`document.querySelector('.scell[data-i="5"]').click()`); await sleep(1500);
      const r = JSON.parse(await c.ev(`JSON.stringify({ top: document.querySelector('.top').getBoundingClientRect().bottom, page: document.querySelector('.page[data-i="5"]').getBoundingClientRect().top })`));
      chk(this.name, r.page >= r.top - 1, JSON.stringify(r));
    } finally { c.close(); }
  },
  async 'P3-4 教程库日期按本地时间（北京时间早上 6 点发布显示当天）'() {
    const fake = `(() => { const f = window.fetch; window.fetch = async (u, o) => { if (/contents\\/list\\.json/.test(String(u))) return new Response(JSON.stringify([{ id: 'qhftq5kz', title: '时区', steps: 12, updated: '2026-10-08T22:00:00.000Z' }]), { status: 200 }); return f(u, o); }; })();`;
    const c = await page(390, 844, fake); try {
      await c.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
      await c.goto(ROOT + '/mine/'); await setCfg(c); await c.goto(ROOT + '/mine/');
      await waitFor(c, `document.querySelectorAll('.card').length > 0`);
      const m = await c.ev(`document.querySelector('.card .meta').textContent`);
      chk(this.name, /2026-10-09/.test(m), m);
    } finally { c.close(); }
  },
  async 'P3-5 新建教程页刚打开就点返回，不误弹「离开？」'() {
    const slowIdb = `(() => { const o = indexedDB.open.bind(indexedDB); indexedDB.open = (...a) => { const r = o(...a); let cb = null;
      Object.defineProperty(r, 'onsuccess', { set(f) { cb = f; }, get() { return cb; } }); r.addEventListener('success', e => setTimeout(() => cb && cb.call(r, e), 500)); return r; }; })();`;
    const c = await page(390, 844, slowIdb); try {
      await c.goto(ROOT + '/w/');
      await waitFor(c, `!!(document.getElementById('btn-home2') && document.getElementById('btn-home2').onclick)`, 40, 20);
      await c.ev(`document.getElementById('btn-home2').click()`); await sleep(400);
      const r = await c.ev(`!!(document.getElementById('dlg-leave') && document.getElementById('dlg-leave').open)`);
      chk(this.name, !r, `弹窗=${r}`);
    } finally { c.close(); }
  },
  async 'P3-6 页面源码里不再有原生 alert/confirm/prompt'() {
    const hits = [];
    for (const f of ['assets/writer.js', 'mine/index.html', 'assets/reader.js', 'index.html', 'w/index.html', 'assets/ui.js']) {
      let s = ''; try { s = fs.readFileSync(path.join(ROOT_DIR, f), 'utf8'); } catch (e) { continue; }
      s.split(/\r?\n/).forEach((l, i) => { if (/(^|[^.\w])(alert|confirm|prompt)\(/.test(l.replace(/\/\/.*$/, ''))) hits.push(`${f}:${i + 1}`); });
    }
    chk(this.name, !hits.length, hits.join(' '));
  },
  async 'P3-9 草稿存不进去时会提示'() {
    const full = `(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; })();`;
    const c = await page(390, 844, full); try {
      await c.goto(ROOT + '/w/'); await writerReady(c);
      await addImgs(c, 1); await setTitle(c, '存不进去'); await sleep(900);
      const t = await c.ev(`document.getElementById('savetag').hidden ? '' : document.getElementById('savetag').textContent`);
      chk(this.name, /没存上/.test(t), t);
    } finally { c.close(); }
  },
  async 'P3-11 教程库读不到目录时说「读取失败」，不说「还没有」'() {
    const c = await page(); try {
      await c.goto(ROOT + '/mine/'); await setCfg(c); await c.ev(`localStorage.setItem('__repoListFail', '1')`);
      await c.goto(ROOT + '/mine/'); await sleep(1500);
      const t = await c.ev(`document.getElementById('list').textContent`);
      chk(this.name, /读取|读不到|失败/.test(t) && !/还没有 list\.json/.test(t), t.slice(0, 60));
    } finally { c.close(); }
  },
  async 'P3-12 删掉一份教程时，本机对它的编辑草稿一起清掉'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      // 用目录里真有的一份（样例 qhftq5kz 不在 list.json 里）
      await c.goto(ROOT + '/w/?edit=vrrn82xd'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length > 0`);
      await typeStep(c, 0, '改'); await sleep(700);
      const before = await allDrafts(c);
      await c.goto(ROOT + '/mine/'); await waitFor(c, `!!document.querySelector('[data-del="vrrn82xd"]')`);
      await c.ev(`document.querySelector('[data-del="vrrn82xd"]').click()`); await sleep(300);
      await c.ev(`document.getElementById('del-yes').click()`);
      await waitFor(c, `/已从仓库删除/.test(document.getElementById('p-title').textContent)`, 40);
      const d = await allDrafts(c);
      chk(this.name, /edit:vrrn82xd/.test(before) && !/edit:vrrn82xd/.test(d), `删前 ${before}；删后 ${d}`);
    } finally { c.close(); }
  },
  /* ── 修复后 /code-review 找出的问题（CR-编号对应修复记录） ── */
  async 'CR-1 改已发布教程：「接着上次的修改？」按 Esc 关掉，修改还在'() {
    const c = await page(1280, 800); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await typeStep(c, 0, '我的修改'); await sleep(800);
      await c.goto(ROOT + '/w/?edit=qhftq5kz');
      await waitFor(c, `document.getElementById('dlg-resume') && document.getElementById('dlg-resume').open`);
      for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await writerReady(c); await sleep(500);
      const r = await c.ev(`JSON.stringify({ text: (document.querySelector('.stext') || {}).value, slots: 0 })`);
      const d = await allDrafts(c);
      chk(this.name, /我的修改/.test(r) && /edit:qhftq5kz/.test(d), r + ' ' + d);
    } finally { c.close(); }
  },
  async 'CR-2 选「放弃修改用线上版本」但线上读不到：本地修改不删'() {
    const fail = `(() => { const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('qhftq5kz/data.json') && sessionStorage.getItem('__failData')) throw new TypeError('Failed to fetch'); return f(u, o); }; })();`;
    const c = await page(390, 844, fail); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c);
      await waitFor(c, `document.querySelectorAll('.step').length === 12`);
      await typeStep(c, 0, '我的修改'); await sleep(800);
      await c.ev(`sessionStorage.setItem('__failData', '1')`);
      await c.goto(ROOT + '/w/?edit=qhftq5kz');
      await waitFor(c, `document.getElementById('dlg-resume') && document.getElementById('dlg-resume').open`);
      await c.ev(`document.getElementById('rs-new').click()`); await sleep(1500);
      const d = await allDrafts(c);
      chk(this.name, /edit:qhftq5kz/.test(d), d);
    } finally { c.close(); }
  },
  async 'CR-3 编辑页没读到内容：页面锁住，不会显示「已保存」'() {
    const fail = `(() => { const f = window.fetch; window.fetch = async (u, o) => { if (String(u).includes('qhftq5kz/data.json')) throw new TypeError('Failed to fetch'); return f(u, o); }; })();`;
    const c = await page(390, 844, fail); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await c.goto(ROOT + '/w/?edit=qhftq5kz'); await writerReady(c); await sleep(500);
      await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
      await c.ev(`document.getElementById('btn-save').click()`); await sleep(500);
      const r = await c.ev(`JSON.stringify({ pub: document.getElementById('btn-publish').disabled, add: document.getElementById('addzone').hidden, tag: document.getElementById('savetag').hidden ? '' : document.getElementById('savetag').textContent })`);
      chk(this.name, /"pub":true/.test(r) && /"add":true/.test(r) && !/已保存/.test(r), r);
    } finally { c.close(); }
  },
  async 'CR-4 「移动分支」那一步回应丢了：不说「仓库不会留下半个教程」'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c); await c.ev(`localStorage.setItem('__ghMode', 'lost-once')`);
      await newDraft(c, '新教程CR4', 1);
      await c.ev(`document.getElementById('btn-publish').click()`);
      await waitFor(c, `!!document.getElementById('p-retry')`, 80);
      const r = await c.ev(`document.getElementById('p-title').textContent + '｜' + document.querySelector('#p-row .err').textContent`);
      chk(this.name, /不确定/.test(r) && !/不会留下半个教程/.test(r), r.slice(0, 60));
    } finally { c.close(); }
  },
  async 'CR-5 同一份草稿在另一页保存时，不删这一页存的图'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await writerReady(c);
      const r = await c.ev(`(async () => {
        const b = new Blob(['x'], { type: 'image/png' });
        await SGStore.save('new:cr5', { title: 't', steps: [{ key: 'aaa', blob: b }] }, [{ key: 'aaa', blob: b }]);
        await SGStore.save('new:cr5', { title: 't', steps: [{ key: 'bbb', blob: b }] }, [{ key: 'bbb', blob: b }]);   // 另一页：不知道 aaa
        const d = await SGStore.load('new:cr5'); return 'bbb 在=' + !!d.steps[0].blob;
      })()`);
      const still = await c.ev(`new Promise(res => { const q = indexedDB.open('step-guides'); q.onsuccess = () => { const g = q.result.transaction('blobs').objectStore('blobs').get('new:cr5|aaa'); g.onsuccess = () => { res(!!g.result); q.result.close(); }; }; })`);
      chk(this.name, still === true, `${r}，aaa 还在=${still}`);
    } finally { c.close(); }
  },
  async 'CR-6 报错说明：真断网才说网络，别的错不说「换网络」'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await writerReady(c);
      const r = JSON.parse(await c.ev(`JSON.stringify([SGGitHub.explain(new TypeError('Failed to fetch')), SGGitHub.explain(new TypeError('Load failed')), SGGitHub.explain(new Error('仓库里的 list.json 读出来不是教程列表')), SGGitHub.explain(new RangeError('canvas 太大'))])`));
      chk(this.name, /代理/.test(r[0]) && /代理/.test(r[1]) && !/代理|换个网络/.test(r[2]) && !/代理|换个网络/.test(r[3]), r.map(x => x.split('\n')[0]).join(' ｜ '));
    } finally { c.close(); }
  },
  async 'CR-8 只填了标题、没加图的新草稿不留在草稿库里'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await writerReady(c);
      await setTitle(c, '只有标题'); await sleep(800);
      const d = await allDrafts(c);
      chk(this.name, !/只有标题/.test(d), d);
    } finally { c.close(); }
  },
  async 'O-1 教程库里能看到没发完的草稿'() {
    const c = await page(); try {
      await newDraft(c, '草稿箱里的那份');
      await c.goto(ROOT + '/mine/'); await sleep(1200);
      const t = await c.ev(`[...document.querySelectorAll('.card.draft')].map(x => x.textContent).join('|')`);
      chk(this.name, /草稿箱里的那份/.test(t), t.slice(0, 80));
    } finally { c.close(); }
  },
  async 'O-2 发布的教程页带真实标题和预览图'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await setCfg(c);
      await newDraft(c, '设置 <专注> 模式', 1);
      await c.ev(`document.getElementById('btn-publish').click()`); await publishDone(c);
      const shell = JSON.parse(await decodeBlobs(c)).find(s => /<!DOCTYPE html>/.test(s)) || '';
      chk(this.name, /<title>设置 &lt;专注&gt; 模式<\/title>/.test(shell) && /og:image" content="https?:\/\/[^"]+\/i\/[a-z0-9]+\.(webp|jpg|png)"/.test(shell), (shell.match(/<title>.*<\/title>|og:image[^>]+/g) || []).join(' '));
    } finally { c.close(); }
  },
  async 'O-4 阅读页提前加载后两步的图'() {
    const c = await page(); try {
      await c.goto(ROOT + '/t/qhftq5kz/'); await waitFor(c, `document.querySelectorAll('.page').length > 0`); await sleep(1200);
      // Chrome 自己的懒加载距离很大，「图加载好了没有」测不出差别；直接看后两步是不是被标成立即加载
      const r = await c.ev(`JSON.stringify([1, 2].map(i => document.querySelector('.page[data-i="' + i + '"] .shot img').loading))`);
      chk(this.name, r === '["eager","eager"]', r);
    } finally { c.close(); }
  },
  async 'O-7 选图按文件名里的数字排序'() {
    const c = await page(); try {
      await c.goto(ROOT + '/w/'); await writerReady(c);
      await c.ev(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
      await addImgs(c, 3, ['截图10.png', '截图2.png', '截图1.png']);
      const r = await c.ev(`JSON.stringify(SGWriter.draft.steps.map(s => s.name))`);
      chk(this.name, r === JSON.stringify(['截图1.png', '截图2.png', '截图10.png']), r);
    } finally { c.close(); }
  },
  async 'O-8 写作页提示用中性用词'() {
    const s = fs.readFileSync(path.join(ROOT_DIR, 'assets/writer.js'), 'utf8');
    chk(this.name, !/跟她/.test(s), '');
  },
};

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock.js'), ROOT_DIR, String(PORT)], { stdio: 'ignore' });
  try {
    await sleep(600);
    for (const [name, fn] of Object.entries(CASES)) {
      if (ONLY && !name.startsWith(ONLY)) continue;
      try { await fn.call({ name }); } catch (e) { chk(name, false, '运行出错：' + e.message); }
    }
  } finally { try { srv.kill(); } catch (e) {} }
  console.log(bad ? `\n共 ${ran} 条，${bad} 条未通过` : `\n全部通过（${ran} 条）`);
  process.exit(bad ? 1 : 0);
})();
