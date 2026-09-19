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

  const mode = () => document.documentElement.dataset.mode;
  const setMode = m => {
    document.documentElement.dataset.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 隐私模式下会抛，忽略 */ }
    $('#modebtn').textContent = m === 'step' ? '☰ 长文' : '❯ 逐步';
    $('#modebtn').setAttribute('aria-label', m === 'step' ? '切换到长文模式' : '切换到逐步模式');
    // 切模式时把「当前看到第几步」带过去
    requestAnimationFrame(() => goto(cur, false));
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
      say.append(h, el('p', null, s.text || ''));

      // 文字被裁时才出现「展开」提示；点整块文字都能展开（热区＝整块，不是一个小按钮）
      const more = el('span', 'more', '展开全文 ⌄');
      more.hidden = true;
      say.appendChild(more);
      say.addEventListener('click', e => {
        if (!say.classList.contains('can-open')) return;
        const open = say.classList.toggle('open');
        more.textContent = open ? '收起 ⌃' : '展开全文 ⌄';
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
    // 渲染完才知道哪几步真的被裁掉了（scrollHeight > clientHeight）
    requestAnimationFrame(() => {
      document.querySelectorAll('.page').forEach(p => {
        const para = p.querySelector('.say p');
        const cut = para.scrollHeight > para.clientHeight + 1;
        if (p._more) p._more.hidden = !cut;
        p._say.classList.toggle('can-open', cut);
        if (cut) { p._say.setAttribute('role', 'button'); p._say.tabIndex = 0; }
      });
    });
    sync();
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

  function paint() {
    const n = steps.length || 1;
    $('#count').textContent = `${cur + 1} / ${n}`;
    $('#fill').style.width = ((cur + 1) / n * 100) + '%';
    $('#prev').disabled = cur === 0;
    $('#next').disabled = cur === n - 1;
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
      const tip = el('div', 'ztip');
      tip.textContent = matchMedia('(pointer: fine)').matches
        ? '滚轮缩放 · 双击放大 · 按住拖动 · Esc 关闭'
        : '双指捏合放大 · 双击放大 · 拖动查看';
      dlg.appendChild(tip);
      bar.querySelector('.zclose').addEventListener('click', () => dlg.close());
      bar.querySelector('.zreset').addEventListener('click', () => zoomer && zoomer.reset());
    }
    return dlg;
  }

  async function openZoom(src, alt) {
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
      requestAnimationFrame(() => { sync(); tick = false; });
    };
    $('#deck').addEventListener('scroll', onScroll, { passive: true });
    addEventListener('scroll', onScroll, { passive: true });

    addEventListener('keydown', e => {
      if ($('#zoom').open) return;
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList.contains('say')) {
        document.activeElement.click(); e.preventDefault(); return;
      }
      if (e.key === 'ArrowRight') goto(cur + 1);
      if (e.key === 'ArrowLeft') goto(cur - 1);
    });

    // 放大后要能按住拖动，所以不能再"点图以外任何地方就关"——
    // 拖到图外一松手就会误关。关闭只认工具栏按钮和 Esc。

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
