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

  /* 观感层档位。默认 a（克制版）。
     ?fx=b  更进一步（悬浮胶囊底栏 + 分段进度）
     ?fx=off 完全关掉，退回最朴素的样子 —— 出对比图、以及万一线上出问题时的退路 */
  const FX = (() => {
    const q = new URLSearchParams(location.search).get('fx');
    if (q === 'off' || q === '0') return '';
    return (q === 'a' || q === 'b') ? q : 'a';
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
  };

  /* ── 渲染 ─────────────────────────────────────────── */
  function render(data) {
    document.title = data.title;
    $('#title').textContent = data.title;
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
        say.appendChild(done);
      }

      page.append(shot, say);
      return page;
    }));

    $('#count').textContent = `1 / ${steps.length}`;
    buildStepsPanel().btn.querySelector('.sb-n').textContent = steps.length;
    // 空字符串也会命中 html[data-fx] 选择器，关掉必须把属性整个删掉
    if (FX) document.documentElement.dataset.fx = FX;
    else delete document.documentElement.dataset.fx;
    requestAnimationFrame(() => { measureClamp(); parallax(); paintSegs(); playEnter(cur); });
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
    $('#next').disabled = cur === n - 1;

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
    btn.innerHTML = '<span class="sb-ico">▦</span><span class="sb-n"></span>';
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
    p.btn.querySelector('.sb-n').textContent = steps.length;
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
  function boot() {
    let saved = 'step';
    try { saved = localStorage.getItem(MODE_KEY) || 'step'; } catch (e) { /* 忽略 */ }
    setMode(saved === 'long' ? 'long' : 'step');

    $('#modebtn').addEventListener('click', () => setMode(mode() === 'step' ? 'long' : 'step'));
    $('#prev').addEventListener('click', () => goto(cur - 1));
    $('#next').addEventListener('click', () => goto(cur + 1));

    let tick = false;
    const onScroll = () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(() => { sync(); parallax(); tick = false; });
    };
    $('#deck').addEventListener('scroll', onScroll, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });

    addEventListener('keydown', e => {
      if (e.key === 'Escape' && panel && !panel.mask.hidden) { closeSteps(); return; }
      if ($('#zoom') && $('#zoom').open) return;
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList.contains('say')) {
        document.activeElement.click(); e.preventDefault(); return;
      }
      if (e.key === 'ArrowRight') goto(cur + 1);
      if (e.key === 'ArrowLeft') goto(cur - 1);
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
