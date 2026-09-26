/* 阅读器：读同目录的 data.json 渲染。
   两种模式共用一份 DOM，只切 <html data-mode>：
     step  一步一屏，左右翻（默认）
     long  长文流，上下滑（回看用）
   这份文件是全站唯一的阅读逻辑——改这里，所有已发布的教程一起变。 */
(() => {
  'use strict';

  // 记下自己所在的目录：老教程的壳子里没有引 zoom.js，要靠这个路径按需去取。
  // 这样改了阅读器，历史教程不用重新发布也能用上新功能。
  // 按需加载 zoom.js 时要用的目录。导出/预览时这份代码是内联的：
  // currentScript.src 为空，而 iframe 的 location 是 about:srcdoc —— 那不是合法基址，
  // new URL() 会抛错并把整个阅读器打断（踩过）。所以包住，拿不到就置空，
  // 反正那两种场景里 zoom.js 已经一起内联进去了。
  let ASSETS = '';
  try {
    ASSETS = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;
  } catch (e) { ASSETS = ''; }

  const MODE_KEY = 'sg.readMode';
  const $ = s => document.querySelector(s);
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  let steps = [], cur = 0;

  /* 观感层档位。**默认关闭**（2026-09-20 回滚）。
     回滚原因：逐步模式的视差把 opacity 写成行内样式，切到长文模式后视差不再运行、
     但行内样式没人清 —— 长文模式下的说明文字一直半透明，没法看。
     想再看效果加 ?fx=a / ?fx=b；要重新默认开启，必须先修掉上面那个清理问题。 */
  const FX = (() => {
    const q = new URLSearchParams(location.search).get('fx');
    return (q === 'a' || q === 'b') ? q : '';
  })();

  const mode = () => document.documentElement.dataset.mode;
  const setMode = m => {
    document.documentElement.dataset.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 隐私模式下会抛，忽略 */ }
    $('#modebtn').textContent = m === 'step' ? '☰ 长文' : '❯ 逐步';
    $('#modebtn').setAttribute('aria-label', m === 'step' ? '切换到长文模式' : '切换到逐步模式');
    /* 切模式时把「当前看到第几步」带过去。
       ⚠️ 必须先确认页面已经渲染出来了：boot 里 setMode 跑在 render 之前，
       这个 rAF 在本地/缓存命中时会晚于 render 执行，于是拿一个还没算准的 cur 去定位 ——
       表现为长文模式**偶发"一进来就停在第 2 步"**（6 次里中 3~4 次）。
       老毛病，2026-09-20 定位到。没渲染就不定位，render 自己会摆正。 */
    if (steps.length) requestAnimationFrame(() => goto(cur, false));
    /* 切回逐步模式必须重量一次「正文有没有被裁」。
       长文模式下正文不裁（line-clamp 只挂在 step 上），这时量出来全是"没被裁"；
       上次停在长文模式 → 打开教程 → 切回逐步，文字被裁出了省略号，「更多」却一个都不显示。
       表现为**偶发**：取决于上次离开时停在哪个模式（记在 localStorage 里）。2026-09-26 定位 */
    if (m === 'step' && steps.length) requestAnimationFrame(measureClamp);
    if (addSides.fit) requestAnimationFrame(addSides.fit);
    closeTitlePop();
  };

  /* ── 点标题看完整标题 ─────────────────────────────────
     窄屏标题会被省略号截断。点一下在顶栏下方浮出一张卡片显示全文，
     **浮层不挤版面**：顶栏要是自己长高，逐步模式里截图会跟着缩一下再弹回来，很晃。
     没被截断时点标题什么也不做。点任意处 / 翻页 / 转屏 / Esc 都会收起 */
  let titlePop = null;
  const titleCut = () => { const h = $('#title'); return !!h && h.scrollWidth > h.clientWidth + 1; };
  function openTitlePop() {
    const top = $('.top');
    if (!top) return;
    titlePop = el('div', 'title-pop', $('#title').textContent);
    titlePop.setAttribute('role', 'status');
    titlePop.style.top = Math.round(top.getBoundingClientRect().bottom + 6) + 'px';
    document.body.appendChild(titlePop);
    $('#title').setAttribute('aria-expanded', 'true');
  }
  function closeTitlePop() {
    if (!titlePop) return;
    titlePop.remove();
    titlePop = null;
    const h = $('#title');
    if (h) h.setAttribute('aria-expanded', 'false');
  }
  function wireTitle() {
    const h = $('#title');
    if (!h) return;
    const sync = () => {                 // 只有真被截断时才像个按钮
      const cut = titleCut();
      h.classList.toggle('is-cut', cut);
      if (cut) { h.setAttribute('role', 'button'); h.tabIndex = 0; h.title = h.textContent; }
      else { h.removeAttribute('role'); h.removeAttribute('tabindex'); h.removeAttribute('title'); }
    };
    h._sync = sync;
    h.addEventListener('click', e => {
      if (titlePop) { closeTitlePop(); return; }
      if (!titleCut()) return;
      e.stopPropagation();
      openTitlePop();
    });
    h.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && h.getAttribute('role') === 'button') { e.preventDefault(); h.click(); }
    });
    // 捕获阶段：点到别处先收起浮层（点标题本身由上面的 click 自己切换）
    addEventListener('pointerdown', e => { if (titlePop && e.target !== h) closeTitlePop(); }, true);
    addEventListener('resize', () => { closeTitlePop(); sync(); });
  }

  /* ── 渲染 ─────────────────────────────────────────── */
  function render(data) {
    document.title = data.title;
    $('#title').textContent = data.title;
    requestAnimationFrame(() => $('#title')._sync && $('#title')._sync());
    steps = data.steps;

    const deck = $('#deck');
    deck.replaceChildren(...steps.map((s, i) => {
      const page = el('section', 'page');
      page.dataset.i = i;

      const shot = el('div', 'shot');
      const img = new Image();
      img.src = s.src || ('i/' + s.img);
      // width/height 属性让浏览器提前按比例留位，图片加载出来不会把文字顶走
      if (s.w && s.h) { img.width = s.w; img.height = s.h; }
      img.alt = `第 ${i + 1} 步的截图`;
      img.loading = i < 2 ? 'eager' : 'lazy';
      img.addEventListener('click', () => openZoom(img.src, img.alt));
      shot.appendChild(img);

      const say = el('div', 'say');
      const h = el('div', 'h');
      h.append(el('span', 'badge', String(i + 1)), el('h2', null, s.title || ''));
      /* 正文和「更多」放在同一个定位容器里：「更多」叠在末行右端、背后垫一层渐隐，
         **不占额外行高**。矮屏当初之所以把提示整个藏掉就是为了省高度，
         用这种叠加式提示就没有那个取舍了（省略号只说明"被截了"，
         说明不了"能点开"——用户反馈「不知道的还以为就这么多内容」）。 */
      const txt = el('div', 'txt');
      const para = el('p', null, s.text || '');
      const more = el('span', 'more');
      more.append(el('span', 'more-t', '更多'), el('i', 'chev'));
      more.hidden = true;
      txt.append(para, more);
      say.append(h, txt);

      // 点整块文字都能展开（热区＝整块，不是一个小按钮）
      say.addEventListener('click', () => {
        if (!say.classList.contains('can-open')) return;
        animateOpen(say, () => {
          const open = say.classList.toggle('open');
          more.querySelector('.more-t').textContent = open ? '收起' : '更多';
        });
      });
      page._more = more;
      page._say = say;

      if (i === steps.length - 1) {
        const done = el('div', 'done');
        done.append(el('b', null, '做完啦 🎉 '), el('span', null, '有不明白的随时问我'));
        const again = el('button', 'again tap', '↺ 从头再看');
        again.type = 'button';
        // 别让这一下冒泡到 .say（那会触发"展开/收起正文"）
        again.addEventListener('click', e => { e.stopPropagation(); goto(0); });
        done.appendChild(again);
        say.appendChild(done);
      }

      page.append(shot, say);
      return page;
    }));

    $('#count').textContent = `1 / ${steps.length}`;
    buildStepsPanel();
    // 空字符串也会命中 html[data-fx] 选择器，关掉必须把属性整个删掉
    if (FX) document.documentElement.dataset.fx = FX;
    else delete document.documentElement.dataset.fx;
    requestAnimationFrame(() => { measureClamp(); parallax(); paintSegs(); playEnter(cur); if (addSides.fit) addSides.fit(); });
    /* 裁几行是跟视口高度走的（矮屏 3→2→1 行），所以转屏/改窗口后必须重量一次，
       否则横过来明明放得下却还挂着「更多」，或者竖回去被裁了却没提示 */
    let mt = 0;
    const remeasure = () => { clearTimeout(mt); mt = setTimeout(measureClamp, 120); };
    addEventListener('resize', remeasure);
    addEventListener('orientationchange', remeasure);
    sync();
  }

  /* 判断正文有没有被裁。
     不能只看 `scrollHeight > clientHeight`：那是 `-webkit-line-clamp` 下的实现细节，
     各浏览器口径不一致，验不准。改成**临时取消裁剪量一次真实高度**再比 —— 谁都认。 */
  function measureClamp() {
    document.querySelectorAll('.page').forEach(p => {
      const say = p._say, para = say && say.querySelector('.txt p');
      if (!para) return;
      if (say.classList.contains('open')) return;          // 已展开的不动
      const shown = para.clientHeight;
      para.classList.add('unclamp');
      const full = para.scrollHeight;
      para.classList.remove('unclamp');
      const cut = full > shown + 1;
      if (p._more) p._more.hidden = !cut;
      say.classList.toggle('can-open', cut);
      if (cut) { say.setAttribute('role', 'button'); say.tabIndex = 0; }
      else { say.removeAttribute('role'); say.removeAttribute('tabindex'); }
    });
  }

  /* 展开/收起要有过渡，不能"啪"地跳一下。
     line-clamp 本身不可动画，所以量出改动前后的高度，拿显式高度过渡，完事再交还 auto。 */
  function animateOpen(say, toggle) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { toggle(); return; }
    const from = say.offsetHeight;
    toggle();
    const to = say.offsetHeight;
    if (from === to) return;
    say.style.height = from + 'px';
    say.style.overflow = 'hidden';
    void say.offsetHeight;                                  // 强制生效，否则浏览器会合并成一帧
    say.style.transition = 'height .34s cubic-bezier(.22,1,.36,1)';
    say.style.height = to + 'px';
    const done = () => {
      say.style.height = say.style.transition = say.style.overflow = '';
      say.removeEventListener('transitionend', done);
    };
    say.addEventListener('transitionend', done);
    setTimeout(done, 480);                                  // transitionend 偶尔不来，兜一手
  }

  /* ── 定位与进度 ───────────────────────────────────── */
  function goto(i, smooth = true) {
    i = Math.max(0, Math.min(steps.length - 1, i));
    const page = document.querySelector(`.page[data-i="${i}"]`);
    if (!page) return;
    if (mode() === 'step') {
      $('#deck').scrollTo({ left: page.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    } else {
      page.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    }
    cur = i;
    paint();
    playEnter(i);
  }

  /* 播一次入场。只由 goto 和首屏调用 —— 手指滑动翻页不播，理由见 reader.css 的说明。
     先摘类再强制一次布局，动画才会重新播（CSS 动画不摘类只播一次）。 */
  function playEnter(i) {
    if (reduceMotion() || !document.documentElement.dataset.fx) return;
    const p = document.querySelector(`.page[data-i="${i}"]`);
    if (!p) return;
    p.classList.remove('enter');
    void p.offsetWidth;
    p.classList.add('enter');
    clearTimeout(p._et);
    // 播完把类摘掉，否则 animation-fill-mode:both 会把元素钉在终态，
    // 以后改样式（比如展开正文）会莫名其妙不生效
    p._et = setTimeout(() => p.classList.remove('enter'), 700);
  }

  function sync() {
    const pages = [...document.querySelectorAll('.page')];
    if (!pages.length) return;
    if (mode() === 'step') {
      const deck = $('#deck');
      cur = Math.round(deck.scrollLeft / deck.clientWidth);
    } else {
      // 长文模式：以视口上方 40% 处为准线，落在谁身上就算第几步
      const line = innerHeight * 0.4;
      let k = 0;
      pages.forEach((p, i) => { if (p.getBoundingClientRect().top <= line) k = i; });
      cur = k;
    }
    cur = Math.max(0, Math.min(steps.length - 1, cur));
    paint();
  }

  let lastCur = -1;
  function paint() {
    markCurrentStep();
    syncFab();
    const n = steps.length || 1;
    $('#count').textContent = `${cur + 1} / ${n}`;
    $('#fill').style.width = ((cur + 1) / n * 100) + '%';
    $('#prev').disabled = cur === 0;
    /* 最后一步：「下一步」不再置灰，而是变成「↺ 从头再看」——走到终点时主按钮换成终点动作，
       不占任何额外高度（在说明卡里另加按钮会把矮屏最后一步的截图挤窄，回归测试抓到过） */
    const atEnd = cur === n - 1 && n > 1;
    $('#next').disabled = n <= 1;
    $('#next').classList.toggle('restart', atEnd);
    $('#next').textContent = atEnd ? '↺ 从头再看' : '下一步 ›';
    const fb = $('#firstbtn');
    if (fb) fb.disabled = cur === 0;
    const sp = $('.side-prev'), sn = $('.side-next');
    if (sp) sp.disabled = cur === 0;
    if (sn) sn.disabled = cur === n - 1;

    if (cur !== lastCur) {
      lastCur = cur;
      /* 给当前这一页打标记：序号徽章的弹入动画挂在 .is-cur 上。
         先摘掉再加，动画才会重新播（不摘的话 CSS 动画只播一次） */
      document.querySelectorAll('.page.is-cur').forEach(p => p.classList.remove('is-cur'));
      const p = document.querySelector(`.page[data-i="${cur}"]`);
      if (p) { void p.offsetWidth; p.classList.add('is-cur'); }
      paintSegs();
      /* 翻页给一下极轻的触感。**只有支持 Vibration API 的设备有**——
         iOS Safari 至今不支持，iPhone 上这行等于没有，不要当成"已实现触感反馈" */
      if (!reduceMotion() && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    }
  }

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 分段进度：一步一格。12 步时连续条每格只动 8%，肉眼看不出进展；分段能一眼看到"还剩几格" */
  let segs = null;
  function buildSegs() {
    if (segs || !steps.length) return segs;
    const host = document.querySelector('.topbar-progress');
    if (!host) return null;
    segs = el('div', 'segs');
    steps.forEach(() => segs.appendChild(el('i')));
    host.appendChild(segs);
    return segs;
  }
  function paintSegs() {
    const box = buildSegs();
    if (!box) return;
    [...box.children].forEach((x, i) => {
      x.classList.toggle('on', i <= cur);
      x.classList.toggle('cur', i === cur);
    });
  }

  /* 翻页视差：图和说明卡都比页面挪得慢一点，形成前后层次；同时淡出。
     只写 transform / opacity —— 这两个属性不触发重排，手指跟手才不会掉帧。

     ⚠️ 位移只能走横向。最初写的是说明卡"下沉 14px"，结果把它顶出了页面框，
     而 .deck 是 overflow-y:hidden —— 滑动过程中说明卡会被切掉一截（verify.js 的
     inPage 断言抓到的就是这个，不是误报）。横向位移没有这个问题。

     18px ≈ 390 宽的 4.6%：再小看不出来，再大图就跟页面"脱层"了。
     说明卡取 8px，比图慢一档，这样图在前、字在后，层次才分得开。 */
  const IMG_SHIFT = 18, SAY_SHIFT = 8, SAY_FADE = .7;
  function parallax() {
    const root = document.documentElement;
    if (!root.dataset.fx || root.dataset.mode !== 'step' || reduceMotion()) return;
    const deck = $('#deck');
    const w = deck.clientWidth || 1;
    document.querySelectorAll('.page').forEach(p => {
      const t = Math.max(-1.2, Math.min(1.2, (p.offsetLeft - deck.scrollLeft) / w));
      const a = Math.abs(t);
      const img = p.querySelector('.shot img');
      const say = p._say;
      if (img) img.style.transform = `translate3d(${(-t * IMG_SHIFT).toFixed(2)}px,0,0)`;
      if (say) {
        say.style.transform = `translate3d(${(-t * SAY_SHIFT).toFixed(2)}px,0,0)`;
        say.style.opacity = String(Math.max(0, 1 - a * SAY_FADE));
      }
    });
  }

  /* ── 回到顶部的悬浮键（只在长文模式、滚远了才出现） ── */
  let fab = null;
  function buildFab() {
    if (fab) return fab;
    fab = el('button', 'fab tap');
    fab.type = 'button';
    fab.textContent = '↑';
    fab.setAttribute('aria-label', '回到最上面');
    fab.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(fab);
    return fab;
  }
  function syncFab() {
    const f = buildFab();
    f.classList.toggle('on', mode() === 'long' && scrollY > 400);
  }

  /* ── 全部步骤面板 ─────────────────────────────────
     步骤一多，一步步点「下一步」太慢。给一个缩略图面板直接跳。
     按钮和面板都是运行时生成的：老教程的壳子里没有它们，但阅读器只有一份，
     改这里所有历史教程一起生效（不用重新发布）。 */
  let panel = null;

  function buildStepsPanel() {
    if (panel) return panel;

    const btn = el('button', 'stepsbtn tap');
    btn.type = 'button';
    btn.setAttribute('aria-label', '全部步骤');
    // 按钮上原来写「12 步」；总步数现在由标题旁的「1 / 12」给了，再写一遍就重复了
    btn.innerHTML = '<span class="sb-ico">▦</span><span class="sb-n">目录</span>';
    btn.addEventListener('click', () => openSteps());
    const top = $('.top');
    if (top) top.insertBefore(btn, $('#modebtn'));

    const mask = el('div', 'steps-mask');
    mask.hidden = true;
    const aside = el('aside', 'steps');
    aside.innerHTML =
      '<div class="steps-head"><b>全部步骤</b>' +
      '<button class="steps-close tap" type="button" aria-label="关闭">✕</button></div>' +
      '<div class="steps-grid"></div>';
    mask.appendChild(aside);
    document.body.appendChild(mask);

    mask.addEventListener('click', e => { if (e.target === mask) closeSteps(); });
    aside.querySelector('.steps-close').addEventListener('click', closeSteps);

    panel = { btn, mask, aside, grid: aside.querySelector('.steps-grid') };
    return panel;
  }

  function fillSteps() {
    const p = buildStepsPanel();
    p.grid.replaceChildren(...steps.map((s, i) => {
      const cell = el('button', 'scell tap');
      cell.type = 'button';
      cell.dataset.i = i;
      const im = new Image();
      im.src = s.src || ('i/' + s.img);
      im.loading = 'lazy';
      im.alt = '';
      const no = el('span', 'sno', String(i + 1));
      const cap = el('span', 'scap', s.title || s.text || '');
      const shot = el('span', 'sthumb');       // 电脑端要把序号压在缩略图角上，得有个定位容器
      shot.append(im, no);
      cell.append(shot, cap);
      cell.addEventListener('click', () => { closeSteps(); goto(i); });
      return cell;
    }));
  }

  function openSteps() {
    const p = buildStepsPanel();
    fillSteps();
    p.mask.hidden = false;
    requestAnimationFrame(() => p.mask.classList.add('on'));
    markCurrentStep();
  }

  function closeSteps() {
    if (!panel) return;
    panel.mask.classList.remove('on');
    setTimeout(() => { if (panel && !panel.mask.classList.contains('on')) panel.mask.hidden = true; }, 220);
  }

  function markCurrentStep() {
    if (!panel || panel.mask.hidden) return;
    panel.grid.querySelectorAll('.scell').forEach(c => {
      const on = +c.dataset.i === cur;
      c.classList.toggle('now', on);
      if (on) c.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ── 放大层 ───────────────────────────────────────── */
  let zoomer = null;

  const loadOnce = src => new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('加载失败 ' + src));
    document.head.appendChild(sc);
  });

  /** 把弹层补成新结构：顶部一条工具栏（倍率 + 醒目的关闭），底部一句操作提示。
      老教程的壳子只有 .box + img + .close，这里缺什么补什么。 */
  function upgradeZoomDom() {
    let dlg = $('#zoom');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'zoom';
      dlg.innerHTML = '<div class="box"><img id="zoomimg" alt=""></div>';
      document.body.appendChild(dlg);
    }
    if (!dlg.querySelector('.box')) {
      const box = el('div', 'box');
      box.appendChild(dlg.querySelector('img') || Object.assign(new Image(), { id: 'zoomimg' }));
      dlg.prepend(box);
    }
    dlg.querySelector('.close')?.remove();       // 换成带文字的高对比按钮
    if (!dlg.querySelector('.zbar')) {
      const bar = el('div', 'zbar');
      bar.innerHTML = '<span class="zpct">100%</span>' +
        '<button class="zreset" type="button">还原</button>' +
        '<button class="zclose" type="button">✕ 关闭</button>';
      dlg.appendChild(bar);
      bar.querySelector('.zclose').addEventListener('click', () => dlg.close());
      bar.querySelector('.zreset').addEventListener('click', () => zoomer && zoomer.reset());
    }
    return dlg;
  }

  /** 样式也要按需注入：老教程的壳子里既没有 zoom.js 也没有 zoom.css，
      少了样式的话弹层会退化成浏览器默认的小白框（写作页就这么翻过车） */
  function ensureZoomCss() {
    if (!ASSETS) return;                                  // 导出/预览：样式已经内联了
    if (document.querySelector('link[data-sg-zoom]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = ASSETS + 'zoom.css';
    l.dataset.sgZoom = '1';
    document.head.appendChild(l);
  }

  async function openZoom(src, alt) {
    ensureZoomCss();
    const dlg = upgradeZoomDom();
    if (!zoomer) {
      if (!window.SGZoom) await loadOnce(ASSETS + 'zoom.js');
      zoomer = window.SGZoom.mount(dlg);
    }
    zoomer.open(src, alt);
  }

  /* ── 启动 ─────────────────────────────────────────── */
  /* 「第几步 / 共几步」挪到顶栏、紧跟标题。
     原来夹在底栏两个按钮中间：眼睛读的是 标题 → 图 → 字，进度却在最后一行，要专门往下找；
     挪上来之后，"这是什么 + 到哪了"在同一行一眼看完，底栏只剩两个按钮、各自更宽，拇指更好点。
     长文模式底栏是隐藏的，以前根本看不到进度，现在顶栏吸顶也跟着显示。
     **用 JS 挪而不是改壳子**：每份已发布的教程 index.html 里都写死了底栏里的 #count，
     改壳子要重新发布所有旧教程；在这里挪一下，全部历史教程一起生效。 */
  function liftCount() {
    const c = $('#count'), h = $('#title');
    if (!c || !h || c.parentNode === h.parentNode) return;
    c.setAttribute('aria-live', 'polite');   // 翻页时读屏会念出新的进度
    h.after(c);
  }

  /* 能不能"回到站里"：导出的单文件、写作页里的预览都是自包含的，没有站可回，不给返回键 */
  const inSite = () => !window.__DATA && /^https?:$/.test(location.protocol);

  /* ── 返回键（iOS 导航栏左上角那个 ‹） ──────────────
     从站内点进来的（教程库、首页）→ 回到来的地方；
     别人从聊天里直接点链接打开的（没有站内上一页）→ 回首页 */
  function addBack() {
    const top = $('.top'), h = $('#title');
    if (!top || !h || !inSite() || $('#backbtn')) return;
    const b = el('button', 'backbtn tap', '‹');
    b.id = 'backbtn';
    b.type = 'button';
    b.setAttribute('aria-label', '返回');
    b.addEventListener('click', () => {
      let same = false;
      try { same = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
      if (same && history.length > 1) history.back();
      else location.href = new URL('../../', location.href).href;
    });
    top.insertBefore(b, h);
  }

  /* ── 回到第一步 ─────────────────────────────────────
     底栏「上一步」左边一个小方键；第 1 步时置灰（不隐藏：隐藏会让两个大按钮跟着变宽变窄地跳） */
  function addFirst() {
    const prev = $('#prev');
    if (!prev || $('#firstbtn')) return;
    const b = el('button', 'firstbtn tap', '⏮');
    b.id = 'firstbtn';
    b.type = 'button';
    b.setAttribute('aria-label', '回到第一步');
    b.title = '回到第一步';
    b.addEventListener('click', () => goto(0));
    prev.parentNode.insertBefore(b, prev);
  }

  /* ── 电脑两侧的翻页区（照 Mac「照片」：左右两侧整条都能点，中间一个大圆箭头）──
     大屏两边本来就是空白，拿来做热区：整条侧栏都算，点偏了也能翻。
     只在宽屏 + 逐步模式出现（CSS 控制），窄屏的左右滑动不受影响 */
  function addSides() {
    if ($('.side-nav')) return;
    const mk = (dir, label, arrow) => {
      const b = el('button', 'side-nav side-' + dir + ' tap');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.appendChild(el('span', 'side-ico', arrow));
      b.addEventListener('click', () => goto(cur + (dir === 'prev' ? -1 : 1)));
      document.body.appendChild(b);
      return b;
    };
    mk('prev', '上一步', '‹');
    mk('next', '下一步', '›');
    // 热区只盖住中间的内容区（量 .deck 的实际上下沿），不压在顶栏/底栏上
    const fit = () => {
      const d = $('#deck');
      if (!d) return;
      const r = d.getBoundingClientRect();
      document.documentElement.style.setProperty('--side-top', Math.round(r.top) + 'px');
      document.documentElement.style.setProperty('--side-bottom', Math.round(innerHeight - r.bottom) + 'px');
    };
    addSides.fit = fit;
    addEventListener('resize', fit);
    fit();
  }

  function boot() {
    liftCount();
    addBack();
    addFirst();
    addSides();
    wireTitle();
    let saved = 'step';
    try { saved = localStorage.getItem(MODE_KEY) || 'step'; } catch (e) { /* 忽略 */ }
    setMode(saved === 'long' ? 'long' : 'step');

    $('#modebtn').addEventListener('click', () => setMode(mode() === 'step' ? 'long' : 'step'));
    $('#prev').addEventListener('click', () => goto(cur - 1));
    $('#next').addEventListener('click', () => goto(cur >= steps.length - 1 ? 0 : cur + 1));

    let tick = false;
    const onScroll = () => {
      if (tick) return;
      tick = true;
      closeTitlePop();
      requestAnimationFrame(() => { sync(); parallax(); tick = false; });
    };
    $('#deck').addEventListener('scroll', onScroll, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });

    addEventListener('keydown', e => {
      if (e.key === 'Escape' && titlePop) { closeTitlePop(); return; }
      if (e.key === 'Escape' && panel && !panel.mask.hidden) { closeSteps(); return; }
      if ($('#zoom') && $('#zoom').open) return;
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList.contains('say')) {
        document.activeElement.click(); e.preventDefault(); return;
      }
      if (e.key === 'ArrowRight') goto(cur + 1);
      if (e.key === 'ArrowLeft') goto(cur - 1);
      if (e.key === 'Home' && mode() === 'step') goto(0);
      if (e.key === 'End' && mode() === 'step') goto(steps.length - 1);
    });

    // 放大后要能按住拖动，所以不能再"点图以外任何地方就关"——
    // 拖到图外一松手就会误关。关闭只认工具栏按钮和 Esc。

    // 样式提前预载：等第一次点图再取，会闪一下没样式的弹层（线上实测 sheet 还没 ready）
    ensureZoomCss();

    // 导出的单文件版把数据内嵌在 window.__DATA，不再去取 data.json
    (window.__DATA
      ? Promise.resolve(window.__DATA)
      : fetch('data.json', { cache: 'no-cache' })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }))
      .then(render)
      .catch(err => {
        $('#deck').replaceChildren(
          el('p', 'done', '这份教程没能加载出来：' + err.message)
        );
      });
  }

  document.readyState === 'loading'
    ? addEventListener('DOMContentLoaded', boot)
    : boot();
})();
