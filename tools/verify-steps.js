/* 阅读页的「全部步骤」面板：手机底部抽屉 / 电脑左侧抽屉，点一下跳过去 */
const { open, sleep } = require('./cdp.js');
const PORT = 8879;
const PAGE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 't/qhftq5kz/';
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const url = BASE ? BASE.replace(/\/$/, '') + '/' + PAGE : `http://127.0.0.1:${PORT}/${PAGE}`;

const waitFor = async (c, expr, n = 40) => {
  for (let i = 0; i < n; i++) { await sleep(250); if (await c.ev(expr)) return true; }
  return false;
};

async function run(w, h, label) {
  const c = await open(w, h, 2);
  const out = [];
  const chk = (n, ok, d) => out.push({ n, ok, d });
  try {
    await c.goto(url);
    await waitFor(c, `!!document.querySelector('.page')`);

    const btn = JSON.parse(await c.ev(`(() => {
      const b = document.querySelector('.stepsbtn');
      if (!b) return JSON.stringify({ exists: false });
      const r = b.getBoundingClientRect();
      return JSON.stringify({ exists: true, text: b.textContent.trim(),
                              w: Math.round(r.width), h: Math.round(r.height) });
    })()`));
    chk('顶栏有「全部步骤」按钮且热区够', btn.exists && btn.h >= 44, `${btn.text} ${btn.w}×${btn.h}`);
    const total = +(await c.ev(`window.SGReaderSteps || document.querySelectorAll('.page').length`));
    chk('按钮上显示总步数', btn.text.indexOf(String(total)) >= 0, `${btn.text}（共 ${total} 步）`);

    await c.ev(`document.querySelector('.stepsbtn').click()`);
    await sleep(500);
    const open1 = JSON.parse(await c.ev(`(() => {
      const m = document.querySelector('.steps-mask'), a = document.querySelector('.steps');
      const cells = document.querySelectorAll('.scell');
      const r = a.getBoundingClientRect();
      const one = cells[0] ? cells[0].getBoundingClientRect() : null;
      return JSON.stringify({
        shown: !m.hidden && m.classList.contains('on'),
        cells: cells.length,
        panelW: Math.round(r.width), panelH: Math.round(r.height),
        panelLeft: Math.round(r.left), panelTop: Math.round(r.top),
        cellW: one ? Math.round(one.width) : 0, cellH: one ? Math.round(one.height) : 0,
        imgLoaded: !!(cells[0] && cells[0].querySelector('img'))
      });
    })()`));
    chk('面板打开了', open1.shown === true);
    chk('每一步都有一格缩略图', open1.cells === total, `${open1.cells} 格 / ${total} 步`);
    chk('缩略图格子够大（好点）', open1.cellW >= 88 && open1.cellH >= 100, `${open1.cellW}×${open1.cellH}`);
    chk('面板没有超出屏幕', open1.panelLeft >= -1 && open1.panelW <= w + 1 && open1.panelTop >= -1,
        `${open1.panelW}×${open1.panelH} @${open1.panelLeft},${open1.panelTop}`);
    chk('无横向溢出', (await c.ev(`document.documentElement.scrollWidth`)) <= w + 1);

    // 跳到最后一步（不写死第几格：不同教程步数不一样）
    const target = total - 1;
    await c.ev('document.querySelectorAll(".scell")[' + target + '].click()');
    // 平滑滚动要时间，等它停下来再读（电脑宽屏上尤其慢）
    await waitFor(c, 'document.getElementById("count").textContent.trim().indexOf("' + total + ' /") === 0', 16);
    await sleep(200);
    const after = JSON.parse(await c.ev(`JSON.stringify({
      count: document.getElementById('count').textContent.trim(),
      closed: document.querySelector('.steps-mask').hidden || !document.querySelector('.steps-mask').classList.contains('on')
    })`));
    chk('点缩略图跳到那一步', after.count.indexOf(total + ' /') === 0, after.count);
    chk('跳完面板自动关掉', after.closed === true);

    // 再打开：当前步要高亮
    await c.ev(`document.querySelector('.stepsbtn').click()`);
    await sleep(500);
    chk('再打开时当前步高亮',
        (await c.ev('(() => { const n = document.querySelector(".scell.now"); return !!n && +n.dataset.i === ' + target + '; })()')) === true);

    // 点遮罩关闭
    await c.ev(`(() => { const m = document.querySelector('.steps-mask');
      m.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
    await sleep(500);
    chk('点空白处能关掉', (await c.ev(`!document.querySelector('.steps-mask').classList.contains('on')`)) === true);
  } finally {
    await c.close();
  }
  console.log(`\n── ${label}（${w}×${h}）`);
  out.forEach(r => console.log(`   ${r.ok ? 'PASS' : 'FAIL'} ${r.n}${r.d ? ' — ' + r.d : ''}`));
  return out.filter(r => !r.ok).length;
}

(async () => {
  let bad = 0;
  bad += await run(390, 844, '手机');
  bad += await run(320, 568, '窄屏');
  bad += await run(1280, 800, '电脑');
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
