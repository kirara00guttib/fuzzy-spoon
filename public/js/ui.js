// 零碎的小工具：提示、弹窗、日期格式化
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function toast(message, kind = 'ok') {
  const host = $('#toasts');
  if (!host) return;
  const node = el(`<div class="toast toast-${kind}"><span>${esc(message)}</span></div>`);
  host.append(node);
  setTimeout(() => node.classList.add('is-out'), 2600);
  setTimeout(() => node.remove(), 3100);
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(value, { withWeekday = false, withTime = false } = {}) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const base = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const time = withTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  return withWeekday ? `${base} ${week}${time}` : `${base}${time}`;
}

export function shortDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function relativeTime(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.round(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(value);
}

export function toLocalInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

/** 统一的弹窗：返回 Promise，提交成功才关闭 */
export function openModal({ title, body, submitText = '保存', cancelText = '算了', onSubmit, wide = false, hideSubmit = false }) {
  const dialog = $('#modal');
  return new Promise((resolve) => {
    dialog.className = `modal${wide ? ' modal-wide' : ''}`;
    dialog.innerHTML = `
      <form class="modal-form" novalidate>
        <header class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="btn btn-icon btn-quiet" data-close aria-label="关闭">${icon('close', { size: 14 })}</button>
        </header>
        <div class="modal-body">${body}</div>
        <p class="modal-error" role="alert" hidden></p>
        <footer class="modal-foot">
          <button type="button" class="btn btn-quiet" data-close>${esc(cancelText)}</button>
          ${hideSubmit ? '' : `<button type="submit" class="btn btn-primary">${esc(submitText)}</button>`}
        </footer>
      </form>`;

    const form = dialog.querySelector('form');
    const errorBox = dialog.querySelector('.modal-error');
    let closed = false;
    const finish = (value) => {
      if (closed) return;
      closed = true;
      dialog.close();
      resolve(value);
    };

    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => finish(null)));
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      errorBox.hidden = true;
      try {
        const value = onSubmit ? await onSubmit(form, dialog) : true;
        if (value !== false) finish(value ?? true);
      } catch (err) {
        errorBox.textContent = err.message || '出错了';
        errorBox.hidden = false;
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
    dialog.showModal();
    const first = dialog.querySelector('textarea, input:not([type=hidden]), select, button[type="submit"]');
    if (first) setTimeout(() => first.focus(), 40);
    if (!onSubmit) {
      form.addEventListener('submit', () => finish(true));
    }
  });
}

export function confirmBox(title, text, dangerLabel = '删掉') {
  return openModal({
    title,
    body: `<p class="modal-text">${esc(text)}</p>`,
    submitText: dangerLabel,
    onSubmit: () => true,
  }).then((v) => Boolean(v));
}

export function emptyState({ title, text, action = '' }) {
  return `<div class="empty">
    <div class="empty-art" aria-hidden="true">${icon('leaf', { size: 28 })}</div>
    <p class="empty-title">${esc(title)}</p>
    <p class="empty-text">${esc(text)}</p>
    ${action}
  </div>`;
}

/** 每个房间的页头：一个 h1，一句说明，右边是真的能点的操作 */
export function viewHead({ title, sub = '', actions = '' }) {
  return `<header class="view-head">
    <div>
      <h1>${esc(title)}</h1>
      ${sub ? `<p class="view-sub">${sub}</p>` : ''}
    </div>
    ${actions ? `<div class="view-actions">${actions}</div>` : ''}
  </header>`;
}
