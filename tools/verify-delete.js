/* 教程库的删除：UI 到位 + 真删一次（先发一份临时教程，删完确认仓库里没了）
   会真的往仓库写两次（发布 + 删除），跑完不留痕。 */
const { open, sleep } = require('./cdp.js');
const { execSync } = require('child_process');
const PORT = 8879;
const OWNER = 'fjkkx77', REPO = 'Step-Guides';

const waitFor = async (c, expr, n = 40) => {
  for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; }
  return false;
};

(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
  const id = 'zztest' + Math.random().toString(36).slice(2, 4);

  // ① 先发一份临时教程（直接用 publish，不走写作页，省时间）
  const c = await open(1100, 800, 1);
  await c.goto(`http://127.0.0.1:${PORT}/w/`);
  await waitFor(c, "!!window.SGGitHub");
  const made = await c.ev(`(async () => {
    const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const data = { v: 1, id: ${JSON.stringify(id)}, title: '删除测试用', created: '2026-09-19',
                   steps: [{ img: 'a.webp', w: 100, h: 100, title: '', text: 'x' }] };
    const img = await fetch('../t/qhftq5kz/i/01.webp').then(r => r.blob());
    const buf = new Uint8Array(await img.arrayBuffer());
    let s2 = ''; for (const b of buf) s2 += String.fromCharCode(b);
    let list = [];
    try { list = await window.SGGitHub.getJson('../list.json'); } catch (e) {}
    list = [{ id: ${JSON.stringify(id)}, title: '删除测试用', steps: 1, updated: new Date().toISOString() },
            ...list.filter(x => x.id !== ${JSON.stringify(id)})];
    try {
      const r = await window.SGGitHub.publish({
        token: ${JSON.stringify(token)}, owner: '${OWNER}', repo: '${REPO}', branch: 'main',
        files: [
          { path: 't/${id}/index.html', content: b64('<!DOCTYPE html><meta charset="utf-8">x') },
          { path: 't/${id}/data.json', content: b64(JSON.stringify(data)) },
          { path: 't/${id}/i/a.webp', content: btoa(s2) },
          { path: 'list.json', content: b64(JSON.stringify(list, null, 1)) }
        ],
        message: '测试：造一份待删教程'
      });
      return JSON.stringify({ ok: true, commit: r.commit.slice(0, 7) });
    } catch (e) { return JSON.stringify({ ok: false, err: e.message }); }
  })()`);
  const m = JSON.parse(made);
  chk('造出一份临时教程', m.ok, m.ok ? 'commit=' + m.commit : m.err);
  if (!m.ok) { await c.close(); process.exit(1); }
  await c.close();

  // ② 打开教程库（本地页面读的是本地 list.json，所以注入一条假数据来验 UI）
  const p = await open(390, 844, 2);
  await p.goto(`http://127.0.0.1:${PORT}/mine/`);
  await waitFor(p, "!!window.SGMine");
  await p.ev(`(() => {
    localStorage.setItem('sg.cfg', JSON.stringify({ owner: '${OWNER}', repo: '${REPO}',
      branch: 'main', token: ${JSON.stringify(token)} }));
  })()`);
  await p.goto(`http://127.0.0.1:${PORT}/mine/`);
  await waitFor(p, "!!window.SGMine");
  await sleep(600);

  const ui = JSON.parse(await p.ev(`(() => {
    const b = document.querySelector('button[data-del]');
    const r = b ? b.getBoundingClientRect() : null;
    return JSON.stringify({
      has: !!b, text: b ? b.textContent.trim() : '',
      h: r ? Math.round(r.height) : 0,
      overflow: document.documentElement.scrollWidth <= innerWidth + 1
    });
  })()`));
  chk('每份教程都有删除键，热区够', ui.has && ui.h >= 44, `${ui.text} 高 ${ui.h}`);
  chk('窄屏下不溢出', ui.overflow === true);

  await p.ev(`document.querySelector('button[data-del]').click()`);
  await sleep(400);
  const dlg = JSON.parse(await p.ev(`JSON.stringify({
    open: document.getElementById('dlg-del').open,
    title: document.getElementById('del-title').textContent,
    warn: document.querySelector('#dlg-del p').textContent
  })`));
  chk('删除前二次确认（不是原生 confirm）', dlg.open === true, dlg.title);
  chk('确认框里说清了后果', /链接会立刻失效/.test(dlg.warn));
  await p.ev(`document.getElementById('del-no').click()`);
  await sleep(200);
  chk('点取消不会删', (await p.ev(`document.getElementById('dlg-del').open`)) === false);
  await p.close();

  // ③ 真删：在线上那份教程库里删掉刚造的这一份
  const d = await open(390, 844, 2);
  await d.goto(`http://127.0.0.1:${PORT}/mine/`);
  await waitFor(d, "!!window.SGMine");
  await d.ev(`localStorage.setItem('sg.cfg', JSON.stringify({ owner: '${OWNER}', repo: '${REPO}',
    branch: 'main', token: ${JSON.stringify(token)} }))`);
  await d.goto(`http://127.0.0.1:${PORT}/mine/`);
  await waitFor(d, "!!window.SGMine");
  const res = await d.ev(`(async () => {
    try {
      await window.SGMine.doDelete({ id: ${JSON.stringify(id)}, title: '删除测试用' });
      await new Promise(r => setTimeout(r, 1500));
      return document.getElementById('p-title').textContent;
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  chk('删除流程跑完', /已从仓库删除/.test(res), res);
  await d.close();

  let gone = false;
  try { execSync(`gh api repos/${OWNER}/${REPO}/contents/t/${id}`, { stdio: 'pipe' }); }
  catch (e) { gone = true; }
  chk('仓库里整个教程目录都没了（图片也删了）', gone);

  const stillListed = execSync(`gh api repos/${OWNER}/${REPO}/contents/list.json --jq ".content"`,
                               { encoding: 'utf8' }).trim();
  const listJson = Buffer.from(stillListed.replace(/\n/g, ''), 'base64').toString('utf8');
  chk('索引里也删掉了', listJson.indexOf(id) < 0);

  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
