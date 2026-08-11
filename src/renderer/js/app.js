'use strict';

(function () {
  const { $, el, toast, modal, relativeTime, formatDate, disable } = window.UI;
  const api = window.gitAPI;

  const state = {
    repos: [],
    currentRepo: null,
    commits: [],
    currentHead: null,
    fullStatus: null,
    selectedFile: null,
  };

  const refs = {
    repoList: $('#repoList'),
    branchList: $('#branchList'),
    statusList: $('#statusList'),
    graphCanvas: $('#graphCanvas'),
    inspectorBody: $('#inspectorBody'),
    emptyState: $('#emptyState'),
    chipRepoPath: $('#chipRepoPath'),
    chipBranch: $('#chipBranch'),
    graphStats: $('#graphStats'),
    statusStats: $('#statusStats'),
    footPath: $('#footPath'),
    footStats: $('#footStats'),
    statusLeds: $('#statusLeds'),
    bootVeil: $('#bootVeil'),
  };

  let graph = null;

  /* ---------------- persistence ---------------- */
  function saveRepos() {
    try {
      localStorage.setItem('neon.repos', JSON.stringify(state.repos.map((r) => r.path)));
    } catch { /* ignore */ }
  }

  async function restoreRepos() {
    let paths = [];
    try {
      paths = JSON.parse(localStorage.getItem('neon.repos') || '[]');
    } catch { paths = []; }
    for (const p of paths) {
      try {
        if (await api.isRepo(p)) {
          state.repos.push({ path: p, name: p.split(/[\\/]/).pop(), parent: '' });
        }
      } catch { /* skip */ }
    }
    renderRepoList();
    if (state.repos.length) await openRepo(state.repos[0].path);
  }

  /* ---------------- repo list ---------------- */
  function renderRepoList() {
    refs.repoList.innerHTML = '';
    for (const r of state.repos) {
      const item = el('li', 'repo-item');
      item.innerHTML =
        '<div class="repo-name"></div><div class="repo-path"></div>';
      item.querySelector('.repo-name').textContent = r.name;
      item.querySelector('.repo-path').textContent = r.path;
      if (state.currentRepo && state.currentRepo.path === r.path) {
        item.classList.add('is-active');
      }
      item.addEventListener('click', () => openRepo(r.path));
      refs.repoList.appendChild(item);
    }
    if (!state.repos.length) {
      const empty = el('li', 'repo-item');
      empty.style.color = 'var(--text-faint)';
      empty.style.fontFamily = 'var(--mono)';
      empty.style.fontSize = '11px';
      empty.textContent = '// no repositories';
      refs.repoList.appendChild(empty);
    }
  }

  function addRepo(r) {
    if (!state.repos.some((x) => x.path === r.path)) {
      state.repos.push(r);
      saveRepos();
      renderRepoList();
    }
  }

  async function scanFolder() {
    const dir = await api.pickFolder();
    if (!dir) return;
    toast('SCANNING // ' + dir, 'ok');
    try {
      const found = await api.scan(dir, 3);
      if (!found.length) {
        toast('NO REPOSITORIES FOUND IN ' + dir, 'err');
        return;
      }
      for (const r of found) addRepo(r);
      toast('FOUND ' + found.length + ' REPOSITOR' + (found.length > 1 ? 'IES' : 'Y'));
      if (!state.currentRepo) await openRepo(found[0].path);
    } catch (err) {
      toast('SCAN FAILED: ' + err.message, 'err');
    }
  }

  async function addRepoDirect() {
    const dir = await api.pickRepo();
    if (!dir) return;
    try {
      if (!(await api.isRepo(dir))) {
        toast('NOT A GIT REPOSITORY', 'err');
        return;
      }
      const root = await api.repoRoot(dir);
      const name = root.split(/[\\/]/).pop();
      addRepo({ path: root, name, parent: '' });
      toast('LINKED ' + name, 'ok');
      if (!state.currentRepo) await openRepo(root);
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  /* ---------------- clone ---------------- */
  async function cloneFlow() {
    const result = await modal({
      title: 'CLONE REPOSITORY',
      hint: 'HTTPS or SSH URL. The repository name is auto-derived.',
      fields: [{ key: 'url', label: 'REMOTE URL', placeholder: 'https://github.com/user/repo.git' }],
      actions: { confirm: 'CLONE' },
    });
    if (!result) return;
    if (!/^([a-z]+:|\/\/)/.test(result.url)) {
      toast('INVALID URL FORMAT', 'err');
      return;
    }
    const dest = await api.pickCloneDest();
    if (!dest) return;
    const name = result.url.split('/').pop().replace(/\.git$/i, '') || 'repo';
    const target = dest.replace(/[\\/]+$/, '') + '\\' + name;

    toast('CLONING ' + name + ' ...', 'ok');
    try {
      await api.clone(result.url, target);
      const root = target;
      addRepo({ path: root, name, parent: dest });
      toast('CLONE COMPLETE // ' + name, 'ok');
      await openRepo(root);
    } catch (err) {
      toast('CLONE FAILED: ' + err.message, 'err');
    }
  }

  /* ---------------- open / refresh ---------------- */
  async function openRepo(path) {
    toast('LOADING // ' + path.split(/[\\/]/).pop());
    try {
      const meta = await api.repoMeta(path);
      state.currentRepo = meta;
      refs.emptyState.style.display = 'none';
      renderRepoList();
      updateHud();
      await loadAll();
      graph.setSelected(null);
    } catch (err) {
      refs.emptyState.style.display = 'flex';
      toast('OPEN FAILED: ' + err.message, 'err');
    }
  }

  async function loadAll() {
    if (!state.currentRepo) return;
    const repo = state.currentRepo.path;
    const [commits, branches, fullStatus, stats] = await Promise.all([
      api.log(repo, 400).catch(() => []),
      api.branches(repo).catch(() => ({ branches: [], current: null })),
      api.fullStatus(repo).catch(() => ({ branch: null, entries: [], counts: null })),
      api.stats(repo).catch(() => ({ commits: 0 })),
    ]);
    state.commits = commits;
    state.currentHead = (await api.repoMeta(repo).catch(() => ({ head: null }))).head;
    state.fullStatus = fullStatus;
    refs.footStats.textContent = 'commits: ' + (stats.commits ?? '-');

    graph.setData(commits, state.currentHead);
    renderBranches(branches);
    renderStatus(fullStatus);
    updateHud();
    refs.graphStats.textContent = commits.length + ' commits rendered';
  }

  async function refresh() {
    if (!state.currentRepo) return;
    toast('REFRESHING ...');
    try {
      const meta = await api.repoMeta(state.currentRepo.path);
      state.currentRepo = meta;
      await loadAll();
      toast('SYNC COMPLETE', 'ok');
    } catch (err) {
      toast('REFRESH FAILED: ' + err.message, 'err');
    }
  }

  function updateHud() {
    const r = state.currentRepo;
    refs.chipRepoPath.textContent = r ? r.path : 'none selected';
    refs.chipBranch.textContent = r && r.branch ? r.branch : '-';
    const leds = document.querySelectorAll('#statusLeds .led');
    leds.forEach((led) => {
      const k = led.dataset.k;
      const v = r && r.counts ? r.counts[k] || 0 : 0;
      led.textContent = v;
      led.classList.toggle('hot', v > 0);
    });
    refs.footPath.textContent = r ? r.path : 'await input';
  }

  /* ---------------- branches ---------------- */
  function renderBranches({ branches, current }) {
    refs.branchList.innerHTML = '';
    for (const b of branches) {
      const item = el('li', 'branch-item');
      item.textContent = b.name;
      if (b.isCurrent) {
        item.classList.add('is-current');
        item.textContent += ' \u25c6';
      }
      if (b.isRemote) item.classList.add('is-remote');

      if (!b.isCurrent && !b.isRemote) {
        const del = el('span', 'del', '\u00d7');
        del.title = 'Delete ' + b.name;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteBranchFlow(b.name);
        });
        item.appendChild(del);
      }

      item.addEventListener('click', async () => {
        if (b.isCurrent) return;
        if (b.isRemote) {
          toast('USE CHECKOUT TO TRACK ' + b.name, 'err');
          return;
        }
        try {
          await api.checkout(state.currentRepo.path, b.name);
          toast('CHECKED OUT ' + b.name, 'ok');
          await refresh();
        } catch (err) {
          toast('CHECKOUT FAILED: ' + err.message, 'err');
        }
      });
      refs.branchList.appendChild(item);
    }
    if (!branches.length) {
      const item = el('li', 'branch-item');
      item.textContent = '// no branches';
      refs.branchList.appendChild(item);
    }
  }

  async function createBranchFlow() {
    const result = await modal({
      title: 'CREATE BRANCH',
      hint: 'Creates and switches to a new branch.',
      fields: [
        {
          key: 'name',
          label: 'BRANCH NAME',
          placeholder: 'feature/neon-core',
          default: state.currentRepo && state.currentRepo.branch
            ? 'feature/' + state.currentRepo.branch : '',
        },
      ],
      actions: { confirm: 'CREATE' },
    });
    if (!result) return;
    if (!/^[a-zA-Z0-9._/-]+$/.test(result.name)) {
      toast('INVALID BRANCH NAME', 'err');
      return;
    }
    try {
      await api.createBranch(state.currentRepo.path, result.name);
      toast('BRANCH ' + result.name + ' ONLINE', 'ok');
      await refresh();
    } catch (err) {
      toast('CREATE FAILED: ' + err.message, 'err');
    }
  }

  async function deleteBranchFlow(name) {
    try {
      await api.deleteBranch(state.currentRepo.path, name);
      toast('DELETED ' + name, 'ok');
      await refresh();
    } catch (err) {
      toast('DELETE FAILED: ' + err.message, 'err');
    }
  }

  /* ---------------- status view ---------------- */
  function badgeFor(xy) {
    if (xy === '??') return 'U';
    const code = xy.trim();
    if (/^[ADU][ADU]$/.test(xy)) return 'U';
    return code[0] || 'M';
  }

  function zoneFor(xy) {
    if (xy === '??') return 'untracked';
    if (xy[0] !== ' ' && xy[0] !== '?') return 'staged';
    return 'unstaged';
  }

  function cleanPath(p) {
    return p.replace(/^"|"$/g, '').replace(/\\\\(.)/g, '$1');
  }

  function renderStatus(status) {
    const list = refs.statusList;
    list.innerHTML = '';
    if (!status || !status.entries.length) {
      const empty = el('div', 'status-empty', 'WORKING TREE CLEAN // ALL SYSTEMS NOMINAL');
      list.appendChild(empty);
      refs.statusStats.textContent = '0 changes';
      return;
    }
    const entries = status.entries.slice().sort((a, b) => {
      const zone = (z) => ({ staged: 0, unstaged: 1, untracked: 2 }[z]);
      return zone(zoneFor(a.xy)) - zone(zoneFor(b.xy)) ||
        cleanPath(a.file).localeCompare(cleanPath(b.file));
    });

    for (const e of entries) {
      const row = el('div', 'file-row');
      const file = cleanPath(e.file);
      const badge = el('span', 'file-badge badge-' + badgeFor(e.xy), badgeFor(e.xy));
      const name = el('span', 'file-name', file);
      const zone = el('span', 'file-zone zone-' + zoneFor(e.xy), zoneFor(e.xy).toUpperCase());
      row.append(badge, name, zone);
      row.addEventListener('click', () => showFileDiff(file, e.xy, row));
      list.appendChild(row);
    }
    const c = status.counts || {};
    refs.statusStats.textContent =
      c.staged + ' staged | ' + c.unstaged + ' modified | ' + c.untracked + ' untracked';
  }

  async function showFileDiff(file, xy, rowEl) {
    if (!state.currentRepo) return;
    document.querySelectorAll('.file-row.is-selected').forEach((n) => n.classList.remove('is-selected'));
    if (rowEl) rowEl.classList.add('is-selected');
    state.selectedFile = file;
    refs.inspectorBody.innerHTML = '';

    const zone = zoneFor(xy);
    const header = el('div', 'diff-file-head', zone.toUpperCase() + ' // ' + file);
    refs.inspectorBody.appendChild(header);

    let text = '';
    try {
      if (xy === '??') {
        text = await api.untrackedDiff(state.currentRepo.path, file);
      } else if (zone === 'staged') {
        text = await api.diffFile(state.currentRepo.path, file, 'staged');
      } else {
        text = await api.diffFile(state.currentRepo.path, file, 'worktree');
      }
    } catch (err) {
      toast('DIFF FAILED: ' + err.message, 'err');
    }
    if (!text) {
      const div = el('div', 'diff-empty', '// no textual diff (binary?)');
      refs.inspectorBody.appendChild(div);
      return;
    }
    refs.inspectorBody.appendChild(window.DiffView.renderDiff(text));
  }

  /* ---------------- inspector / commit diff ---------------- */
  async function showCommit(hash) {
    if (!state.currentRepo) return;
    refs.inspectorBody.innerHTML = '';
    try {
      const info = await api.commitInfo(state.currentRepo.path, hash);
      const patch = await api.commitPatch(state.currentRepo.path, hash, false).catch(() => '');
      const card = el('div', 'commit-card');
      card.innerHTML =
        '<div class="cc-hash">' + info.hash.slice(0, 12) + '</div>' +
        '<div class="cc-msg"></div>' +
        '<div class="cc-meta">' +
        '  <span><b>AUTHOR</b> ' + info.author + '</span>' +
        '  <span><b>DATE</b> ' + formatDate(info.date) + ' (' + relativeTime(info.date) + ')</span>' +
        '  <span><b>PARENTS</b> ' + (info.parents.length || 0) + '</span>' +
        '</div>' +
        '<div class="cc-stats"></div>';
      card.querySelector('.cc-msg').textContent = info.subject;
      const statsEl = card.querySelector('.cc-stats');
      const ins = (patch.match(/^\+/gm) || []).length;
      const del = (patch.match(/^-(?!-)/gm) || []).length;
      statsEl.innerHTML =
        '<span class="ins">+' + ins + '</span> &nbsp; <span class="del">-' + del + '</span>';
      refs.inspectorBody.appendChild(card);
      if (info.stat) {
        const statCard = el('div', 'diff-file');
        const statHead = el('div', 'diff-file-head', 'FILES CHANGED');
        const statBody = el('div', 'diff-empty', info.stat.trim());
        statCard.append(statHead, statBody);
        refs.inspectorBody.appendChild(statCard);
      }
      if (patch) {
        refs.inspectorBody.appendChild(window.DiffView.renderDiff(patch));
      } else {
        const div = el('div', 'diff-empty', '// empty commit');
        refs.inspectorBody.appendChild(div);
      }
    } catch (err) {
      toast('COMMIT LOAD FAILED: ' + err.message, 'err');
    }
  }

  /* ---------------- tabs ---------------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('is-active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) =>
      p.classList.toggle('is-active', p.id === 'panel-' + name));
  }

  /* ---------------- wiring ---------------- */
  function wire() {
    $('#btnScan').addEventListener('click', scanFolder);
    $('#btnEmptyScan').addEventListener('click', scanFolder);
    $('#btnClone').addEventListener('click', cloneFlow);
    $('#btnEmptyClone').addEventListener('click', cloneFlow);
    $('#btnRefresh').addEventListener('click', refresh);
    $('#btnAddRepo').addEventListener('click', addRepoDirect);
    $('#btnNewBranch').addEventListener('click', createBranchFlow);
    $('#btnCloseInspector').addEventListener('click', () => {
      refs.inspectorBody.innerHTML =
        '<div class="inspector-placeholder">Select a commit or file to inspect its diff.</div>';
    });

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => switchTab(t.dataset.tab)));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5') { e.preventDefault(); refresh(); }
      if (e.key === '1') switchTab('graph');
      if (e.key === '2') switchTab('status');
      if (e.key === 'Escape') {
        backdropClick();
        refs.inspectorBody.innerHTML =
          '<div class="inspector-placeholder">Select a commit or file to inspect its diff.</div>';
      }
    });

    graph = new window.GraphRenderer(refs.graphCanvas, {
      onSelect: ({ hash }) => showCommit(hash),
      onHover: ({ commit }) => {
        refs.footPath.textContent =
          commit.short + ' // ' + commit.author + ' // ' + commit.subject;
      },
    });
  }

  function backdropClick() {
    $('#modalBackdrop').hidden = true;
    $('#modalBox').innerHTML = '';
  }

  /* ---------------- init ---------------- */
  async function init() {
    wire();
    switchTab('graph');
    tick();
    await restoreRepos();
    await new Promise((resolve) => setTimeout(resolve, 600));
    refs.bootVeil.classList.add('is-hidden');
    setTimeout(() => {
      refs.bootVeil.style.display = 'none';
    }, 500);
    window.__neon = { openRepo, refresh, state, appReady };
  }

  function appReady() {
    return new Promise((resolve) => {
      const check = () => {
        const canvas = refs.graphCanvas;
        const ready = canvas && canvas.clientWidth > 0 && refs.graphStats.textContent.trim() !== '';
        if (ready) return resolve();
        setTimeout(check, 50);
      };
      check();
    });
  }

  function tick() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('#footClock').textContent =
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    setTimeout(tick, 1000);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
