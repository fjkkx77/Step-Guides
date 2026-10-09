/* 站内的提示框 / 确认框 / 手动复制框，代替浏览器原生的那三个弹框（审查 P3-6、P2-12）。
   为什么不用原生的：iPhone 和微信里原生弹框上方会显示网址，看着像网页在要权限；
   按钮文字改不了（只有「取消/确定」，说不清）；自动化测试里会把页面卡住。
   样式沿用 writer.css 里的 dialog / .sheet / .row（写作页和教程库都引了它）。 */
(() => {
  'use strict';

  function open(title, msg, build) {
    const d = document.createElement('dialog');
    d.className = 'sg-ui';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    const h = document.createElement('h2');
    h.textContent = title;
    sheet.appendChild(h);
    if (msg) {
      const p = document.createElement('p');
      p.style.whiteSpace = 'pre-line';
      p.textContent = msg;
      sheet.appendChild(p);
    }
    build(sheet, d);
    d.appendChild(sheet);
    document.body.appendChild(d);
    d.addEventListener('close', () => setTimeout(() => d.remove(), 0));
    d.showModal();
    return d;
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tap ' + (cls || '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /** 确认：返回 true/false。按 Esc 或点「取消」都是 false。danger=true 时确认键是红色实心（破坏性操作） */
  function ask({ title, msg = '', ok = '确定', cancel = '取消', danger = false }) {
    return new Promise(res => {
      let answer = false;
      open(title, msg, (sheet, d) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.append(button(cancel, 'sg-cancel', () => d.close()),
                   button(ok, (danger ? 'danger-solid' : 'go') + ' sg-ok', () => { answer = true; d.close(); }));
        sheet.appendChild(row);
        d.addEventListener('close', () => res(answer));
      });
    });
  }

  /** 只是告诉一声：一个「知道了」 */
  function notify(msg, title = '提示') {
    return new Promise(res => {
      open(title, msg, (sheet, d) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.append(button('知道了', 'go sg-ok', () => d.close()));
        sheet.appendChild(row);
        d.addEventListener('close', () => res());
      });
    });
  }

  /** 复制不了剪贴板时，把文字放进一个选中的输入框让人自己长按复制 */
  function copyText(text, title = '手动复制这条链接') {
    open(title, '长按（电脑上 Ctrl+C）复制下面这段：', (sheet, d) => {
      const f = document.createElement('div');
      f.className = 'field';
      const inp = document.createElement('input');
      inp.readOnly = true;
      inp.value = text;
      f.appendChild(inp);
      const row = document.createElement('div');
      row.className = 'row';
      row.append(button('关掉', 'go sg-ok', () => d.close()));
      sheet.append(f, row);
      requestAnimationFrame(() => { inp.focus(); inp.select(); });
    });
  }

  window.SGUI = { ask, notify, copyText };
})();
