'use strict';

(function () {
  const $ = (sel) => document.querySelector(sel);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const toastStack = $('#toastStack');

  function toast(message, kind) {
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''), message);
    toastStack.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 320);
    }, 3200);
  }

  const backdrop = $('#modalBackdrop');
  const modalBox = $('#modalBox');

  function modal({ title, fields, actions, hint }) {
    return new Promise((resolve) => {
      modalBox.innerHTML = '';
      const h = el('h3', '', title);
      modalBox.appendChild(h);

      const values = {};
      for (const f of fields) {
        modalBox.appendChild(el('label', '', f.label));
        const input = el('input');
        input.type = f.type || 'text';
        input.placeholder = f.placeholder || '';
        if (f.default) input.value = f.default;
        if (f.select) {
          const sel = el('select');
          for (const opt of f.select) {
            const o = el('option', '', opt);
            sel.appendChild(o);
          }
          sel.value = f.default || '';
          modalBox.appendChild(sel);
          values[f.key] = sel;
        } else {
          modalBox.appendChild(input);
          values[f.key] = input;
        }
      }

      if (hint) {
        const hintEl = el('div', 'modal-hint', hint);
        modalBox.appendChild(hintEl);
      }

      const actionsRow = el('div', 'modal-actions');
      const cancelBtn = el('button', 'btn btn-ghost', 'CANCEL');
      cancelBtn.addEventListener('click', () => closeModal(resolve, null));
      actionsRow.appendChild(cancelBtn);

      const okBtn = el('button', 'btn btn-primary', actions.confirm || 'CONFIRM');
      okBtn.addEventListener('click', () => {
        const result = {};
        for (const f of fields) {
          result[f.key] = values[f.key].value.trim();
        }
        if (fields.every((f) => !f.optional && !result[f.key])) {
          toast('ALL FIELDS REQUIRED', 'err');
          return;
        }
        closeModal(resolve, result);
      });
      actionsRow.appendChild(okBtn);

      modalBox.appendChild(actionsRow);
      backdrop.hidden = false;

      const first = modalBox.querySelector('input');
      if (first) setTimeout(() => first.focus(), 50);
    });
  }

  function closeModal(resolve, value) {
    backdrop.hidden = true;
    modalBox.innerHTML = '';
    resolve(value);
  }

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.hidden = true;
      modalBox.innerHTML = '';
    }
  });

  function relativeTime(iso) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso || '';
    const diff = Date.now() - date.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + 'd ago';
    const mo = Math.floor(day / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || '';
    const pad = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  }

  function tickClock() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const clock = $('#footClock');
    if (clock) clock.textContent =
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
  }
  setInterval(tickClock, 1000);

  function disable(el, on) {
    el.disabled = on;
    el.style.opacity = on ? '0.5' : '';
  }

  window.UI = { $, el, toast, modal, relativeTime, formatDate, disable };
})();
