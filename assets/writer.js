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
        <div class="thumb"><span class="no">${i + 1}</span><img alt=""></div>
        <div class="fields">
          <input class="stitle" type="text" placeholder="这一步做什么（可不填）" autocomplete="off">
          <textarea class="stext" rows="3" placeholder="跟她说清楚这一步要点哪里、注意什么"></textarea>
        </div>
        <div class="ops">
          <div class="handle" title="拖动排序" draggable="true">⠿</div>
          <button type="button" data-op="up" aria-label="上移">↑</button>
          <button type="button" data-op="down" aria-label="下移">↓</button>
          <button type="button" data-op="more" aria-label="更多">⋯</button>
        </div>`;
      card.querySelector('img').src = s.url;
      card.querySelector('.stitle').value = s.title || '';
      const ta = card.querySelector('.stext');
      ta.value = s.text || '';
      autoGrow(ta);
      return card;
    }));
    $('#addhint').textContent = `已有 ${draft.steps.length} 步，还可以继续加`;
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

  /** ⋯ 浮层：手机上「移到第几步」用点的，不用 prompt 打字 */
  function openMore(i) {
    const n = draft.steps.length;
    const dlg = $('#dlg-more');
    $('#m-title').textContent = `第 ${i + 1} 步`;
    $('#m-chips').innerHTML = Array.from({ length: n }, (_, k) =>
      `<button type="button" class="chip${k === i ? ' now' : ''}" data-to="${k}">${k + 1}</button>`).join('');
    $('#m-chips').onclick = e => {
      const b = e.target.closest('button[data-to]');
      if (!b) return;
      dlg.close();
      moveTo(i, +b.dataset.to);
    };
    $('#m-swap').onclick = () => { dlg.close(); swap(i); };
    $('#m-del').onclick = () => { dlg.close(); del(i); };
    $('#m-cancel').onclick = () => dlg.close();
    dlg.showModal();
  }

  function del(i) {
    if (!confirm(`删掉第 ${i + 1} 步？`)) return;
    const [gone] = draft.steps.splice(i, 1);
    if (gone.remote) draft.gone = [...(draft.gone || []), gone.remote];  // 线上那份也要删
    render(); save();
  }

  function swap(i) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const bmp = await createImageBitmap(f).catch(() => null);
      if (!bmp) return;
      const s = draft.steps[i];
      if (s.remote) draft.gone = [...(draft.gone || []), s.remote];
      draft.steps[i] = { ...s, blob: f, remote: null, url: URL.createObjectURL(f), w: bmp.width, h: bmp.height };
      bmp.close?.();
      render(); save();
    };
    inp.click();
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

  /* ── 导出备份：一个自带图片的 HTML 文件 ───────────── */
  async function exportOne() {
    if (!draft.steps.length) { alert('还没有内容可以导出'); return; }
    const [baseCss, readerCss, readerJs] = await Promise.all([
      fetch('../assets/base.css').then(r => r.text()),
      fetch('../assets/reader.css').then(r => r.text()),
      fetch('../assets/reader.js').then(r => r.text())
    ]);
    const steps = [];
    for (const s of draft.steps) {
      const blob = s.blob ? (await compress(s.blob)).blob : await fetch(s.url).then(r => r.blob());
      steps.push({
        src: 'data:' + blob.type + ';base64,' + await toBase64(blob),
        w: s.w, h: s.h, title: s.title || '', text: s.text || ''
      });
    }
    const html = `<!DOCTYPE html>
<html lang="zh-CN" data-mode="step">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(draft.title)}</title>
<style>${baseCss}\n${readerCss}</style></head>
<body>
<header class="top"><h1 id="title"></h1>
<button class="modebtn tap" id="modebtn" type="button">☰ 长文</button></header>
<div class="topbar-progress"><div class="bar"><i id="fill"></i></div></div>
<div class="deck" id="deck"></div>
<nav class="bottom"><button class="tap" id="prev" type="button">‹ 上一步</button>
<span class="count" id="count">1 / 1</span>
<button class="tap" id="next" type="button">下一步 ›</button></nav>
<dialog id="zoom"><div class="box"><img id="zoomimg" alt=""></div>
<button class="close" type="button" aria-label="关闭">✕</button></dialog>
<script>window.__DATA=${JSON.stringify({ title: draft.title, steps })};<\/script>
<script>${readerJs}<\/script>
</body></html>`;
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

  /** 手机扫码打开后：先给人看清楚要导入什么，确认了才写进这台设备 */
  function importFromHash() {
    const m = /^#cfg=(.+)$/.exec(location.hash);
    if (!m) return false;
    // 不管用户点什么，先把地址栏里的 token 抹掉，别留在历史记录里
    history.replaceState(null, '', location.pathname + location.search);
    let p;
    try { p = JSON.parse(unb64url(m[1])); } catch (e) { alert('这个二维码读不出来（可能扫串了）'); return false; }
    if (!p || !p.t) { alert('这个二维码里没有 token'); return false; }
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
      ({ up: () => move(i, -1), down: () => move(i, 1), more: () => openMore(i) })[btn.dataset.op]();
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
    $('#btn-qr-close').onclick = () => { $('#qr-img').src = ''; $('#dlg-qr').close(); };
    $('#btn-publish').onclick = doPublish;
    $('#btn-export').onclick = exportOne;
    $('#btn-mine').onclick = () => location.href = '../mine/';

    // 扫码进来的先处理导入（它只改设置，不碰草稿）
    importFromHash();

    // 启动：?edit=<id> 优先，其次问要不要接着上次的草稿
    const editId = new URLSearchParams(location.search).get('edit');
    if (editId) {
      loadPublished(editId).catch(err => alert('这份教程读不出来：' + err.message));
    } else {
      restore().then(has => { if (!has) render(); });
    }
  }

  // 给验证脚本用的测试口（也方便自己在控制台里手动检查状态）
  window.SGWriter = { addFiles, render, b64url, unb64url, cfgToUrl, get draft() { return draft; } };

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', boot) : boot();
})();
