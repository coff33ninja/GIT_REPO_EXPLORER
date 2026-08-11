'use strict';

(function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function parseDiff(text) {
    const files = [];
    let current = null;
    const lines = text.split('\n');

    const startFile = (i) => {
      if (current) files.push(current);
      current = { header: [], hunks: [], name: '' };
      const m = lines[i].match(/^diff --git a\/(.*?) b\/(.*)$/);
      if (m) current.name = m[2] === '/dev/null' ? m[1] : m[2];
      current.header = [lines[i]];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git')) {
        startFile(i);
        continue;
      }
      if (!current) continue;
      if (line.startsWith('@@ ')) {
        const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
        current.hunks.push({
          oldStart: m ? parseInt(m[1], 10) : 1,
          oldCount: m && m[2] ? parseInt(m[2], 10) : m ? 1 : 0,
          newStart: m ? parseInt(m[3], 10) : 1,
          newCount: m && m[4] ? parseInt(m[4], 10) : m ? 1 : 0,
          tail: m ? m[5] : '',
          rows: [],
        });
        continue;
      }
      const hunk = current.hunks[current.hunks.length - 1];
      if (hunk) hunk.rows.push(line);
      else current.header.push(line);
    }
    if (current) files.push(current);
    return files;
  }

  function renderDiffTable(file) {
    const table = document.createElement('table');
    table.className = 'diff-grid';
    const thead = document.createElement('tr');
    thead.innerHTML = '<th>OLD</th><th></th><th>NEW</th><th></th>';
    table.appendChild(thead);

    for (const hunk of file.hunks) {
      const rows = hunk.rows;
      let oi = hunk.oldStart;
      let ni = hunk.newStart;
      const hunkRow = document.createElement('tr');
      hunkRow.innerHTML =
        '<td class="hunk" colspan="2">@@ -' + hunk.oldStart + ',' + hunk.oldCount +
        ' +' + hunk.newStart + ',' + hunk.newCount + ' @@' + escapeHtml(hunk.tail) + '</td>' +
        '<td class="hunk" colspan="2"></td>';
      table.appendChild(hunkRow);

      for (const row of rows) {
        const tr = document.createElement('tr');
        if (row.startsWith('+')) {
          tr.innerHTML =
            '<td class="ln"></td><td class="del-blank"></td>' +
            '<td class="ln">' + ni + '</td><td class="add">' + escapeHtml(row.slice(1)) + '</td>';
          ni++;
        } else if (row.startsWith('-')) {
          tr.innerHTML =
            '<td class="ln">' + oi + '</td><td class="del">' + escapeHtml(row.slice(1)) + '</td>' +
            '<td class="ln"></td><td class="cx-blank"></td>';
          oi++;
        } else if (row === '\\ No newline at end of file') {
          tr.innerHTML = '<td class="cx" colspan="4">\\ No newline at end of file</td>';
        } else {
          const content = escapeHtml(row.startsWith(' ') ? row.slice(1) : row);
          tr.innerHTML =
            '<td class="ln">' + oi + '</td><td class="cx">' + content + '</td>' +
            '<td class="ln">' + ni + '</td><td class="cx">' + content + '</td>';
          oi++;
          ni++;
        }
        table.appendChild(tr);
      }
    }
    return table;
  }

  function renderDiff(text) {
    const container = document.createElement('div');
    if (!text || !text.trim()) {
      const div = document.createElement('div');
      div.className = 'diff-empty';
      div.textContent = '// no changes in this range';
      container.appendChild(div);
      return container;
    }
    const files = parseDiff(text);
    for (const file of files) {
      const wrap = document.createElement('div');
      wrap.className = 'diff-file';
      const head = document.createElement('div');
      head.className = 'diff-file-head';
      head.textContent = file.name || '// unnamed file';
      wrap.appendChild(head);
      if (file.hunks.length) wrap.appendChild(renderDiffTable(file));
      else {
        const div = document.createElement('div');
        div.className = 'diff-empty';
        div.textContent = '// binary or metadata-only change';
        wrap.appendChild(div);
      }
      container.appendChild(wrap);
    }
    return container;
  }

  window.DiffView = { renderDiff, parseDiff };
})();
