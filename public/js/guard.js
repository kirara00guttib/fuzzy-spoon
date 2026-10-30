// 出问题的时候不要只留一张白纸：把错误直接摆在页面上
(function () {
  var shown = false;
  function panel(title, text) {
    if (shown) return;
    shown = true;
    var box = document.createElement('div');
    box.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:99',
      'background:#fff8ee', 'color:#2b2436', 'border:2px solid #c2506a',
      'box-shadow:4px 4px 0 #2b2436', 'padding:14px 16px', 'font:14px/1.6 ui-monospace,monospace',
      'max-height:50vh', 'overflow:auto', 'white-space:pre-wrap',
    ].join(';');
    box.textContent = title + '\n\n' + text;
    document.body.appendChild(box);
  }
  window.addEventListener('error', function (e) {
    // 只有脚本自己出错才弹；图片/字体加载失败不算页面崩了
    var isResource = e.target && e.target !== window && (e.target.tagName === 'IMG' || e.target.tagName === 'LINK');
    if (!e.message || isResource) {
      if (e.target && e.target.tagName === 'SCRIPT') {
        panel('脚本加载失败', (e.target.src || '') + '\n检查文件是否存在、路径对不对。');
      }
      return;
    }
    panel('页面出错', e.message + (e.error && e.error.stack ? '\n\n' + e.error.stack : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason || {};
    panel('页面出错（Promise）', (r.message || String(r)) + (r.stack ? '\n\n' + r.stack : ''));
  });
  setTimeout(function () {
    var login = document.getElementById('login');
    var app = document.getElementById('app');
    if (login && app && login.hidden && app.hidden && !shown) {
      panel('什么都没渲染出来', '脚本可能没跑起来：看看控制台，或者确认 /js/main.js 能正常加载。');
    }
  }, 4000);
})();
