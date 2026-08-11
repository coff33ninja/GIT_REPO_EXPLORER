'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).then((res) => {
    if (res && res.ok === false) throw new Error(res.error || `${channel} failed`);
    return res && res.ok ? res.data : res;
  });

const api = {
  scan: (dir, depth) => invoke('git:scan', dir, depth),
  isRepo: (dir) => invoke('git:is-repo', dir),
  repoRoot: (dir) => invoke('git:repo-root', dir),
  repoMeta: (repo) => invoke('git:repo-meta', repo),
  status: (repo) => invoke('git:status', repo),
  fullStatus: (repo) => invoke('git:full-status', repo),
  untrackedDiff: (repo, file) => invoke('git:untracked-diff', repo, file),
  log: (repo, count) => invoke('git:log', repo, count),
  branches: (repo) => invoke('git:branches', repo),
  diffFile: (repo, file, mode) => invoke('git:diff-file', repo, file, mode),
  diffHead: (repo, file) => invoke('git:diff-head', repo, file),
  commitInfo: (repo, hash) => invoke('git:commit-info', repo, hash),
  commitPatch: (repo, hash, stat) => invoke('git:commit-patch', repo, hash, stat),
  checkout: (repo, ref) => invoke('git:checkout', repo, ref),
  createBranch: (repo, name, from) => invoke('git:branch-create', repo, name, from),
  deleteBranch: (repo, name) => invoke('git:branch-delete', repo, name),
  clone: (url, dest) => invoke('git:clone', url, dest),
  stats: (repo) => invoke('git:stats', repo),

  pickFolder: () => invoke('dialog:pick-folder'),
  pickRepo: () => invoke('dialog:pick-repo'),
  pickCloneDest: () => invoke('dialog:clone-destination'),

  onCloneProgress: (cb) =>
    ipcRenderer.on('git:clone-progress', (_event, payload) => cb(payload)),
};

contextBridge.exposeInMainWorld('gitAPI', api);
