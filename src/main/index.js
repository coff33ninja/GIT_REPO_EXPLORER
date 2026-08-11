'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const git = require('./git');

const SMOKE = process.argv.includes('--smoke');

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

  if (SMOKE) {
    const { execFileSync } = require('child_process');
    const os = require('os');
    const fs = require('fs');
    const problems = [];
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) problems.push(`[${level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => problems.push(`LOAD FAIL ${code} ${desc}`));

    const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    const commit = (file, content, msg, cwd) => {
      fs.writeFileSync(path.join(cwd, file), content);
      sh(['add', file], cwd);
      sh(['commit', '-m', msg], cwd);
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const title = win.webContents.getTitle();
          const repoChip = await win.webContents.executeJavaScript(
            'document.getElementById("chipRepoPath").textContent'
          );
          const canvas = await win.webContents.executeJavaScript(
            '!!document.getElementById("graphCanvas").getContext'
          );
          console.log('SMOKE title=' + JSON.stringify(title) + ' repoChip=' + JSON.stringify(repoChip) + ' canvas=' + canvas);

          const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-fixture-'));
          sh(['init', '-b', 'main'], fixture);
          sh(['config', 'user.email', 'smoke@neon.dev'], fixture);
          sh(['config', 'user.name', 'Smoke Test'], fixture);
          commit('a.txt', 'one\n', 'initial commit', fixture);
          sh(['checkout', '-b', 'feature/x'], fixture);
          commit('b.txt', 'two\n', 'feature work', fixture);
          sh(['checkout', 'main'], fixture);
          sh(['merge', 'feature/x', '--no-ff', '-m', 'merge feature/x'], fixture);
          commit('c.txt', 'three\n', 'post merge', fixture);
          fs.writeFileSync(path.join(fixture, 'dirty.txt'), 'dirty\n');

          await win.webContents.executeJavaScript(
            '(async function(){try{await window.__neon.openRepo(' + JSON.stringify(fixture) + ');return "OK";}catch(e){return "THROW:"+e.message;}})()'
          );
          await sleep(1800);

          const graphStats = await win.webContents.executeJavaScript(
            'document.getElementById("graphStats").textContent'
          );
          const branch = await win.webContents.executeJavaScript(
            'document.getElementById("chipBranch").textContent'
          );
          const leds = await win.webContents.executeJavaScript(
            'Array.from(document.querySelectorAll("#statusLeds .led")).map(l=>l.textContent).join(",")'
          );
          const pixels = await win.webContents.executeJavaScript(
            '(function(){var c=document.getElementById("graphCanvas");var ctx=c.getContext("2d");var d=ctx.getImageData(0,0,c.width,c.height).data;var n=0;for(var i=0;i<d.length;i+=4){if(d[i]||d[i+1]||d[i+2])n++;}return n;})()'
          );
          const dbg = await win.webContents.executeJavaScript(
            '(window.__neon.state.currentRepo ? window.__neon.state.currentRepo.path + "|" + window.__neon.state.commits.length + " commits" : "no repo")'
          );
          await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tab")[1].click()'
          );
          await sleep(400);
          const statusStats = await win.webContents.executeJavaScript(
            'document.getElementById("statusStats").textContent'
          );
          const fileRows = await win.webContents.executeJavaScript(
            'document.querySelectorAll(".file-row").length'
          );

          console.log('SMOKE graph=' + JSON.stringify(graphStats) + ' branch=' + JSON.stringify(branch) +
            ' leds=' + JSON.stringify(leds) + ' pixels=' + pixels +
            ' status=' + JSON.stringify(statusStats) + ' fileRows=' + fileRows +
            ' dbg=' + JSON.stringify(dbg));

          fs.rmSync(fixture, { recursive: true, force: true });
          const ok =
            /commits rendered/.test(graphStats) &&
            branch === 'main' &&
            pixels > 1000 &&
            fileRows >= 1;
          if (!ok) throw new Error('renderer state mismatch');
          if (problems.length) {
            console.log('SMOKE PROBLEMS:');
            problems.forEach((p) => console.log('  ' + p));
            app.exit(1);
          } else {
            console.log('SMOKE OK');
            app.exit(0);
          }
        } catch (err) {
          console.log('SMOKE ERROR: ' + err.message);
          app.exit(1);
        }
      }, 1200);
    });
  }
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
