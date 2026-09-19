/* 写作页：选图 → 敲字 → 发布。电脑和手机都能从头写。
   草稿（含图片 Blob）存 IndexedDB，发布失败也不会丢。 */
(() => {
  'use strict';

  const { compress, toBase64 } = window.SGImg;
  const { randomId, publish, waitLive, getJson } = window.SGGitHub;
  const Store = window.SGStore;

  const $ = s => document.querySelector(s);
  const CFG_KEY = 'sg.cfg';

  // 每个教程页的壳子：逻辑都在公共 reader.js 里，这里只有引用
  const SHELL = id => `<!DOCTYPE html>
<html lang="zh-CN" data-mode="step">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111114" media="(prefers-color-scheme: dark)">
<title>教程</title>
<link rel="stylesheet" href="../../assets/base.css">
<link rel="stylesheet" href="../../assets/reader.css">
</head>
<body>
<header class="top">
  <h1 id="title">正在加载…</h1>
  <button class="modebtn tap" id="modebtn" type="button">☰ 长文</button>
</header>
<div class="topbar-progress"><div class="bar"><i id="fill"></i></div></div>
<div class="deck" id="deck"></div>
<nav class="bottom">
  <button class="tap" id="prev" type="button">‹ 上一步</button>
  <span class="count" id="count">1 / 1</span>
  <button class="tap" id="next" type="button">下一步 ›</button>
</nav>
<dialog id="zoom">
  <div class="box"><img id="zoomimg" alt=""></div>
  <button class="close" type="button" aria-label="关闭">✕</button>
</dialog>
<script src="../../assets/reader.js"></script>
</body>
</html>
`;

  /* ── 状态 ─────────────────────────────────────────── */
  let draft = { id: null, title: '', steps: [], known: [] };  // known = 线上已有的图片文件名
  let cfg = { owner: '', repo: 'Step-Guides', branch: 'main', token: '' };

  const loadCfg = () => {
    try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch (e) { /* 忽略 */ }
  };
  const saveCfg = () => {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { alert('这台设备不让存设置（隐私模式？）'); }
  };

  /** 站点根：线上用当前域名，本地开发时回落到 GitHub Pages 地址 */
  function siteRoot() {
    const local = /^(127\.|localhost|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:';
    if (!local) return new URL('../', location.href).href;
    return `https://${cfg.owner || 'USER'}.github.io/${cfg.repo}/`;
  }

  /* ── 渲染 ─────────────────────────────────────────── */
  function render() {
    const list = $('#list');
    if (!draft.steps.length) {
      list.innerHTML = '<div class="empty">还没有图片。<br>点下面的「选择图片」，或直接 Ctrl+V 粘贴截图。</div>';
      return;
    }
    list.replaceChildren(...draft.steps.map((s, i) => {
      const card = document.createElement('article');
      card.className = 'step';
      card.dataset.i = i;
      card.innerHTML = `
        <div class="thumb"><img alt=""></div>
        <button class="no tap" type="button" data-op="to" aria-label="移到第几步"><i>${i + 1}</i></button>
        <div class="fields">
          <input class="stitle" type="text" placeholder="这一步做什么（可不填）" autocomplete="off">
          <textarea class="stext" rows="3" placeholder="跟她说清楚这一步要点哪里、注意什么"></textarea>
        </div>
        <div class="ops">
          <div class="handle" title="按住拖动排序" draggable="true">⠿</div>
          <button class="icon" type="button" data-op="up" aria-label="上移">↑</button>
          <button class="icon" type="button" data-op="down" aria-label="下移">↓</button>
          <button class="grow" type="button" data-op="swap">🖼 换图</button>
          <button class="grow danger" type="button" data-op="del">🗑 删除</button>
        </div>`;
      const th = card.querySelector('.thumb');
      th.querySelector('img').src = s.url;
      th.addEventListener('click', () => openZoom(s.url, `第 ${i + 1} 步的图`));
      card.style.position = 'relative';          // 序号按钮压在缩略图左上角
      card.querySelector('.stitle').value = s.title || '';
      const ta = card.querySelector('.stext');
      ta.value = s.text || '';
      autoGrow(ta);
      return card;
    }));
    $('#addhint').textContent = `已有 ${draft.steps.length} 步，还可以继续加`;
    swipe && swipe.forget();     // 列表整块重建了，别再拿着旧节点
  }

  /* ── 手机手势：左滑删除 + 长按拖动排序 ──────────────
     分工按配方的仲裁表：横向出死区归左滑（并取消长按计时），
     原地按住 450ms 归拖拽，纵向谁都不接。 */
  let swipe = null, drag = null;
  const anyDialogOpen = () => !!document.querySelector('dialog[open]');

  function initGestures() {
    if (!matchMedia('(pointer: coarse)').matches) return;   // 电脑上用拖拽把手，不装手势
    if (!window.SGGestures) return;
    const ICO_DEL = '<svg class="lsw-ico" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
      '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    swipe = window.SGGestures.SwipeActions({
      root: () => $('#list'),
      item: '.step',
      blocked: anyDialogOpen,
      onLock: () => drag && drag.cancelHold(),        // 一横滑就别再等长按
      actions: el => [{
        label: '删除', cls: 'lsw-del', icon: ICO_DEL,
        onClick: node => { swipe.close(true); del(+node.dataset.i); }
      }]
    });

    drag = window.SGGestures.LongPressDrag({
      root: () => $('#list'),
      item: '.step',
      handle: '.handle',          // 抓手上按住就能拖；卡片空白处/缩略图上要长按 450ms
      blocked: () => anyDialogOpen() || (swipe && swipe.isOpen()),   // 有条目滑开着时不起拖拽
      onDrop: (from, to) => {
        if (from !== to && from >= 0) {
          const [it] = draft.steps.splice(from, 1);
          draft.steps.splice(to, 0, it);
          save();
        }
        swipe && swipe.forget();
        render();
      }
    });
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(76, ta.scrollHeight) + 'px';
  }

  /* ── 增删改 ───────────────────────────────────────── */
  async function addFiles(files) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    // 手机相册多选的顺序不一定可靠，按文件名排一次（截图名通常带时间）
    imgs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
    for (const f of imgs) {
      const bmp = await createImageBitmap(f).catch(() => null);
      if (!bmp) continue;
      draft.steps.push({
        key: randomId(6),
        blob: f,
        url: URL.createObjectURL(f),
        w: bmp.width, h: bmp.height,
        title: '', text: ''
      });
      bmp.close?.();
    }
    render();
    save();
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.steps.length) return;
    [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]];
    render(); save();
  }

  function moveTo(i, to) {
    if (to === i || to < 0 || to >= draft.steps.length) return;
    const [it] = draft.steps.splice(i, 1);
    draft.steps.splice(to, 0, it);
    render(); save();
  }

  /** 点序号 = 移到第几步（低频操作放在"点序号改序号"这个自然的位置上，
      不占卡片上的按钮位；换图/删除那两个高频的已经提到一级了） */
  function openMoveTo(i) {
    const n = draft.steps.length;
    const dlg = $('#dlg-more');
    $('#m-title').textContent = `第 ${i + 1} 步 · 移到哪儿？`;
    $('#m-chips').innerHTML = Array.from({ length: n }, (_, k) =>
      `<button type="button" class="chip${k === i ? ' now' : ''}" data-to="${k}">${k + 1}</button>`).join('');
    $('#m-chips').onclick = e => {
      const b = e.target.closest('button[data-to]');
      if (!b) return;
      dlg.close();
      moveTo(i, +b.dataset.to);
    };
    $('#m-cancel').onclick = () => dlg.close();
    dlg.showModal();
  }

  /** 删除：配方要求永远二次确认，且不用原生 confirm（自动化里会冻住，样式也不统一） */
  function del(i) {
    const dlg = $('#dlg-del');
    $('#del-title').textContent = `删除第 ${i + 1} 步？`;
    $('#del-no').onclick = () => dlg.close();
    $('#del-yes').onclick = () => {
      dlg.close();
      const [gone] = draft.steps.splice(i, 1);
      if (gone && gone.remote) draft.gone = [...(draft.gone || []), gone.remote];  // 线上那份也要删
      swipe && swipe.forget();
      render(); save();
    };
    dlg.showModal();
  }

  /** 真正换掉第 i 步的图 */
  async function replaceImage(i, f) {
    if (!f || !f.type.startsWith('image/')) return false;
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) { alert('这张图读不出来'); return false; }
    const old = draft.steps[i];
    if (old.remote) draft.gone = [...(draft.gone || []), old.remote];   // 线上那份也要删
    draft.steps[i] = { ...old, blob: f, remote: null, url: URL.createObjectURL(f),
                       w: bmp.width, h: bmp.height };
    bmp.close?.();
    render(); save();
    return true;
  }

  /** 换图弹层：选文件、粘贴剪贴板、长按粘贴框，三条路都给 */
  function swap(i) {
    const dlg = $('#dlg-swap');
    $('#swap-title').textContent = `换掉第 ${i + 1} 步的图`;
    const done = async f => { if (await replaceImage(i, f)) dlg.close(); };

    const pick = $('#swap-pick');
    pick.value = '';
    pick.onchange = () => done(pick.files[0]);

    const box = $('#swap-paste');
    box.textContent = '';
    box.hidden = true;                       // 有「粘贴剪贴板」按钮就够了，平时不占版面

    $('#swap-clip').onclick = async () => {
      const f = await readClipboardImage({ quiet: true });
      if (f) { done(f); return; }
      box.hidden = false;                    // 这条路走不通才亮出兜底的框
      box.focus();
    };

    box.onpaste = e => {
      e.stopPropagation();
      const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); box.textContent = ''; done(f); return; }
      setTimeout(async () => {                       // iOS 那种只塞 <img> 的情况
        const im = box.querySelector('img');
        box.textContent = '';
        if (!im) return;
        try {
          const blob = await fetch(im.src).then(r => r.blob());
          done(new File([blob], 'paste.' + (blob.type.split('/')[1] || 'png'), { type: blob.type }));
        } catch (err) { /* 拿不到就算了 */ }
      }, 120);
    };

    $('#swap-cancel').onclick = () => dlg.close();
    dlg.showModal();
  }

  /** 读剪贴板里的第一张图，读不到就返回 null（两处在用：加图、换图） */
  async function readClipboardImage(opt = {}) {
    const fail = msg => { if (!opt.quiet) alert(msg); return null; };
    if (!navigator.clipboard || !navigator.clipboard.read) {
      return fail('这个浏览器不支持直接读剪贴板，用下面的粘贴框（长按 → 粘贴）。');
    }
    try {
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await it.getType(type);
        return new File([blob], 'paste-' + Date.now() + '.' + type.split('/')[1], { type });
      }
      return fail('剪贴板里没有图片');
    } catch (e) {
      return fail('读剪贴板没成功：' + e.message + '。用下面的粘贴框（长按 → 粘贴）试试。');
    }
  }

  /* ── 点缩略图放大看 ───────────────────────────────── */
  let zoomer = null;
  function openZoom(src, alt) {
    const dlg = $('#zoom');
    if (!dlg.querySelector('.zbar')) {                 // 补出工具栏（跟阅读页同款）
      const bar = document.createElement('div');
      bar.className = 'zbar';
      bar.innerHTML = '<span class="zpct">100%</span>' +
        '<button class="zreset" type="button">还原</button>' +
        '<button class="zclose" type="button">✕ 关闭</button>';
      dlg.appendChild(bar);
      bar.querySelector('.zclose').onclick = () => dlg.close();
      bar.querySelector('.zreset').onclick = () => zoomer && zoomer.reset();
    }
    if (!zoomer) zoomer = window.SGZoom.mount(dlg);
    zoomer.open(src, alt);
  }

  /* ── 草稿 ─────────────────────────────────────────── */
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const dump = {
        id: draft.id, title: draft.title, gone: draft.gone || [],
        steps: draft.steps.map(s => ({
          key: s.key, blob: s.blob || null, remote: s.remote || null,
          w: s.w, h: s.h, title: s.title, text: s.text
        }))
      };
      try { await Store.save(dump); } catch (e) { console.warn('草稿没存上', e); }
    }, 350);
  }

  async function restore() {
    const d = await Store.load().catch(() => null);
    if (!d || !d.steps || !d.steps.length) return false;
    if (!confirm(`发现上次没发完的草稿「${d.title || '未命名'}」，共 ${d.steps.length} 步。继续编辑吗？\n（选取消会清掉它）`)) {
      await Store.clear();
      return false;
    }
    draft = {
      id: d.id, title: d.title, gone: d.gone || [],
      steps: d.steps.map(s => ({
        ...s,
        url: s.blob ? URL.createObjectURL(s.blob)
                    : `${siteRoot()}t/${d.id}/i/${s.remote}`
      }))
    };
    $('#title').value = draft.title || '';
    render();
    markClean();                 // 草稿本来就是存过的，恢复出来不算新改动
    return true;
  }

  /* ── 编辑已发布的教程 ─────────────────────────────── */
  async function loadPublished(id) {
    const base = `${siteRoot()}t/${id}/`;
    const data = await getJson(base + 'data.json');
    draft = {
      id,
      title: data.title || '',
      gone: [],
      known: data.steps.map(s => s.img),
      steps: data.steps.map(s => ({
        key: randomId(6), blob: null, remote: s.img, url: base + 'i/' + s.img,
        w: s.w, h: s.h, title: s.title || '', text: s.text || ''
      }))
    };
    $('#title').value = draft.title;
    render();
    markClean();                 // 刚载入＝没改动，这时点返回应该直接走
  }

  /* ── 发布 ─────────────────────────────────────────── */
  function progress(title, msg, pct) {
    $('#p-title').textContent = title;
    $('#p-msg').textContent = msg;
    $('#p-fill').style.width = (pct == null ? 0 : pct) + '%';
  }

  async function doPublish() {
    if (!draft.title.trim()) { alert('先给教程起个标题'); $('#title').focus(); return; }
    if (!draft.steps.length) { alert('还没有任何步骤'); return; }
    if (!cfg.owner || !cfg.repo || !cfg.token) { alert('先在右上角 ⚙ 里填好仓库和 token'); openSettings(); return; }

    const id = draft.id || randomId(8);
    const dlg = $('#dlg-prog');
    $('#p-row').hidden = true;
    $('#p-row').innerHTML = '';
    dlg.showModal();

    try {
      // 1. 压缩新加的图（线上已有的不动，省流量也省仓库体积）
      const files = [];
      const steps = [];
      let n = 0;
      for (const s of draft.steps) {
        n++;
        if (s.blob) {
          progress('正在压缩图片', `第 ${n} / ${draft.steps.length} 张`, n / draft.steps.length * 30);
          const out = await compress(s.blob);
          const name = `${s.key}.${out.ext}`;
          files.push({ path: `t/${id}/i/${name}`, content: await toBase64(out.blob) });
          steps.push({ img: name, w: out.w, h: out.h, title: s.title || '', text: s.text || '' });
        } else {
          steps.push({ img: s.remote, w: s.w, h: s.h, title: s.title || '', text: s.text || '' });
        }
      }

      // 2. data.json + 壳子
      const data = {
        v: 1, id, title: draft.title.trim(),
        created: new Date().toISOString().slice(0, 10),
        steps
      };
      files.push({ path: `t/${id}/data.json`, content: b64(JSON.stringify(data, null, 1)) });
      files.push({ path: `t/${id}/index.html`, content: b64(SHELL(id)) });

      // 3. 被换掉/删掉的图，线上那份也删掉
      for (const name of (draft.gone || [])) {
        if (draft.known && draft.known.includes(name)) files.push({ path: `t/${id}/i/${name}`, sha: null });
      }

      // 4. 目录索引
      progress('正在整理目录', '读取现有教程列表', 34);
      let list = [];
      try { list = await getJson(siteRoot() + 'list.json'); } catch (e) { list = []; }
      list = list.filter(x => x.id !== id);
      list.unshift({ id, title: data.title, steps: steps.length, updated: new Date().toISOString() });
      files.push({ path: 'list.json', content: b64(JSON.stringify(list, null, 1)) });

      // 5. 一次提交
      await publish({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || 'main',
        files, message: `教程：${data.title}`,
        onProgress: p => {
          const pct = 35 + (p.total ? (p.done / p.total) * 45 : 20);
          progress('正在上传', `${p.phase} ${p.total > 1 ? p.done + '/' + p.total : ''}`, pct);
        }
      });

      // 6. 等 Pages 真的构建好——推上去不等于线上能打开
      const url = `${siteRoot()}t/${id}/`;
      progress('GitHub 正在构建页面', '这一步通常几十秒，别关页面', 85);
      const live = await waitLive(url + 'data.json', {
        onTick: t => progress('GitHub 正在构建页面', `已等 ${t.seconds} 秒…`, Math.min(97, 85 + t.seconds / 3))
      });

      draft.id = id;
      await Store.clear();
      markClean();                 // 已经发出去了，再点返回不该拦人
      progress(live ? '发布成功 🎉' : '已提交，但还没构建好',
               live ? '' : '仓库里已经有了，Pages 还在构建，过一会儿再打开这个链接', 100);
      const row = $('#p-row');
      row.hidden = false;
      row.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.innerHTML = `<button class="tap" id="p-copy" type="button">复制链接</button>
                        <button class="tap go" id="p-close" type="button">完成</button>`;
      row.appendChild(btns);
      $('#p-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(url); $('#p-copy').textContent = '已复制 ✓'; }
        catch (e) { prompt('手动复制这条链接：', url); }
      };
      $('#p-close').onclick = () => dlg.close();

    } catch (err) {
      progress('发布失败', '', 0);
      const row = $('#p-row');
      row.hidden = false;
      row.innerHTML = `<div class="err">${err.message}\n\n草稿还在，没有丢。仓库也不会留下半个教程——` +
        `这套发布是最后一步才生效的。\n如果是网络打不开 api.github.com，挂上代理再点重试。</div>`;
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.innerHTML = `<button class="tap" id="p-close2" type="button">关掉</button>
                        <button class="tap go" id="p-retry" type="button">重试</button>`;
      row.appendChild(btns);
      $('#p-close2').onclick = () => dlg.close();
      $('#p-retry').onclick = () => { dlg.close(); doPublish(); };
    }
  }

  const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)));

  /* ── 阅读页 HTML 的生成（预览和导出共用一套） ───────
     inlineImages=true  把图片转成 base64 塞进文件（导出，离线可看）
     inlineImages=false 直接用现有的 blob:/线上地址（预览，快得多） */
  async function buildReaderHtml(inlineImages) {
    // zoom.css 一定要一起内联：预览/导出是个自包含页面，取不到外部样式表；
    // 少了它放大器会退化成没样式的样子（抽出独立文件时漏了这里，用户截图发现的）
    const [baseCss, readerCss, zoomCss, readerJs, zoomJs] = await Promise.all([
      fetch('../assets/base.css').then(r => r.text()),
      fetch('../assets/reader.css').then(r => r.text()),
      fetch('../assets/zoom.css').then(r => r.text()),
      fetch('../assets/reader.js').then(r => r.text()),
      fetch('../assets/zoom.js').then(r => r.text())
    ]);
    const steps = [];
    for (const st of draft.steps) {
      let src = st.url;
      if (inlineImages) {
        const blob = st.blob ? (await compress(st.blob)).blob : await fetch(st.url).then(r => r.blob());
        src = 'data:' + blob.type + ';base64,' + await toBase64(blob);
      }
      steps.push({ src, w: st.w, h: st.h, title: st.title || '', text: st.text || '' });
    }
    const data = { title: draft.title || '（还没起标题）', steps };
    return `<!DOCTYPE html>
<html lang="zh-CN" data-mode="step">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(data.title)}</title>
<style>${baseCss}
${readerCss}
${zoomCss}</style></head>
<body>
<header class="top"><h1 id="title"></h1>
<button class="modebtn tap" id="modebtn" type="button">☰ 长文</button></header>
<div class="topbar-progress"><div class="bar"><i id="fill"></i></div></div>
<div class="deck" id="deck"></div>
<nav class="bottom"><button class="tap" id="prev" type="button">‹ 上一步</button>
<span class="count" id="count">1 / 1</span>
<button class="tap" id="next" type="button">下一步 ›</button></nav>
<dialog id="zoom"><div class="box"><img id="zoomimg" alt=""></div></dialog>
<script>window.__DATA=${JSON.stringify(data)};<\/script>
<script>${zoomJs}<\/script>
<script>${readerJs}<\/script>
</body></html>`;
  }

  /** 发布前看一眼：同一套阅读器，只是数据来自当前草稿 */
  async function openPreview() {
    if (!draft.steps.length) { alert('还没有内容可以预览'); return; }
    const dlg = $('#dlg-preview');
    dlg.showModal();
    $('#pvframe').srcdoc = await buildReaderHtml(false);
  }

  /* ── 导出备份：一个自带图片的 HTML 文件 ───────────── */
  async function exportOne() {
    if (!draft.steps.length) { alert('还没有内容可以导出'); return; }
    const html = await buildReaderHtml(true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (draft.title || '教程') + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── 把设置搬到手机（二维码） ──────────────────────
     设置存在 localStorage 里，按「设备+浏览器」隔离，本来就传不过去；
     这里走二维码：内容放在 URL 的 # 后面，#之后的部分浏览器不会发给服务器，
     也不会进 Referer。手机读完立刻把它从地址栏抹掉。 */
  const b64url = str => btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = s2 => new TextDecoder().decode(Uint8Array.from(
    atob(s2.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

  function cfgToUrl() {
    const payload = JSON.stringify({ o: cfg.owner, r: cfg.repo, b: cfg.branch, t: cfg.token });
    return `${siteRoot()}w/#cfg=${b64url(payload)}`;
  }

  function showQr() {
    if (!cfg.owner || !cfg.repo || !cfg.token) { alert('先把上面四项填好并保存，再生成二维码'); return; }
    const url = cfgToUrl();
    const qr = qrcode(0, 'L');            // 0 = 自动选版本；L 级纠错，容量最大
    qr.addData(url);
    qr.make();
    $('#qr-img').src = qr.createDataURL(6, 2);
    $('#qr-warn').textContent =
      `⚠️ 这张码里含 token，等于这个仓库的写权限（${qr.getModuleCount()}×${qr.getModuleCount()} 格）。` +
      '别让旁人拍到、也别截图发出去，用完就关掉。';
    $('#dlg-qr').showModal();
  }

  /** 拿到 cfg 载荷后的统一入口：先给人看清楚要导入什么，确认了才写进这台设备 */
  function askImport(raw) {
    let p;
    try { p = JSON.parse(unb64url(raw)); } catch (e) { alert('这个码读不出来（可能扫串了）'); return false; }
    if (!p || !p.t) { alert('这个码里没有 token'); return false; }
    const mask = p.t.length > 16 ? p.t.slice(0, 11) + '…' + p.t.slice(-4) : '（已隐藏）';
    $('#imp-kv').innerHTML =
      `<div><b>GitHub 用户名</b><code>${esc(p.o || '')}</code></div>` +
      `<div><b>仓库</b><code>${esc(p.r || '')}</code></div>` +
      `<div><b>分支</b><code>${esc(p.b || 'main')}</code></div>` +
      `<div><b>Token</b><code>${esc(mask)}</code></div>`;
    $('#btn-imp-yes').onclick = () => {
      cfg.owner = p.o || ''; cfg.repo = p.r || 'Step-Guides';
      cfg.branch = p.b || 'main'; cfg.token = p.t;
      saveCfg();
      $('#dlg-import').close();
      alert('设置已导入这台设备，可以直接发布了');
    };
    $('#btn-imp-no').onclick = () => $('#dlg-import').close();
    $('#dlg-import').showModal();
    return true;
  }

  /** 从一条链接里扒出 cfg 载荷（扫码扫到的、或自己地址栏里的） */
  const cfgFromUrl = u => (/[#?]cfg=([A-Za-z0-9\-_]+)/.exec(u || '') || [])[1] || null;

  /** 用系统相机扫码、从链接进来时走这条 */
  function importFromHash() {
    const raw = cfgFromUrl(location.hash);
    if (!raw) return false;
    // 不管用户点什么，先把地址栏里的 token 抹掉，别留在历史记录里
    history.replaceState(null, '', location.pathname + location.search);
    return askImport(raw);
  }

  /* ── 站内扫码：直接开摄像头，不用另开相机 App ──────
     优先用浏览器自带的 BarcodeDetector（安卓 Chrome 有）；
     没有就按需加载 jsQR（iOS Safari 走这条）——按需是为了不拖慢平时打开页面 */
  let camStream = null, scanTimer = null;

  async function ensureDecoder() {
    if ('BarcodeDetector' in window) {
      try {
        const fmts = await BarcodeDetector.getSupportedFormats();
        if (fmts.includes('qr_code')) {
          const det = new BarcodeDetector({ formats: ['qr_code'] });
          return async cv => {
            const r = await det.detect(cv);
            return r.length ? r[0].rawValue : null;
          };
        }
      } catch (e) { /* 掉到 jsQR */ }
    }
    if (!window.jsQR) {
      await new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = '../assets/vendor/jsqr.js';
        sc.onload = res;
        sc.onerror = () => rej(new Error('解码器加载失败'));
        document.head.appendChild(sc);
      });
    }
    return async cv => {
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const px = ctx.getImageData(0, 0, cv.width, cv.height);
      const got = window.jsQR(px.data, px.width, px.height, { inversionAttempts: 'dontInvert' });
      return got ? got.data : null;
    };
  }

  function stopScan() {
    clearInterval(scanTimer); scanTimer = null;
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    const v = $('#cam');
    if (v) v.srcObject = null;
  }

  async function startScan() {
    const dlg = $('#dlg-scan');
    $('#scan-msg').textContent = '正在打开摄像头…';
    if (!dlg.open) dlg.showModal();
    let decode;
    try {
      decode = await ensureDecoder();
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
    } catch (e) {
      $('#scan-msg').textContent = '打不开摄像头：' + e.message +
        '。多半是没给相机权限，或者你在微信内置浏览器里——用 Safari / Chrome 打开试试。';
      return;
    }
    const v = $('#cam');
    v.srcObject = camStream;
    await v.play().catch(() => {});
    $('#scan-msg').textContent = '把电脑上那个码放进框里';

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    scanTimer = setInterval(async () => {
      if (!v.videoWidth) return;
      // 缩到 480 宽再解：全分辨率逐帧解在手机上会烫手，480 够解 53×53 的码
      const k = Math.min(1, 480 / v.videoWidth);
      cv.width = Math.round(v.videoWidth * k);
      cv.height = Math.round(v.videoHeight * k);
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
      let text = null;
      try { text = await decode(cv); } catch (e) { /* 这一帧没解出来，继续 */ }
      if (!text) return;
      const raw = cfgFromUrl(text);
      if (!raw) { $('#scan-msg').textContent = '扫到的不是这个网站的设置码，换一个试试'; return; }
      stopScan();
      dlg.close();
      askImport(raw);
    }, 220);
  }

  /* ── 手机上怎么粘贴图片 ──────────────────────────
     手机没有 Ctrl+V，只有两条路：
     ① navigator.clipboard.read()（iOS Safari 会弹一个「粘贴」确认，安卓 Chrome 要权限）
     ② 一个可长按的框：长按 → 系统菜单「粘贴」→ 触发 paste 事件 */
  async function pasteFromClipboard() {
    const f = await readClipboardImage({ quiet: true });
    if (f) { await addFiles([f]); return; }
    // 这条路走不通（浏览器不支持 / 用户拒绝 / 剪贴板里不是图），才亮出兜底的粘贴框
    const box = $('#pastebox');
    box.hidden = false;
    box.focus();
    $('#addhint').textContent = '读不到剪贴板 —— 在下面的框里长按，选「粘贴」';
  }

  /** 粘贴框：既接 paste 事件里的文件，也兜住「图片被直接塞进框里」的情况（iOS 有时这样） */
  function wirePasteBox() {
    const box = $('#pastebox');
    if (!box) return;
    box.addEventListener('paste', async e => {
      // 全局那个 Ctrl+V 监听也会收到这个事件（冒泡），不拦的话同一张图会被加两次
      e.stopPropagation();
      const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        box.textContent = '';
        await addFiles(files);
        return;
      }
      // 事件里没有文件：让浏览器先粘进来，下一帧把塞进来的 <img> 捞出来转成文件
      setTimeout(async () => {
        const imgs = [...box.querySelectorAll('img')];
        if (!imgs.length) { box.textContent = ''; return; }
        const got = [];
        for (const im of imgs) {
          try {
            const blob = await fetch(im.src).then(r => r.blob());
            if (blob.type.startsWith('image/')) {
              got.push(new File([blob], 'paste-' + Date.now() + '.' + blob.type.split('/')[1], { type: blob.type }));
            }
          } catch (err) { /* 这张拿不到就跳过 */ }
        }
        box.textContent = '';
        if (got.length) await addFiles(got);
      }, 120);
    });
    // 别让它变成一个能打字的框：粘图片以外的输入一律清掉
    box.addEventListener('input', () => {
      if (box.querySelector('img')) return;
      if (box.textContent.trim()) box.textContent = '';
    });
  }

  /* ── 保存 / 丢弃 / 返回 ──────────────────────────────
     草稿本来就是随敲随存的，但"看不见的自动保存"让人不放心，
     所以给一个明确的保存键 + 一句看得见的回执。 */
  async function saveNow() {
    clearTimeout(saveTimer);
    await Store.save({
      id: draft.id, title: draft.title, gone: draft.gone || [],
      steps: draft.steps.map(st => ({ key: st.key, blob: st.blob || null, remote: st.remote || null,
                                      w: st.w, h: st.h, title: st.title, text: st.text }))
    });
    markClean();
    const tag = $('#savetag');
    tag.hidden = false;
    tag.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    clearTimeout(tag._t);
    tag._t = setTimeout(() => { tag.hidden = true; }, 4000);
  }

  async function discardDraft() {
    if (!confirm('丢弃这份草稿？图片和文字都会清掉，已经发布过的教程不受影响。')) return;
    await Store.clear();
    draft = { id: null, title: '', steps: [], gone: [] };
    $('#title').value = '';
    render();
    $('#dlg-settings').close();
  }

  /* 有没有未保存的改动：没改过就别拦人，"只想点进来看看"是常态 */
  let clean = '';
  const snapshot = () => JSON.stringify({
    t: draft.title,
    s: draft.steps.map(x => [x.key, x.remote || '', x.title, x.text])
  });
  const markClean = () => { clean = snapshot(); };
  const isDirty = () => snapshot() !== clean;

  /** 离开：三个明确的出口，不用原生 confirm（它只有两个键，说不清） */
  /** url 传 null ＝ 回到来的那一页（同源才算），否则去指定地址 */
  function go(url) {
    if (url) { location.href = url; return; }
    const ref = document.referrer;
    const sameSite = ref && new URL(ref).origin === location.origin
                         && new URL(ref).pathname !== location.pathname;
    if (sameSite && history.length > 1) history.back();
    else location.href = '../';
  }

  function leaveTo(url) {
    if (!isDirty()) { go(url); return; }                  // 没动过，直接走
    const dlg = $('#dlg-leave');
    const editing = !!draft.id;
    $('#lv-title').textContent = editing ? '放弃这次修改？' : '离开？';
    $('#lv-desc').textContent = editing
      ? '这份教程已经发布过了。这里的修改还没发布，离开就没了 —— 除非先存成草稿。'
      : '这份草稿还没发布。';
    $('#lv-save').textContent = editing ? '存成草稿，下次接着改' : '保存草稿，下次接着写';
    $('#lv-drop').textContent = editing ? '放弃修改，直接离开' : '不保存，直接离开';
    $('#lv-save').onclick = async () => { await saveNow(); go(url); };
    $('#lv-drop').onclick = async () => { await Store.clear(); go(url); };
    $('#lv-stay').onclick = () => dlg.close();
    dlg.showModal();
  }

  /* ── 设置 ─────────────────────────────────────────── */
  function openSettings() {
    $('#f-owner').value = cfg.owner || '';
    $('#f-repo').value = cfg.repo || 'Step-Guides';
    $('#f-branch').value = cfg.branch || 'main';
    $('#f-token').value = cfg.token || '';
    $('#dlg-settings').showModal();
  }

  /* ── 事件 ─────────────────────────────────────────── */
  function boot() {
    loadCfg();

    $('#title').addEventListener('input', e => { draft.title = e.target.value; save(); });

    $('#pick').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    $('#btn-pick').onclick = () => $('#pick').click();

    // 出码是在电脑上点的、扫码是在手机上点的，各自只显示该显示的那个
    const touch = matchMedia('(pointer: coarse)').matches;
    $('#btn-qr').hidden = touch;
    $('#btn-scan').hidden = !touch;

    // 粘贴（电脑上 PixPin 截完直接 Ctrl+V）
    addEventListener('paste', e => {
      const items = [...(e.clipboardData?.files || [])];
      if (items.length) { e.preventDefault(); addFiles(items); }
    });

    // 拖进来
    const zone = $('#addzone');
    ['dragenter', 'dragover'].forEach(t => addEventListener(t, e => {
      e.preventDefault(); zone.classList.add('hot');
    }));
    ['dragleave', 'drop'].forEach(t => addEventListener(t, e => {
      if (t === 'drop') { e.preventDefault(); addFiles(e.dataTransfer.files); }
      zone.classList.remove('hot');
    }));

    // 步骤卡上的操作（事件委托）
    $('#list').addEventListener('click', e => {
      const btn = e.target.closest('button[data-op]');
      if (!btn) return;
      const i = +btn.closest('.step').dataset.i;
      ({ up: () => move(i, -1), down: () => move(i, 1), to: () => openMoveTo(i),
         swap: () => swap(i), del: () => del(i) })[btn.dataset.op]();
    });
    $('#list').addEventListener('input', e => {
      const card = e.target.closest('.step');
      if (!card) return;
      const i = +card.dataset.i;
      if (e.target.classList.contains('stitle')) draft.steps[i].title = e.target.value;
      if (e.target.classList.contains('stext')) { draft.steps[i].text = e.target.value; autoGrow(e.target); }
      save();
    });

    // 电脑端拖拽排序
    let dragI = null;
    $('#list').addEventListener('dragstart', e => {
      const card = e.target.closest('.step');
      if (!card) return;
      dragI = +card.dataset.i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragI));
    });
    $('#list').addEventListener('dragover', e => {
      const card = e.target.closest('.step');
      if (!card || dragI === null) return;
      e.preventDefault();
      card.classList.add('drag-over');
    });
    $('#list').addEventListener('dragleave', e => {
      e.target.closest('.step')?.classList.remove('drag-over');
    });
    $('#list').addEventListener('drop', e => {
      const card = e.target.closest('.step');
      if (!card || dragI === null) return;
      e.preventDefault();
      const to = +card.dataset.i;
      const [it] = draft.steps.splice(dragI, 1);
      draft.steps.splice(to, 0, it);
      dragI = null;
      render(); save();
    });
    $('#list').addEventListener('dragend', () => {
      dragI = null;
      document.querySelectorAll('.step').forEach(c => c.classList.remove('dragging', 'drag-over'));
    });

    $('#btn-settings').onclick = openSettings;
    $('#btn-cancel-set').onclick = () => $('#dlg-settings').close();
    $('#btn-save-set').onclick = () => {
      cfg.owner = $('#f-owner').value.trim();
      cfg.repo = $('#f-repo').value.trim() || 'Step-Guides';
      cfg.branch = $('#f-branch').value.trim() || 'main';
      cfg.token = $('#f-token').value.trim();
      saveCfg();
      $('#dlg-settings').close();
    };
    $('#btn-forget').onclick = () => {
      cfg.token = '';
      saveCfg();
      $('#f-token').value = '';
      alert('token 已从这台设备清除');
    };
    $('#btn-qr').onclick = showQr;
    $('#btn-scan').onclick = () => { $('#dlg-settings').close(); startScan(); };
    $('#btn-scan-close').onclick = () => { stopScan(); $('#dlg-scan').close(); };
    $('#dlg-scan').addEventListener('close', stopScan);   // 安卓返回键关弹层也要断摄像头
    $('#btn-clip').onclick = pasteFromClipboard;
    wirePasteBox();
    $('#btn-qr-close').onclick = () => { $('#qr-img').src = ''; $('#dlg-qr').close(); };
    $('#btn-publish').onclick = doPublish;
    $('#btn-preview').onclick = openPreview;
    $('#pv-close').onclick = () => { $('#pvframe').srcdoc = ''; $('#dlg-preview').close(); };
    $('#btn-save').onclick = saveNow;
    // 返回＝回到你来的那个页面，不再一律跳教程库。
    // 同源的上一页才走 history.back()，否则（直接打开链接、从外站进来）回首页
    $('#btn-back').onclick = () => leaveTo(null);
    $('#btn-home2').onclick = () => leaveTo('../');
    $('#btn-export').onclick = exportOne;
    $('#btn-discard').onclick = discardDraft;
    $('#btn-mine').onclick = () => { $('#dlg-settings').close(); leaveTo('../mine/'); };
    $('#btn-home').onclick = () => { $('#dlg-settings').close(); leaveTo('../'); };

    initGestures();

    // 扫码进来的先处理导入（它只改设置，不碰草稿）
    importFromHash();

    // 启动：?edit=<id> 优先，其次问要不要接着上次的草稿
    const editId = new URLSearchParams(location.search).get('edit');
    if (editId) {
      loadPublished(editId).catch(err => alert('这份教程读不出来：' + err.message));
    } else {
      restore().then(has => { if (!has) { render(); markClean(); } });
    }
  }

  // 给验证脚本用的测试口（也方便自己在控制台里手动检查状态）
  window.SGWriter = { addFiles, render, b64url, unb64url, cfgToUrl, cfgFromUrl, askImport,
                      startScan, stopScan, ensureDecoder, openPreview, openZoom, swap,
                      replaceImage, saveNow, buildReaderHtml, del, move, moveTo,
                      get swipe() { return swipe; }, get drag() { return drag; },
                      get draft() { return draft; } };

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
})();
