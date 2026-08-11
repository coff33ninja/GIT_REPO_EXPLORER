'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const git = require('./git');

const GIT_HANDLERS = {
  'git:is-repo': (_, dir) => git.isRepo(dir),
  'git:repo-root': (_, dir) => git.repoRoot(dir),
  'git:scan': (_, dir, depth) => git.scanForRepos(dir, depth),
  'git:repo-meta': (_, repo) => git.getRepoMeta(repo),
  'git:status': (_, repo) => git.getStatusCounts(repo),
  'git:full-status': (_, repo) => git.getFullStatus(repo),
  'git:untracked-diff': (_, repo, file) => git.getUntrackedDiff(repo, file),
  'git:log': (_, repo, count) => git.getLog(repo, count),
  'git:branches': (_, repo) => git.getBranches(repo),
  'git:diff-file': (_, repo, file, mode) => git.getDiffForFile(repo, file, mode),
  'git:diff-head': (_, repo, file) => git.getDiffVsHead(repo, file),
  'git:commit-info': (_, repo, hash) => git.getCommitInfo(repo, hash),
  'git:commit-patch': (_, repo, hash, stat) => git.getCommitPatch(repo, hash, stat),
  'git:checkout': (_, repo, ref) => git.checkout(repo, ref),
  'git:branch-create': (_, repo, name, from) => git.createBranch(repo, name, from),
  'git:branch-delete': (_, repo, name) => git.deleteBranch(repo, name),
  'git:stats': (_, repo) => git.getStats(repo),
};

function registerIpc() {
  for (const [channel, handler] of Object.entries(GIT_HANDLERS)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await handler(...args) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
  }

  ipcMain.handle('dialog:pick-folder', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select folder to scan for repositories',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:pick-repo', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a git repository folder',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:clone-destination', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Where should the repository be cloned?',
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('git:clone', async (event, url, destDir) => {
    try {
      const result = await git.clone(url, destDir, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('git:clone-progress', { url, destDir, progress });
        }
      });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#05060f',
    title: 'NEON // GIT EXPLORER',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
