'use strict';

(function () {
  const { $, el, toast, modal, relativeTime, formatDate, disable } = window.UI;
  const api = window.gitAPI;

  const state = {
    repos: [],
    workspaces: [],
    currentRepo: null,
    commits: [],
    currentHead: null,
    fullStatus: null,
    selectedFile: null,
    treeRoots: [],
    fileMode: 'view',
    fileJob: 0,
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
    fileTree: $('#fileTree'),
    fileStats: $('#fileStats'),
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
      localStorage.setItem(
        'neon.workspaces',
        JSON.stringify(
          state.workspaces.map((w) => ({
            root: w.root,
            expanded: w.expanded,
            folders: w.folders,
          }))
        )
      );
    } catch { /* ignore */ }
  }

  async function validRepoPaths(paths, concurrency = 12) {
    const out = [];
    for (let i = 0; i < paths.length; i += concurrency) {
      const chunk = paths.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async (p) => {
          try {
            return (await api.isRepo(p)) ? p : null;
          } catch {
            return null;
          }
        })
      );
      for (const r of results) if (r) out.push(r);
    }
    return out;
  }

  async function restoreRepos() {
    let paths = [];
    try {
      paths = JSON.parse(localStorage.getItem('neon.repos') || '[]');
    } catch { paths = []; }
    for (const p of await validRepoPaths(paths)) {
      state.repos.push({ path: p, name: p.split(/[\\/]/).pop(), parent: '' });
    }
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem('neon.workspaces') || '[]');
    } catch { saved = []; }
    for (const w of saved) {
      const folders = {};
      let any = false;
      for (const [key, entry] of Object.entries(w.folders || {})) {
        if (!entry) continue;
        const repos = await validRepoPaths(
          Array.isArray(entry.repos) ? entry.repos : []
        );
        folders[key] = {
          loaded: true,
          open: entry.open !== false,
          repos,
          dirs: Array.isArray(entry.dirs) ? entry.dirs : [],
        };
        if (repos.length) any = true;
      }
      if (any) {
        state.workspaces.push({
          root: w.root,
          expanded: w.expanded !== false,
          folders,
        });
      }
    }
    renderRepoList();
    const first = await firstAvailableRepo();
    if (first) await openRepo(first.path);
  }

  async function firstAvailableRepo() {
    if (state.repos.length) return state.repos[0];
    for (const w of state.workspaces) {
      for (const entry of Object.values(w.folders)) {
        const p = entry.repos[0];
        if (p) {
          try {
            if (await api.isRepo(p)) {
              return { path: p, name: p.split(/[\\/]/).pop(), parent: '' };
            }
          } catch { /* skip */ }
        }
      }
    }
    return null;
  }

  function countKnownRepos(ws) {
    let n = 0;
    for (const entry of Object.values(ws.folders)) n += entry.repos.length;
    return n;
  }

  function firstRepoPath(ws) {
    for (const entry of Object.values(ws.folders)) {
      if (entry.repos.length) return entry.repos[0];
    }
    return null;
  }

  /* ---------------- repo list ---------------- */
  function wsJoin(base, name) {
    return base.replace(/[\\/]+$/, '') + '\\' + name;
  }

  function buildWsTree(ws) {
    const build = (key, path) => {
      const entry = ws.folders[key];
      const children = new Map();
      if (entry) {
        for (const rp of entry.repos || []) {
          const name = rp.split(/[\\/]/).pop();
          children.set(name + '\u0000' + rp, {
            kind: 'repo',
            name,
            key: key ? key + '/' + name : name,
            path: rp,
          });
        }
        for (const d of entry.dirs || []) {
          const ck = key ? key + '/' + d : d;
          children.set(ck, build(ck, wsJoin(path, d)));
        }
      }
      return { kind: 'dir', name: key ? key.split('/').pop() : '', key, path, entry, children };
    };
    return build('', ws.root);
  }

  async function loadWsFolder(ws, node) {
    if (ws.folders[node.key]) return;
    ws._loading = ws._loading || {};
    ws._loading[node.key] = true;
    renderRepoList();
    try {
      const level = await api.scanLevel(node.path);
      ws.folders[node.key] = {
        loaded: true,
        open: true,
        repos: level.repos.map((r) => r.path),
        dirs: level.dirs,
      };
    } catch {
      ws.folders[node.key] = { loaded: true, open: true, repos: [], dirs: [] };
    }
    delete ws._loading[node.key];
    saveRepos();
    renderRepoList();
  }

  function renderWsChildren(list, ws, children, depth) {
    const dirs = [];
    const repos = [];
    for (const node of children.values()) {
      if (node.kind === 'dir') dirs.push(node);
      else repos.push(node);
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    repos.sort((a, b) => a.name.localeCompare(b.name));

    for (const d of dirs) {
      const loading = !!(ws._loading && ws._loading[d.key]);
      const entry = d.entry;
      const open = entry ? entry.open !== false : false;
      const row = el('li', 'ws-folder' + (loading ? ' loading' : ''));
      row.style.paddingLeft = 10 + depth * 14 + 'px';
      row.innerHTML =
        '<span class="ws-arrow"></span><span class="ws-folder-name"></span>' +
        '<span class="ws-folder-count"></span>';
      row.querySelector('.ws-arrow').textContent = loading
        ? '\u25CC'
        : open
          ? '\u25BE'
          : '\u25B8';
      row.querySelector('.ws-folder-name').textContent = d.name;
      row.querySelector('.ws-folder-count').textContent = entry
        ? entry.repos.length
        : '\u2026';
      row.addEventListener('click', () => {
        if (loading) return;
        if (!entry) {
          loadWsFolder(ws, d);
          return;
        }
        entry.open = !open;
        saveRepos();
        renderRepoList();
      });
      list.appendChild(row);
      if (entry && open) renderWsChildren(list, ws, d.children, depth + 1);
    }
    for (const r of repos) appendRepoItem(list, r.name, r.path, depth);
  }

  function appendRepoItem(list, name, repoPath, depth) {
    const item = el('li', 'repo-item');
    if (depth > 0) item.classList.add('repo-item-nested');
    item.style.paddingLeft = 10 + depth * 14 + 'px';
    item.innerHTML =
      '<div class="repo-name"></div><div class="repo-path"></div>';
    item.querySelector('.repo-name').textContent = name;
    item.querySelector('.repo-path').textContent = repoPath;
    if (state.currentRepo && state.currentRepo.path === repoPath) {
      item.classList.add('is-active');
    }
    item.addEventListener('click', () => openRepo(repoPath));
    list.appendChild(item);
  }

  function renderRepoList() {
    refs.repoList.innerHTML = '';
    for (const r of state.repos) appendRepoItem(refs.repoList, r.name, r.path, 0);
    for (const w of state.workspaces) {
      const head = el('li', 'repo-group');
      head.innerHTML =
        '<span class="repo-group-arrow"></span>' +
        '<span class="repo-group-name"></span>' +
        '<span class="repo-group-count"></span>';
      head.querySelector('.repo-group-arrow').textContent = w.expanded ? '\u25BE' : '\u25B8';
      head.querySelector('.repo-group-name').textContent = w.root;
      head.querySelector('.repo-group-count').textContent = countKnownRepos(w);
      head.addEventListener('click', () => {
        w.expanded = !w.expanded;
        saveRepos();
        renderRepoList();
      });
      refs.repoList.appendChild(head);
      if (w.expanded) renderWsChildren(refs.repoList, w, buildWsTree(w).children, 1);
    }
    if (!state.repos.length && !state.workspaces.length) {
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

  async function scanWorkspace(dir) {
    toast('SCANNING // ' + dir, 'ok');
    try {
      const level = await api.scanLevel(dir);
      const makeEntry = () => ({
        loaded: true,
        open: true,
        repos: level.repos.map((r) => r.path),
        dirs: level.dirs,
      });
      const ws = state.workspaces.find((w) => w.root === dir);
      if (ws) {
        ws.folders = { '': makeEntry() };
        ws.expanded = true;
      } else {
        state.workspaces.push({ root: dir, expanded: true, folders: { '': makeEntry() } });
      }
      saveRepos();
      renderRepoList();
      const total = level.repos.length;
      toast(
        total
          ? 'FOUND ' + total + ' REPOSITOR' + (total > 1 ? 'IES' : 'Y') + ' // EXPAND FOLDERS FOR MORE'
          : 'NO REPOS AT TOP LEVEL // EXPAND FOLDERS'
      );
      if (!state.currentRepo && level.repos.length) {
        await openRepo(level.repos[0].path);
      }
      return level.repos;
    } catch (err) {
      toast('SCAN FAILED: ' + err.message, 'err');
    }
  }

  async function scanFolder() {
    const dir = await api.pickFolder();
    if (!dir) return;
    await scanWorkspace(dir);
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
      await loadReadme();
    } catch (err) {
      refs.emptyState.style.display = 'flex';
      toast('OPEN FAILED: ' + err.message, 'err');
      try {
        if (!(await api.isRepo(path))) pruneRepoPath(path);
      } catch { /* ignore */ }
    }
  }

  function pruneRepoPath(repoPath) {
    state.repos = state.repos.filter((r) => r.path !== repoPath);
    for (const ws of state.workspaces) {
      for (const entry of Object.values(ws.folders)) {
        entry.repos = entry.repos.filter((p) => p !== repoPath);
      }
    }
    saveRepos();
    renderRepoList();
  }

  async function loadReadme() {
    if (!state.currentRepo) return;
    refs.inspectorBody.innerHTML = '';
    try {
      const readme = await api.readme(state.currentRepo.path);
      if (!readme) {
        showInspectorPlaceholder();
        return;
      }
      const card = el('div', 'readme-card');
      const head = el('div', 'readme-head');
      const fname = el('span', 'readme-fname', readme.path);
      head.appendChild(document.createTextNode('README  '));
      head.appendChild(fname);
      const body = window.MarkdownView.render(readme.content);
      card.append(head, body);
      refs.inspectorBody.appendChild(card);
    } catch (err) {
      showInspectorPlaceholder();
    }
  }

  function showInspectorPlaceholder() {
    refs.inspectorBody.innerHTML = '';
    const div = el(
      'div',
      'inspector-placeholder',
      'Select a commit or file to inspect its diff.'
    );
    refs.inspectorBody.appendChild(div);
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
    const treeRes = await api.tree(repo).catch(() => ({ files: [] }));
    state.treeRoots = buildTree(treeRes.files || [], fullStatus);
    renderFileTree();
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

  /* ---------------- file tree ---------------- */
  function buildTree(files, status) {
    const roots = [];
    const rootMap = new Map();
    const ensureDir = (map, arr, name, fullPath, untracked) => {
      let n = map.get(name);
      if (!n) {
        n = { name, path: fullPath, dir: true, expanded: false, untracked, children: [], childMap: new Map() };
        map.set(name, n);
        arr.push(n);
      } else if (untracked && !n.untracked) {
        n.untracked = true;
      }
      return n;
    };
    const addFile = (file, untracked) => {
      const parts = file.split('/');
      let map = rootMap;
      let arr = roots;
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        const part = parts[i];
        if (last) {
          let n = map.get(part);
          if (!n) {
            n = { name: part, path: file, dir: false, expanded: false, untracked, children: [], childMap: new Map() };
            map.set(part, n);
            arr.push(n);
          }
        } else {
          const d = ensureDir(map, arr, part, parts.slice(0, i + 1).join('/'), untracked);
          map = d.childMap;
          arr = d.children;
        }
      }
    };
    for (const f of files) addFile(f, false);
    const untracked = (status && status.entries || [])
      .filter((e) => e.xy === '??')
      .map((e) => cleanPath(e.file));
    for (const f of untracked) addFile(f, true);
    const sortLevel = (arr) => {
      arr.sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of arr) if (n.dir) sortLevel(n.children);
    };
    sortLevel(roots);
    return roots;
  }

  function renderFileTree() {
    refs.fileTree.innerHTML = '';
    const roots = state.treeRoots;
    if (!roots.length) {
      refs.fileTree.innerHTML = '<div class="status-empty">NO FILES AT HEAD</div>';
      refs.fileStats.textContent = '0 files';
      return;
    }
    const count = countFiles(roots);
    refs.fileStats.textContent = count + ' file' + (count === 1 ? '' : 's') + ' @ HEAD';
    for (const node of roots) refs.fileTree.appendChild(renderTreeNode(node, 0));
  }

  function countFiles(nodes) {
    let n = 0;
    for (const node of nodes) n += node.dir ? countFiles(node.children) : 1;
    return n;
  }

  function renderTreeNode(node, depth) {
    const wrap = el('div', 'tree-branch');
    const row = el(
      'div',
      'tree-row ' + (node.dir ? 'tree-dir' : 'tree-file') + (node.untracked ? ' is-untracked' : '')
    );
    row.style.paddingLeft = 6 + depth * 14 + 'px';
    const arrow = el('span', 'tree-arrow', node.dir ? (node.expanded ? '\u25be' : '\u25b8') : '');
    const icon = el('span', 'tree-icon', node.dir ? '\u25a3' : '\u25a1');
    const name = el('span', 'tree-name', node.name);
    if (node.untracked && !node.dir) {
      const tag = el('span', 'tree-tag', 'U');
      tag.title = 'untracked';
      row.append(arrow, icon, name, tag);
    } else {
      row.append(arrow, icon, name);
    }
    wrap.appendChild(row);
    if (node.dir) {
      row.addEventListener('click', () => {
        node.expanded = !node.expanded;
        renderFileTree();
      });
      if (node.expanded) {
        const kids = el('div', 'tree-children');
        for (const c of node.children) kids.appendChild(renderTreeNode(c, depth + 1));
        wrap.appendChild(kids);
      }
    } else {
      row.addEventListener('click', () => {
        document.querySelectorAll('.tree-file.is-selected').forEach((n) => n.classList.remove('is-selected'));
        row.classList.add('is-selected');
        showFileInInspector(node.path);
      });
    }
    return wrap;
  }

  async function showFileInInspector(file) {
    if (!state.currentRepo) return;
    state.selectedFile = file;
    state.fileMode = 'view';
    const job = ++state.fileJob;
    refs.inspectorBody.innerHTML = '';
    const toolbar = el('div', 'file-toolbar');
    const title = el('span', 'file-toolbar-title', file);
    const btnView = el('button', 'btn btn-ghost fmode', 'VIEW');
    const btnDiff = el('button', 'btn btn-ghost fmode', 'DIFF');
    const setActive = () => {
      btnView.classList.toggle('is-active', state.fileMode === 'view');
      btnDiff.classList.toggle('is-active', state.fileMode === 'diff');
    };
    btnView.addEventListener('click', () => {
      state.fileMode = 'view';
      setActive();
      loadFilePane(file, job);
    });
    btnDiff.addEventListener('click', () => {
      state.fileMode = 'diff';
      setActive();
      loadFilePane(file, job);
    });
    toolbar.append(title, btnView, btnDiff);
    refs.inspectorBody.appendChild(toolbar);
    setActive();
    await loadFilePane(file, job);
  }

  async function loadFilePane(file, job) {
    if (job !== state.fileJob) return;
    refs.inspectorBody.querySelector('.file-content')?.remove();
    const holder = el('div', 'file-content');
    refs.inspectorBody.appendChild(holder);
    holder.textContent = 'LOADING // ' + file;
    try {
      let text;
      let render;
      if (state.fileMode === 'diff') {
        text = await api.diffHead(state.currentRepo.path, file);
        render = () => {
          if (!text || !text.trim()) {
            holder.textContent = '// no changes vs HEAD';
            return;
          }
          holder.appendChild(window.DiffView.renderDiff(text));
        };
      } else {
        const res = await api.fileContent(state.currentRepo.path, file);
        render = () => {
          if (res.binary) {
            holder.textContent = '// binary file -- content not shown';
            return;
          }
          const pre = el('pre', 'file-view');
          pre.textContent = res.content.length > 200000
            ? res.content.slice(0, 200000) + '\n// ... output truncated'
            : res.content;
          holder.appendChild(pre);
        };
      }
      if (job !== state.fileJob) return;
      holder.textContent = '';
      render();
    } catch (err) {
      if (job === state.fileJob) holder.textContent = 'LOAD FAILED: ' + err.message;
    }
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
    $('#btnCloseInspector').addEventListener('click', showInspectorPlaceholder);

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => switchTab(t.dataset.tab)));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5') { e.preventDefault(); refresh(); }
      if (e.key === '1') switchTab('graph');
      if (e.key === '2') switchTab('status');
      if (e.key === '3') switchTab('files');
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
    window.__neon = { openRepo, refresh, state, appReady, scanWorkspace };
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
