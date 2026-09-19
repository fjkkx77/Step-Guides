/* 「移到第几步」：长距离移动是这个功能的真正用途 */
const { open, sleep } = require('./cdp.js');
(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  const c = await open(390, 844, 2);
  await c.goto('http://127.0.0.1:8879/w/');
  await sleep(700);
  // 灌 6 步
  await c.ev(`(async () => {
    const b = await fetch('../t/qhftq5kz/i/01.webp').then(r => r.blob());
    const fs = [];
    for (let i = 1; i <= 6; i++) fs.push(new File([b], 'f' + i + '.webp', { type: b.type }));
    await window.SGWriter.addFiles(fs);
    document.querySelectorAll('.stext').forEach((t, i) => {
      t.value = '第' + (i + 1) + '步'; t.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await sleep(800);

  const ops = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.step')[0].querySelectorAll('.ops > *')]
    .map(b => b.textContent.trim() || '⠿'))`));
  chk('卡片上不再有 ↑↓，换成了「移到…」', !ops.includes('↑') && ops.some(t => /移到/.test(t)), ops.join(' | '));

  await c.ev(`document.querySelectorAll('.step')[1].querySelector('button[data-op="to"]').click()`);
  await sleep(400);
  const dlg = JSON.parse(await c.ev(`JSON.stringify({
    open: document.getElementById('dlg-more').open,
    title: document.getElementById('m-title').textContent,
    desc: document.getElementById('m-desc').textContent,
    chips: document.querySelectorAll('#m-chips .chip').length,
    now: (document.querySelector('#m-chips .chip.now') || {}).textContent,
    first: !!document.getElementById('m-first'), last: !!document.getElementById('m-last')
  })`));
  chk('弹层打开且写清是哪一步', dlg.open && /第 2 步/.test(dlg.title), dlg.title);
  chk('每一步都有一个数字可点', dlg.chips === 6, dlg.chips + ' 个');
  chk('当前位置有高亮', dlg.now === '2', '高亮在 ' + dlg.now);
  chk('另给「移到最前/最后」', dlg.first && dlg.last);

  // 把第 2 步移到第 6 步（长距离）
  await c.ev(`document.querySelectorAll('#m-chips .chip')[5].click()`);
  await sleep(500);
  const order = JSON.parse(await c.ev(`JSON.stringify(window.SGWriter.draft.steps.map(s => s.text))`));
  chk('第 2 步真的移到了第 6 步', order.join(',') === '第1步,第3步,第4步,第5步,第6步,第2步', order.join(','));

  // 移到最前
  await c.ev(`document.querySelectorAll('.step')[5].querySelector('button[data-op="to"]').click()`);
  await sleep(300);
  await c.ev(`document.getElementById('m-first').click()`);
  await sleep(500);
  const order2 = JSON.parse(await c.ev(`JSON.stringify(window.SGWriter.draft.steps.map(s => s.text))`));
  chk('「移到最前面」有效', order2[0] === '第2步', order2.join(','));

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
