/* 写作页：选图 → 敲字 → 发布。电脑和手机都能从头写。
   草稿（含图片 Blob）存 IndexedDB，发布失败也不会丢。
   2026-10-09 起草稿按「哪一份」分开存（见 store.js 开头），这个页面同一时间只管一份：变量 slot。 */
(() => {
  'use strict';

  const { compress, toBase64 } = window.SGImg;
  const { randomId, isId, b64, publish, waitLive, getJson, explain } = window.SGGitHub;
  const Store = window.SGStore;
  const UI = window.SGUI;

  const $ = s => document.querySelector(s);
  const CFG_KEY = 'sg.cfg';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 每个教程页的壳子：逻辑都在公共 reader.js 里，这里只有引用。
     标题和第一张图写进去（建议 O-2）：iMessage、Telegram 这类发链接时会读它们，
     显示教程名和缩略图，而不是一个光秃秃的「教程」 */
  const SHELL = (title, image) => `<!DOCTYPE html>
<html lang="zh-CN" data-mode="step">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111114" media="(prefers-color-scheme: dark)">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:type" content="article">
${image ? `<meta property="og:image" content="${esc(image)}">\n` : ''}<link rel="stylesheet" href="../../assets/base.css">
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
  let draft = { id: null, title: '', steps: [], gone: [], known: [] };  // known = 线上已有的图片文件名
  let cfg = { owner: '', repo: 'Step-Guides', branch: 'main', token: '' };
  let slot = null;          // 这份草稿存在哪：new:<码> / edit:<编号>
  let ready = false;        // 草稿或线上内容读完了没有。读完之前不自动保存、不拦离开（审查 P3-5）
  let loadFailed = false;   // 编辑页没读到线上内容：这时页面是空的，绝不能存（会把空白存成草稿，审查 P0-1）
  let busy = false;         // 正在发布

  const loadCfg = () => {
    try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch (e) { /* 忽略 */ }
  };
  const saveCfg = () => {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return true; }
    catch (e) { UI.notify('这台设备不让存设置（可能是隐私浏览模式）。换成普通模式再试。'); return false; }
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
          <textarea class="stext" rows="3" placeholder="跟对方说清楚这一步要点哪里、注意什么"></textarea>
        </div>
        <div class="ops">
          <div class="handle" title="按住拖动排序" draggable="true">⠿</div>
          <button class="grow" type="button" data-op="to">⇅ 移到…</button>
          <button class="grow" type="button" data-op="swap">🖼 换图</button>
          <button class="grow danger" type="button" data-op="del">🗑 删除</button>
        </div>`;
      const th = card.querySelector('.thumb');
      th.querySelector('img').src = s.url;
      th.addEventListener('click', () => openZoom(s.url, `第 ${i + 1} 步的图`));
      card.style.position = 'relative';          // 序号按钮压在缩略图左上角
      card.querySelector('.stitle').value = s.title || '';
      card.querySelector('.stext').value = s.text || '';
      return card;
    }));
    // 量高度必须等卡片放进页面之后：没放进去时量出来是 0，说明框会被压回最小高度、
    // 多出来的字被 overflow:hidden 直接截掉看不见（审查 P2-13）
    list.querySelectorAll('.stext').forEach(autoGrow);
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
    if (loadFailed) return;                       // 编辑页没读到内容时页面是锁着的
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    // 手机相册多选的顺序不一定可靠，按文件名排一次（截图名通常带时间）。
    // 认数字：「截图2」排在「截图10」前面（建议 O-7）
    imgs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh', { numeric: true }));
    const bad = [];
    for (const f of imgs) {
      const bmp = await createImageBitmap(f).catch(() => null);
      if (!bmp) { bad.push(f.name || '（没有名字的图）'); continue; }
      draft.steps.push({
        key: randomId(6),
        blob: f, saved: false, name: f.name || '',
        url: URL.createObjectURL(f),
        w: bmp.width, h: bmp.height,
        title: '', text: ''
      });
      bmp.close?.();
    }
    render();
    save();
    // 读不出来的图要说出来，不能悄悄少几张（审查 P3-2）
    if (bad.length) {
      const msg = `这 ${bad.length} 张没加进来：${bad.join('、')}\n\n浏览器读不出它们。最常见的是电脑上的 HEIC 格式（iPhone 原图）：先转成 JPG/PNG，或者在手机上直接选图。`;
      $('#addhint').textContent = `有 ${bad.length} 张没加进来：${bad.join('、')}`;
      UI.notify(msg, '有图没加进来');
    }
  }

  function moveTo(i, to) {
    if (to === i || to < 0 || to >= draft.steps.length) return;
    const [it] = draft.steps.splice(i, 1);
    draft.steps.splice(to, 0, it);
    render(); save();
  }

  /** 把第 i 步移到第几步。相邻交换用拖动就行，这个解决的是"第 2 步挪到第 29 步"那种长距离移动 */
  function openMoveTo(i) {
    const n = draft.steps.length;
    const dlg = $('#dlg-more');
    $('#m-title').textContent = `把第 ${i + 1} 步移到第几步？`;
    $('#m-desc').textContent = `一共 ${n} 步，点一个数字就挪过去（当前位置是 ${i + 1}）`;
    $('#m-chips').innerHTML = Array.from({ length: n }, (_, k) =>
      `<button type="button" class="chip${k === i ? ' now' : ''}" data-to="${k}">${k + 1}</button>`).join('');
    $('#m-chips').onclick = e => {
      const b = e.target.closest('button[data-to]');
      if (!b) return;
      dlg.close();
      moveTo(i, +b.dataset.to);
    };
    $('#m-first').disabled = i === 0;
    $('#m-last').disabled = i === n - 1;
    $('#m-first').onclick = () => { dlg.close(); moveTo(i, 0); };
    $('#m-last').onclick = () => { dlg.close(); moveTo(i, n - 1); };
    $('#m-cancel').onclick = () => dlg.close();
    dlg.showModal();
    // 步骤多的时候，把当前那个数字滚进视野
    requestAnimationFrame(() => {
      const now = $('#m-chips .chip.now');
      if (now) now.scrollIntoView({ block: 'center' });
    });
  }

  /** 删除：配方要求永远二次确认，且不用原生弹框（自动化里会冻住，样式也不统一） */
  function del(i) {
    const dlg = $('#dlg-del');
    $('#del-title').textContent = `删除第 ${i + 1} 步？`;
    $('#del-no').onclick = () => dlg.close();
    $('#del-yes').onclick = () => {
      dlg.close();
      const [gone] = draft.steps.splice(i, 1);
      if (gone && gone.remote) draft.gone = [...(draft.gone || []), gone.remote];  // 线上那份也要删
      if (gone && gone.saved) dropKeys.push(gone.key);                             // 本地存的那张图下次保存时删掉
      swipe && swipe.forget();
      render(); save();
    };
    dlg.showModal();
  }

  /** 真正换掉第 i 步的图 */
  async function replaceImage(i, f) {
    if (!f || !f.type.startsWith('image/')) return false;
    const bmp = await createImageBitmap(f).catch(() => null);
    if (!bmp) { UI.notify(`这张图读不出来：${f.name || ''}\n电脑上的 HEIC 格式要先转成 JPG/PNG。`); return false; }
    const old = draft.steps[i];
    if (old.remote) draft.gone = [...(draft.gone || []), old.remote];   // 线上那份也要删
    draft.steps[i] = { ...old, blob: f, saved: false, name: f.name || '', remote: null, url: URL.createObjectURL(f),
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
    box.textContent = '';                    // 粘贴框一直在（2026-10-10：以前要先点按钮、失败了才露出来）

    $('#swap-clip').onclick = async () => {
      const f = await readClipboardImage({ quiet: true });
      if (f) { done(f); return; }
      box.focus();                           // 读不到剪贴板：把光标放进粘贴框，接着长按/右键粘贴就行
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
    const fail = msg => { if (!opt.quiet) UI.notify(msg); return null; };
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
      bar.innerHTML = window.SGZoomBar;                // 跟阅读页同一份（zoom.js 里定义）
      dlg.appendChild(bar);
      bar.querySelector('.zclose').onclick = () => dlg.close();
    }
    if (!zoomer) zoomer = window.SGZoom.mount(dlg);
    zoomer.open(src, alt);
  }

  /* ── 草稿 ─────────────────────────────────────────── */
  let saveTimer = null;
  let lastSaveOk = true;
  let dropKeys = [];        // 删掉的步骤里本地存过图的 key：下次保存时从库里删（只删这些，见 store.js save）
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flush(); }, 350);
  }
  /** 真正写进本地库。返回是否成功。读完之前、编辑页没读到内容时都不写 */
  async function flush() {
    clearTimeout(saveTimer);
    if (loadFailed) return false;                 // 编辑页没读到线上内容：页面已锁住，什么都不存（见 lockFailed）
    if (!ready || !slot) return true;
    // 新草稿里一张图都没有：不占一个草稿位置。只有标题的也不留——草稿箱和「接着写」只列有图的，
    // 留着就成了看不见、删不掉的记录（code-review）
    if (!draft.steps.length && slot.startsWith('new:') && !draft.id) {
      try { await Store.clear(slot); } catch (e) { /* 本来就没有 */ }
      return true;
    }
    const fresh = draft.steps.filter(s => s.blob && !s.saved);
    const drop = dropKeys.slice();
    try {
      await Store.save(slot, draft, fresh.map(s => ({ key: s.key, blob: s.blob })), drop);
      fresh.forEach(s => { s.saved = true; });
      dropKeys = dropKeys.filter(k => !drop.includes(k));
      if (!lastSaveOk) { lastSaveOk = true; const tag = $('#savetag'); tag.classList.remove('bad'); tag.hidden = true; }
      return true;
    } catch (e) {
      // 存不进去要让人看见（审查 P3-9：以前只在控制台里打一行，人以为存好了）
      const first = lastSaveOk;
      lastSaveOk = false;
      const tag = $('#savetag');
      tag.hidden = false;
      tag.classList.add('bad');
      tag.textContent = '⚠️ 草稿没存上';
      clearTimeout(tag._t);
      if (first) UI.notify('这台设备存不进草稿了（' + (e && (e.name || e.message)) + '）。多半是手机存储快满了，或者在无痕模式里。\n' +
                           '现在写的内容关掉页面就没了：先腾点空间，或者点「发布」/「导出备份」把它保住。', '草稿没存上');
      return false;
    }
  }

  /** 把一份存好的草稿放回页面 */
  function apply(d) {
    // 记着「有本地图」却取不回来的步骤（同一份草稿在两个标签页里同时改时可能发生）：去掉并说一声，
    // 不然地址会变成 t/null/i/null，发布时也会出错（code-review）
    const lost = d.steps.filter(s => !s.blob && !s.remote);
    if (lost.length) UI.notify(`这份草稿里有 ${lost.length} 步的图没存住（可能同时在两个页面里改过），这几步已去掉，需要的话重新加图。`, '有图丢了');
    draft = {
      id: d.id || null, title: d.title || '', gone: d.gone || [], known: d.known || [],
      steps: d.steps.filter(s => s.blob || s.remote).map(s => ({
        ...s,
        saved: !!s.blob,
        url: s.blob ? URL.createObjectURL(s.blob) : `${siteRoot()}t/${d.id}/i/${s.remote}`
      }))
    };
    $('#title').value = draft.title;
    render();
  }

  const fmtTime = t => t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  /** 进写作页时要不要接着上次的：站内弹框（审查 P2-12：以前原生弹框里点「取消」= 永久删掉）。
      返回 'go' | 'new'。按 Esc / 返回键关掉时返回 dismiss——调用方要给「不删东西」的那个
      （新草稿：新建一份，旧的留在草稿箱；改已发布教程：接着改。code-review：以前一律算 'new'，改已发布教程时等于删掉修改） */
  function askResume({ title, desc, go, other, danger, dismiss = 'new' }) {
    return new Promise(res => {
      const dlg = $('#dlg-resume');
      let pick = dismiss;
      $('#rs-title').textContent = title;
      $('#rs-desc').textContent = desc;
      $('#rs-go').textContent = go;
      $('#rs-new').textContent = other;
      $('#rs-new').classList.toggle('danger', !!danger);
      $('#rs-go').onclick = () => { pick = 'go'; dlg.close(); };
      $('#rs-new').onclick = () => { pick = 'new'; dlg.close(); };
      dlg.addEventListener('close', () => res(pick), { once: true });
      dlg.showModal();
    });
  }

  /** 新建一份：给它一个草稿位置，地址里记下来（刷新、被系统重载后能接着写） */
  function startFresh(key) {
    key = key || randomId(8);
    slot = 'new:' + key;
    history.replaceState(null, '', location.pathname + '?draft=' + key + location.hash);
    draft = { id: null, title: '', steps: [], gone: [], known: [] };
    $('#title').value = '';
    render();
  }

  /** /w/ 直接进来：有没发完的新草稿就问一句接着写，没有就新建 */
  async function openNewEntry() {
    let drafts = [];
    try { drafts = (await Store.list()).filter(d => d.slot.startsWith('new:') && d.steps && d.steps.length); } catch (e) { /* 读不了就当没有 */ }
    if (drafts.length) {
      const d = drafts[0];
      const pick = await askResume({
        title: '接着写上次那份？',
        desc: `「${d.title || '未命名'}」，${d.steps.length} 步，保存于 ${fmtTime(d.savedAt)}。` +
              (drafts.length > 1 ? `另外还有 ${drafts.length - 1} 份草稿，` : '') +
              '新建的话，它会留在「我的教程」的草稿里，随时能接着写。',
        go: '接着写', other: '新建一份'
      });
      if (pick === 'go') { await openDraft(d.slot); return; }
    }
    startFresh();
  }

  async function openDraft(s) {
    slot = s;
    const d = await Store.load(s).catch(() => null);
    if (d && d.steps) apply(d);
    else startFresh(s.slice(4));
  }

  /** 编辑页没读到线上内容：把页面锁住，别让人在空页面上写了半天、以为存了（code-review） */
  function lockFailed() {
    $('#list').innerHTML = '<div class="empty">这份教程没读出来，这一页现在不能编辑。<br>返回「我的教程」，或者刷新再试。</div>';
    $('#addzone').hidden = true;
    ['#btn-publish', '#btn-save', '#btn-preview', '#title'].forEach(s => { $(s).disabled = true; });
  }

  /* ── 编辑已发布的教程 ─────────────────────────────── */
  async function openEdit(id) {
    slot = 'edit:' + id;
    const d = await Store.load(slot).catch(() => null);
    if (d && d.steps) {
      const pick = await askResume({
        title: '接着上次没发布的修改？',
        desc: `你上次改了「${d.title || '未命名'}」还没发布（保存于 ${fmtTime(d.savedAt)}）。`,
        go: '接着改', other: '放弃那些修改，用线上版本', danger: true, dismiss: 'go'
      });
      if (pick === 'go') { apply(d); return; }
      // 先读到线上版本，再删本地修改：读不到的话两边都没了（code-review）
      await loadPublished(id);
      await Store.clear(slot).catch(() => {});
      return;
    }
    await loadPublished(id);
  }

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
  }

  /* ── 发布 ─────────────────────────────────────────── */
  function progress(title, msg, pct) {
    $('#p-title').textContent = title;
    $('#p-msg').textContent = msg;
    $('#p-fill').style.width = (pct == null ? 0 : pct) + '%';
  }
  const btn = (id, label, cls) => {
    const b = document.createElement('button');
    b.className = 'tap' + (cls ? ' ' + cls : '');
    b.id = id; b.type = 'button'; b.textContent = label;
    return b;
  };

  let abortCtl = null;
  async function doPublish() {
    if (busy) return;
    if (!draft.title.trim()) { await UI.notify('先给教程起个标题'); $('#title').focus(); return; }
    if (!draft.steps.length) { UI.notify('还没有任何步骤'); return; }
    if (!cfg.owner || !cfg.repo || !cfg.token) { await UI.notify('先在右上角 ⚙ 里填好仓库和 token'); openSettings(); return; }

    // 编号在上传之前就定下来并存进草稿（审查 P2-1）：提交生效了但回应丢了、或等构建时关了页面，
    // 下次再发还是同一个编号，不会变成第二份教程
    if (!draft.id) draft.id = randomId(8);
    const id = draft.id;
    await flush();

    const dlg = $('#dlg-prog');
    const row = $('#p-row');
    row.hidden = true;
    row.replaceChildren();
    busy = true;
    abortCtl = new AbortController();
    $('#p-cancel').hidden = false;
    progress('正在发布…', '准备中', 0);
    dlg.showModal();

    let committed = false;
    let patching = false;          // 已经发出「移动分支」那一步：这之后中断，提交可能已经生效了
    try {
      // 1. 压缩新加的图（线上已有的不动，省流量也省仓库体积）
      const files = [];
      const steps = [];
      let n = 0;
      for (const s of draft.steps) {
        n++;
        if (abortCtl.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
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

      // 2. data.json + 壳子。rev 是这一次发布的记号，等上线时认它（审查 P2-2）
      const rev = Date.now().toString(36) + randomId(4);
      const data = {
        v: 1, id, rev, title: draft.title.trim(),
        created: new Date().toISOString().slice(0, 10),
        steps
      };
      const cover = steps[0] ? `${siteRoot()}t/${id}/i/${steps[0].img}` : '';
      files.push({ path: `t/${id}/data.json`, content: b64(JSON.stringify(data, null, 1)) });
      files.push({ path: `t/${id}/index.html`, content: b64(SHELL(data.title, cover)) });

      // 3. 被换掉/删掉的图，线上那份也删掉（仓库里没有的路径 publish 会自己跳过）
      for (const name of (draft.gone || [])) files.push({ path: `t/${id}/i/${name}`, sha: null });

      // 4. 一次提交。目录（list.json）在提交那一轮里从仓库当前版本读、改、写（审查 P1-2）
      progress('正在上传', '', 34);
      await publish({
        token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || 'main',
        files, message: `教程：${data.title}`, signal: abortCtl.signal,
        index: list => [{ id, title: data.title, steps: steps.length, updated: new Date().toISOString() },
                        ...list.filter(x => x && x.id !== id)],
        onProgress: p => {
          if (p.phase === '提交') patching = true;
          const pct = 35 + (p.total ? (p.done / p.total) * 45 : 20);
          progress('正在上传', `${p.phase} ${p.total > 1 ? p.done + '/' + p.total : ''}`, pct);
        }
      });
      committed = true;

      // 5. 等线上真的是这一次的内容——推上去不等于线上能打开
      const url = `${siteRoot()}t/${id}/`;
      progress('正在构建页面', '这一步通常几十秒，可以点「取消」不等了（已经发出去了）', 85);
      const live = await waitLive(url + 'data.json', {
        signal: abortCtl.signal,
        check: j => !!j && j.rev === rev,
        onTick: t => progress('正在构建页面', `已等 ${t.seconds} 秒…`, Math.min(97, 85 + t.seconds / 3))
      });

      // 只清这一份自己的草稿（审查 P0-1：以前清的是唯一那个位置，会连带清掉别的草稿）
      await Store.clear(slot).catch(() => {});
      markClean();                 // 已经发出去了，再点返回不该拦人
      busy = false;
      $('#p-cancel').hidden = true;
      progress(live ? '发布成功 🎉' : '已提交，但还没构建好',
               live ? '' : '仓库里已经有了，网站还在构建，过一会儿再打开这个链接', 100);
      row.hidden = false;
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = url;
      /* 发完就离开编辑器（照"发送后回到列表/内容本身"的通行做法）：
         主按钮去看刚发的教程；「我的教程」或随便怎么关掉弹窗，都回教程库并高亮这一份。
         都用 replace：浏览器返回时不会再退回这个过期的写作页 */
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.append(btn('p-copy', '复制链接'));
      if (navigator.share) btns.append(btn('p-share', '分享…'));
      const btns2 = document.createElement('div');
      btns2.className = 'row';
      btns2.append(btn('p-mine', '📚 我的教程'), btn('p-open', '查看教程 ›', 'go'));
      row.append(a, btns, btns2);
      $('#p-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(url); $('#p-copy').textContent = '已复制 ✓'; }
        catch (e) { UI.copyText(url); }
      };
      // iPhone 上会弹出系统分享面板，可以直接发到微信
      if (navigator.share) $('#p-share').onclick = () =>
        navigator.share({ title: data.title, url }).catch(() => { /* 用户取消分享不算错 */ });
      let going = false;
      const go = to => { going = true; location.replace(to); };
      $('#p-open').onclick = () => go(url);
      $('#p-mine').onclick = () => go(`../mine/?new=${encodeURIComponent(id)}`);
      // Esc / 返回键关掉弹窗也一样去教程库，不把人留在过期的写作页
      dlg.addEventListener('close', () => { if (!going) go(`../mine/?new=${encodeURIComponent(id)}`); }, { once: true });

    } catch (err) {
      busy = false;
      $('#p-cancel').hidden = true;
      // 提交可能已经生效了的两种情况，不能说「仓库不会留下半个教程」（code-review）：
      // ① 已经提交成功、后面的步骤出了错；② 「移动分支」那个请求发出去了、回应没等到（取消/超时/断网）
      const unsure = committed || (patching && !err.status);
      const cancelled = err.name === 'AbortError' && !err.timeout;
      progress(unsure ? '不确定有没有发出去' : cancelled ? '已取消' : '发布失败', '', 0);
      row.hidden = false;
      const box = document.createElement('div');
      box.className = 'err';
      // 草稿还在不在要照实说：本地库存不进去时不能说「没有丢」（审查 P3-9）
      const kept = !lastSaveOk
        ? '⚠️ 这台设备存不进草稿：别关页面，先点「设置 → 导出备份」把内容保住。'
        : unsure
          ? '最后一步已经发给 GitHub 了，可能已经发出去：去「我的教程」看一眼有没有它。\n草稿还在；再点重试会更新同一份教程（编号不变），不会多出一份。'
          : '草稿还在这台设备上，没有丢。仓库也不会留下半个教程——这套发布是最后一步才生效的。';
      box.textContent = (cancelled ? '已取消。' : explain(err)) + '\n\n' + kept;
      const btns = document.createElement('div');
      btns.className = 'row';
      btns.append(btn('p-close2', '关掉'), btn('p-retry', '重试', 'go'));
      row.append(box, btns);
      $('#p-close2').onclick = () => dlg.close();
      $('#p-retry').onclick = () => { dlg.close(); doPublish(); };
      if (err.status === 401 || err.status === 403 || err.status === 404) {
        btns.prepend(btn('p-set', '去改设置'));
        $('#p-set').onclick = () => { dlg.close(); openSettings(); };
      }
    }
  }

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
    // 数据要塞进 <script> 里：说明里要是写了「</script>」或「<!--」，会把脚本提前截断、整页空白（审查 P3-1）。
    // 把所有小于号换成 JS 的 Unicode 转义（反斜杠 + u003c），JSON 读出来还是原样的小于号
    const dataJs = JSON.stringify(data).replace(/</g, String.fromCharCode(92) + 'u003c');
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
<script>window.__DATA=${dataJs};<\/script>
<script>${zoomJs}<\/script>
<script>${readerJs}<\/script>
</body></html>`;
  }

  /** 发布前看一眼：同一套阅读器，只是数据来自当前草稿 */
  async function openPreview() {
    if (!draft.steps.length) { UI.notify('还没有内容可以预览'); return; }
    const dlg = $('#dlg-preview');
    dlg.showModal();
    $('#pvframe').srcdoc = await buildReaderHtml(false);
  }

  /* ── 导出备份：一个自带图片的 HTML 文件 ───────────── */
  async function exportOne() {
    if (!draft.steps.length) { UI.notify('还没有内容可以导出'); return; }
    const html = await buildReaderHtml(true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = (draft.title || '教程') + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ── 把设置搬到手机（二维码） ──────────────────────
     设置存在 localStorage 里，按「设备+浏览器」隔离，本来就传不过去；
     这里走二维码：内容放在 URL 的 # 后面，#之后的部分浏览器不会发给服务器，
     也不会进 Referer。手机读完立刻把它从地址栏抹掉。 */
  const b64url = str => b64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = s2 => new TextDecoder().decode(Uint8Array.from(
    atob(s2.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

  function cfgToUrl() {
    const payload = JSON.stringify({ o: cfg.owner, r: cfg.repo, b: cfg.branch, t: cfg.token });
    return `${siteRoot()}w/#cfg=${b64url(payload)}`;
  }

  function showQr() {
    if (!cfg.owner || !cfg.repo || !cfg.token) { UI.notify('先把上面四项填好并保存，再生成二维码'); return; }
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

  /** 拿到 cfg 载荷后的统一入口：先给人看清楚要导入什么，确认了才写进这台设备。
      fromLink = 用系统相机扫码打开的链接（含 token 的地址已经进了浏览器历史，审查 P3-10） */
  function askImport(raw, fromLink) {
    let p;
    try { p = JSON.parse(unb64url(raw)); } catch (e) { UI.notify('这个码读不出来（可能扫串了）'); return false; }
    if (!p || !p.t) { UI.notify('这个码里没有 token'); return false; }
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
      // 不直接提示完事：扫码导入不经过表单提交，系统密码管理器看不见，
      // 下次 Safari 清数据还得再扫一次。打开设置让人点一下「保存」，把它存进钥匙串
      openSettings(fromLink ? 'importedLink' : 'imported');
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
    // 不管用户点什么，先把地址栏里的 token 抹掉。注意：这只抹得掉地址栏和这一页的记录，
    // 浏览器的全局历史在打开时就已经记下了，所以导入后会提醒去历史记录里删（审查 P3-10）
    history.replaceState(null, '', location.pathname + location.search);
    return askImport(raw, true);
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
    let decoding = false;
    scanTimer = setInterval(async () => {
      if (!v.videoWidth || decoding) return;      // 上一帧还没解完就跳过，免得同一个码被认两次
      decoding = true;
      try {
        // 缩到 480 宽再解：全分辨率逐帧解在手机上会烫手，480 够解 53×53 的码
        const k = Math.min(1, 480 / v.videoWidth);
        cv.width = Math.round(v.videoWidth * k);
        cv.height = Math.round(v.videoHeight * k);
        ctx.drawImage(v, 0, 0, cv.width, cv.height);
        let text = null;
        try { text = await decode(cv); } catch (e) { /* 这一帧没解出来，继续 */ }
        if (!text || !scanTimer) return;
        const raw = cfgFromUrl(text);
        if (!raw) { $('#scan-msg').textContent = '扫到的不是这个网站的设置码，换一个试试'; return; }
        stopScan();
        dlg.close();
        askImport(raw, false);
      } finally { decoding = false; }
    }, 220);
  }

  /* ── 手机上怎么粘贴图片 ──────────────────────────
     手机没有 Ctrl+V，只有两条路：
     ① navigator.clipboard.read()（iOS Safari 会弹一个「粘贴」确认，安卓 Chrome 要权限）
     ② 一个可长按的框：长按 → 系统菜单「粘贴」→ 触发 paste 事件 */
  async function pasteFromClipboard() {
    const f = await readClipboardImage({ quiet: true });
    if (f) { await addFiles([f]); return; }
    // 这条路走不通（浏览器不支持 / 用户拒绝 / 剪贴板里不是图）：指到下面那个一直在的粘贴框
    $('#pastebox').focus();
    $('#addhint').textContent = FINE ? '读不到剪贴板 —— 直接按 Ctrl+V，或在下面的框里右键选「粘贴」'
                                     : '读不到剪贴板 —— 在下面的框里长按，选「粘贴」';
  }

  /* 粘贴框上的提示语按设备说：手机是长按，电脑是右键 / Ctrl+V（苹果电脑是 ⌘V）。
     按"有没有精确指针"分，不按屏幕宽度分——窄窗口的电脑照样是右键 */
  const FINE = matchMedia('(pointer: fine)').matches;
  const PASTE_HINT = FINE ? '在这个框里右键 → 选「粘贴」，或直接按 Ctrl+V（Mac 是 ⌘V）' : '在这个框里长按 → 选「粘贴」';

  /** 粘贴框：既接 paste 事件里的文件，也兜住「图片被直接塞进框里」的情况（iOS 有时这样） */
  function wirePasteBox() {
    const box = $('#pastebox');
    if (!box) return;
    box.dataset.ph = PASTE_HINT;
    const sw = $('#swap-paste');
    if (sw) sw.dataset.ph = PASTE_HINT;
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
    if (loadFailed) { UI.notify('这一页没读到线上的教程，没有东西可以保存。返回或刷新再试。'); return; }
    const ok = await flush();
    const tag = $('#savetag');
    if (!ok) return;
    markClean();
    tag.hidden = false;
    tag.classList.remove('bad');
    tag.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    clearTimeout(tag._t);
    tag._t = setTimeout(() => { tag.hidden = true; }, 4000);
  }

  /** 删掉这一份草稿（只删这一份，别的草稿不动）。破坏性操作：站内确认框 + 红色按钮 */
  async function discardDraft() {
    const editing = slot && slot.startsWith('edit:');
    const yes = await UI.ask({
      title: editing ? '放弃这些修改？' : '删掉这份草稿？',
      msg: editing ? '这里还没发布的修改会清掉，线上那份教程不受影响。' : '图片和文字都会清掉，没法撤销。已经发布过的教程不受影响。',
      ok: editing ? '放弃修改' : '删掉', danger: true
    });
    if (!yes) return false;
    clearTimeout(saveTimer);
    await Store.clear(slot).catch(() => {});
    return true;
  }

  /* 有没有未保存的改动：没改过就别拦人，"只想点进来看看"是常态 */
  let clean = '';
  const snapshot = () => JSON.stringify({
    t: draft.title,
    s: draft.steps.map(x => [x.key, x.remote || '', x.title, x.text, x.saved ? 1 : 0])
  });
  const markClean = () => { clean = snapshot(); };
  // 还没读完（或编辑页没读到内容）时一律算「没改过」：这时候点返回就该直接走（审查 P3-5、P0-1）
  const isDirty = () => ready && !loadFailed && snapshot() !== clean;

  /** url 传 null ＝ 回到来的那一页（同源才算），否则去指定地址 */
  function go(url) {
    if (url) { location.href = url; return; }
    const ref = document.referrer;
    const sameSite = ref && new URL(ref).origin === location.origin
                         && new URL(ref).pathname !== location.pathname;
    if (sameSite && history.length > 1) history.back();
    else location.href = '../';
  }

  /** 离开：三个明确的出口（审查 P1-3：以前「不保存」会把之前存好的整份草稿删掉）。
      内容本来就自动存着，所以默认就是「留着」；真要删，再确认一次，而且只删这一份 */
  async function leaveTo(url) {
    if (!isDirty()) { go(url); return; }                  // 没动过，直接走
    const dlg = $('#dlg-leave');
    const editing = slot && slot.startsWith('edit:');
    $('#lv-title').textContent = editing ? '这些修改还没发布' : '这份草稿还没发布';
    $('#lv-desc').textContent = '已经存在这台设备上了，下次打开接着' + (editing ? '改' : '写') +
                                '；也能在「我的教程」的草稿里找到。';
    $('#lv-save').textContent = editing ? '留着，下次接着改' : '留着，下次接着写';
    $('#lv-drop').textContent = editing ? '放弃这些修改' : '删掉这份草稿';
    $('#lv-save').onclick = async () => { dlg.close(); if (await flush()) go(url); else saveNow(); };
    $('#lv-drop').onclick = async () => { dlg.close(); if (await discardDraft()) go(url); };
    $('#lv-stay').onclick = () => dlg.close();
    dlg.showModal();
  }

  /* ── 设置 ─────────────────────────────────────────── */
  /* 设置为什么会"自己没了"：Safari 的防跟踪（ITP）在**连续 7 天用 Safari 却没点过这个站**时，
     会把它的 localStorage、IndexedDB 全部删掉（webkit.org/blog/10218）。添加到主屏幕的网页不受这条影响。
     网页自己没法阻止，所以把「记住」交给系统密码管理（见 w/index.html 表单上的注释） */
  const KEYTIP = {
    imported: '✅ 已导入这台设备。<b>再点一次「保存」</b>，手机会问要不要存进「密码」——选存储。' +
              '以后设置被浏览器清掉了，点 Token 框、在键盘上方选这条就能填回来，不用再扫码。',
    importedLink: '✅ 已导入这台设备。<b>再点一次「保存」</b>，手机会问要不要存进「密码」——选存储。<br>' +
              '⚠️ 刚才用相机扫码打开的那条链接里带着 token，浏览器的<b>历史记录</b>里可能还留着它：' +
              '介意的话去浏览器历史记录里把这一条删掉（下次用设置里的「📷 扫码导入」就不会留）。',
    empty: '设置是空的？如果以前存过，多半是 Safari 7 天没打开这个站、把网站数据清掉了。' +
           '<b>点 Token 框</b>，键盘上方有存过的就能直接填回来；没有就扫码导入一次，保存时记得存进「密码」。',
  };
  function openSettings(why) {
    $('#f-owner').value = cfg.owner || '';
    $('#f-repo').value = cfg.repo || 'Step-Guides';
    $('#f-branch').value = cfg.branch || 'main';
    $('#f-token').value = cfg.token || '';
    const tip = KEYTIP[why] || (!cfg.token ? KEYTIP.empty : '');
    $('#keytip').innerHTML = tip;
    $('#keytip').hidden = !tip;
    $('#dlg-settings').showModal();
  }

  /* 请求"持久存储"。WebKit 只在类似「添加到主屏幕」的情况下才批准（webkit.org/blog/14403），
     普通 Safari 标签页多半被拒——所以这只是能争取就争取，不指望它，真正兜底的是钥匙串 */
  function askPersist() {
    try { navigator.storage?.persist?.().catch(() => {}); } catch (e) { /* 忽略 */ }
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
      const b = e.target.closest('button[data-op]');
      if (!b) return;
      const i = +b.closest('.step').dataset.i;
      ({ to: () => openMoveTo(i), swap: () => swap(i), del: () => del(i) })[b.dataset.op]();
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

    $('#btn-settings').onclick = () => openSettings();
    $('#btn-cancel-set').onclick = () => $('#dlg-settings').close();
    // 走表单的 submit 而不是按钮 onclick：method="dialog" 的真提交才会让密码管理器弹「要存储吗」
    $('#f-settings').addEventListener('submit', () => {
      cfg.owner = $('#f-owner').value.trim();
      cfg.repo = $('#f-repo').value.trim() || 'Step-Guides';
      cfg.branch = $('#f-branch').value.trim() || 'main';
      cfg.token = $('#f-token').value.trim();
      saveCfg();
      askPersist();
    });
    $('#btn-forget').onclick = () => {
      cfg.token = '';
      saveCfg();
      $('#f-token').value = '';
      UI.notify('token 已从这台设备清除');
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
    $('#btn-discard').onclick = async () => {
      $('#dlg-settings').close();
      if (await discardDraft()) { markClean(); go('../mine/'); }
    };
    $('#btn-mine').onclick = () => { $('#dlg-settings').close(); leaveTo('../mine/'); };
    $('#btn-home').onclick = () => { $('#dlg-settings').close(); leaveTo('../'); };

    // 发布进行中不许关掉进度框（审查 P2-5：以前按 Esc / 安卓返回键就关了，成功失败都看不见，再点一次还会发出第二份）
    $('#dlg-prog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    // 光拦 cancel 不够：Chrome 只在有过真实点击后才允许拦一次，连按两下 Esc 照样关。关掉了就马上再打开
    $('#dlg-prog').addEventListener('close', () => { if (busy) setTimeout(() => { if (busy && !$('#dlg-prog').open) $('#dlg-prog').showModal(); }, 0); });
    $('#p-cancel').onclick = () => { if (abortCtl) abortCtl.abort(); };

    initGestures();

    // 扫码进来的先处理导入（它只改设置，不碰草稿）
    importFromHash();

    // 启动：?edit=<编号> 改已发布的；?draft=<码> 接着写某份新草稿；都没有就问要不要接着上次的
    const qs = new URLSearchParams(location.search);
    const editId = qs.get('edit'), draftKey = qs.get('draft');
    let start;
    if (editId !== null && !isId(editId)) {
      // 编号不是 8 位编号字母：可能是被人改过的链接，不载入（审查 P1-4）
      start = UI.notify('这条编辑链接里的教程编号不对，没有载入。请从「我的教程」里点「编辑」进来。', '链接不对')
        .then(() => startFresh());
    } else if (editId) {
      start = openEdit(editId).catch(err => {
        loadFailed = true;
        lockFailed();
        UI.notify('这份教程读不出来：' + err.message + '\n\n什么都没改，可以返回或者刷新再试。', '读不出来');
      });
    } else if (draftKey && /^[a-z0-9]{1,16}$/.test(draftKey)) {
      start = openDraft('new:' + draftKey);
    } else {
      start = openNewEntry();
    }
    start.finally(() => {
      markClean();                 // 刚载入＝没改动，这时点返回应该直接走
      ready = true;
    });
  }

  // 给验证脚本用的测试口（也方便自己在控制台里手动检查状态）
  window.SGWriter = { addFiles, render, b64url, unb64url, cfgToUrl, cfgFromUrl, askImport,
                      startScan, stopScan, ensureDecoder, openPreview, openZoom, swap,
                      replaceImage, saveNow, buildReaderHtml, del, moveTo, flush,
                      get swipe() { return swipe; }, get drag() { return drag; },
                      get draft() { return draft; }, get slot() { return slot; },
                      get ready() { return ready; } };

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
})();
