const { open, sleep } = require('./cdp.js');
// 默认验本地；传 --base=https://… 可以直接验线上
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=').slice(1).join('=');
const PAGE = (process.argv.find(a => !a.startsWith('--') && a.indexOf('/t/') >= 0 || /^t\//.test(a || '')) || 't/qhftq5kz/');
const URL = (BASE ? BASE.replace(/\/$/, '') + '/' : 'http://127.0.0.1:8879/') + PAGE;
(async () => {
  let bad = 0;
  const chk = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) bad++; };
  const c = await open(390, 844, 2);
  await c.goto(URL);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await c.ev(`!!document.querySelector('.page')`)) break; }
  await c.ev(`localStorage.setItem('sg.readMode','long')`);
  await c.goto(URL);
  for (let i = 0; i < 40; i++) { await sleep(250); if (await c.ev(`!!document.querySelector('.page')`)) break; }
  // 等模式真的切过去再断言：mode 是 boot 里才设的，读早了会拿到默认值
  let isLong = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    if ((await c.ev(`document.documentElement.dataset.mode`)) === 'long') { isLong = true; break; }
  }
  chk('确实在长文模式', isLong);
  chk('刚进来没有悬浮键', (await c.ev(`(() => { const f = document.querySelector('.fab'); return !f || !f.classList.contains('on'); })()`)) === true);

  // 页面本身不够长就没有"滚远"这回事（步数少的教程会这样），这时跳过后面几条
  const canScroll = await c.ev(`document.documentElement.scrollHeight > innerHeight + 900`);
  if (!canScroll) {
    console.log('SKIP 这份教程在长文模式下不足一屏半，"滚远"相关的几条跳过');
    await c.close();
    console.log(bad ? ('共 ' + bad + ' 条未通过') : '全部通过（部分跳过）');
    process.exit(bad ? 1 : 0);
  }
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
