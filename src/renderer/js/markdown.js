'use strict';

(function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    out = out.replace(/__([^_]+)__/g, '<b>$1</b>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<i>$2</i>');
    out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    return out;
  }

  function render(md) {
    const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    const container = document.createElement('div');
    container.className = 'readme-body';
    let para = [];
    const flushPara = () => {
      if (para.length) {
        const p = document.createElement('p');
        p.innerHTML = inline(para.join(' '));
        container.appendChild(p);
        para = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fence = line.match(/^```(.*)$/) || line.match(/^~~~(.*)$/);
      if (fence) {
        flushPara();
        const lang = fence[1].trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```|^~~~/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        const pre = document.createElement('pre');
        pre.className = 'readme-code';
        if (lang) pre.dataset.lang = lang;
        const code = document.createElement('code');
        code.textContent = buf.join('\n');
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) { flushPara(); continue; }

      const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara();
        const hd = document.createElement('h' + h[1].length);
        hd.innerHTML = inline(h[2]);
        container.appendChild(hd);
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
        flushPara();
        container.appendChild(document.createElement('hr'));
        continue;
      }

      if (trimmed.startsWith('>')) {
        flushPara();
        const q = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          q.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        i--;
        const bq = document.createElement('blockquote');
        const p = document.createElement('p');
        p.innerHTML = inline(q.join(' '));
        bq.appendChild(p);
        container.appendChild(bq);
        continue;
      }

      const ordered = /^\s*\d+[.)] /.test(trimmed);
      if (/^\s*[-*+] /.test(trimmed) || ordered) {
        flushPara();
        const list = document.createElement(ordered ? 'ol' : 'ul');
        while (i < lines.length) {
          const t = lines[i].trim();
          const um = t.match(/^\s*[-*+] (.*)$/);
          const om = t.match(/^\s*\d+[.)] (.*)$/);
          if (um || om) {
            const li = document.createElement('li');
            const task = (um ? um[0] : om[0]).match(/\[([ xX])\]/);
            if (task) {
              li.innerHTML =
                '<input type="checkbox" disabled' + (task[1] === 'x' || task[1] === 'X' ? ' checked' : '') + '> ' +
                inline((um || om)[1].replace(/^\s*\[[ xX]\]\s*/, ''));
            } else {
              li.innerHTML = inline((um || om)[1]);
            }
            list.appendChild(li);
            i++;
          } else {
            break;
          }
        }
        i--;
        container.appendChild(list);
        continue;
      }

      if (/^\|/.test(trimmed) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
        flushPara();
        const table = document.createElement('table');
        const parseRow = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const thead = document.createElement('tr');
        for (const c of parseRow(trimmed)) {
          const th = document.createElement('th');
          th.innerHTML = inline(c);
          thead.appendChild(th);
        }
        table.appendChild(thead);
        i += 2;
        while (i < lines.length && /^\|/.test(lines[i].trim())) {
          const tr = document.createElement('tr');
          for (const c of parseRow(lines[i].trim())) {
            const td = document.createElement('td');
            td.innerHTML = inline(c);
            tr.appendChild(td);
          }
          table.appendChild(tr);
          i++;
        }
        i--;
        container.appendChild(table);
        continue;
      }

      para.push(trimmed);
    }
    flushPara();
    return container;
  }

  window.MarkdownView = { render, inline };
})();
