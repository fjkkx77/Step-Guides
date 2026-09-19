const { open, sleep } = require('./cdp.js');
(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  const c = await open(390, 844, 2);
  await c.goto('http://127.0.0.1:8879/t/qhftq5kz/');
  for (let i = 0; i < 40; i++) { await sleep(250); if (await c.ev(`!!document.querySelector('.page')`)) break; }
  await c.ev(`localStorage.setItem('sg.readMode','long')`);
  await c.goto('http://127.0.0.1:8879/t/qhftq5kz/');
  for (let i = 0; i < 40; i++) { await sleep(250); if (await c.ev(`!!document.querySelector('.page')`)) break; }
  // 等模式真的切过去再断言：mode 是 boot 里才设的，读早了会拿到默认值
  let isLong = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    if ((await c.ev(`document.documentElement.dataset.mode`)) === 'long') { isLong = true; break; }
  }
  chk('确实在长文模式', isLong);
  chk('刚进来没有悬浮键', (await c.ev(`(() => { const f = document.querySelector('.fab'); return !f || !f.classList.contains('on'); })()`)) === true);

  await c.ev(`scrollTo(0, 2500)`);
  await sleep(600);
  const st = JSON.parse(await c.ev(`JSON.stringify((() => {
    const t = document.querySelector('.top').getBoundingClientRect();
    const f = document.querySelector('.fab');
    const fr = f ? f.getBoundingClientRect() : null;
    const btn = document.querySelector('.stepsbtn').getBoundingClientRect();
    return { topY: Math.round(t.top), topVisible: t.bottom > 0 && t.top < 100,
             stepsBtnVisible: btn.top >= 0 && btn.bottom <= innerHeight,
             fabOn: !!f && f.classList.contains('on'),
             fabSize: fr ? [Math.round(fr.width), Math.round(fr.height)] : null,
             scrollY: Math.round(scrollY) };
  })())`));
  chk('滚远之后顶栏仍然吸在最上面', st.topVisible && st.topY <= 1, `top=${st.topY} scrollY=${st.scrollY}`);
  chk('「全部步骤」按钮一直够得着', st.stepsBtnVisible === true);
  chk('滚远后出现回顶部悬浮键', st.fabOn === true);
  chk('悬浮键够大（≥44px）', st.fabSize && st.fabSize[0] >= 44 && st.fabSize[1] >= 44, String(st.fabSize));

  await c.ev(`document.querySelector('.fab').click()`);
  for (let i = 0; i < 20; i++) { await sleep(200); if ((await c.ev(`scrollY`)) < 10) break; }
  chk('点一下回到最顶部', (await c.ev(`scrollY`)) < 10, '现在 scrollY=' + await c.ev(`Math.round(scrollY)`));
  await sleep(400);
  chk('回到顶部后悬浮键自己收起', (await c.ev(`!document.querySelector('.fab').classList.contains('on')`)) === true);

  // 逐步模式下不该有这个悬浮键
  await c.ev(`document.getElementById('modebtn').click()`);
  await sleep(600);
  chk('逐步模式下悬浮键不出现', (await c.ev(`getComputedStyle(document.querySelector('.fab')).display`)) === 'none');

  await c.close();
  console.log(bad ? `\n共 ${bad} 条未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
