'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const git = require('./git');

const SMOKE = process.argv.includes('--smoke');

const GIT_HANDLERS = {
  'git:is-repo': (_, dir) => git.isRepo(dir),
  'git:repo-root': (_, dir) => git.repoRoot(dir),
  'git:scan': (_, dir, depth) => git.scanForRepos(dir, depth),
  'git:repo-meta': (_, repo) => {
    if (SMOKE) console.log('SMOKE HANDLER repo-meta repo=' + JSON.stringify(repo));
    return git.getRepoMeta(repo);
  },
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
  'git:tree': (_, repo) => git.getTree(repo),
  'git:file-content': (_, repo, file) => git.getFileContent(repo, file),
  'git:readme': (_, repo) => git.getReadme(repo),
};

function registerIpc() {
  for (const [channel, handler] of Object.entries(GIT_HANDLERS)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        if (SMOKE) console.log('SMOKE IPC ' + channel + ' args=' + JSON.stringify(args));
        return { ok: true, data: await handler(null, ...args) };
      } catch (err) {
        if (SMOKE) console.log('SMOKE IPC FAIL ' + channel + ' ' + (err.stack || err.message));
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
    const waitFor = async (check, timeout = 10000, interval = 100) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await check();
        if (result) return result;
        await sleep(interval);
      }
      throw new Error('Timeout waiting for condition');
    };

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
          console.log('SMOKE direct getRepoMeta:');
          try {
            const dm = await git.getRepoMeta(fixture);
            console.log('SMOKE direct ok branch=' + dm.branch + ' head=' + dm.head);
          } catch (e) {
            console.log('SMOKE direct FAIL ' + (e.stack || e.message));
          }
          sh(['init', '-b', 'main'], fixture);
          sh(['config', 'user.email', 'smoke@neon.dev'], fixture);
          sh(['config', 'user.name', 'Smoke Test'], fixture);
          commit('a.txt', 'one\n', 'initial commit', fixture);
          commit('README.md', '# Neon Fixture\n\n## Smoke\n\n- item **bold**\n', 'add readme', fixture);
          sh(['checkout', '-b', 'feature/x'], fixture);
          commit('b.txt', 'two\n', 'feature work', fixture);
          sh(['checkout', 'main'], fixture);
          sh(['merge', 'feature/x', '--no-ff', '-m', 'merge feature/x'], fixture);
          commit('c.txt', 'three\n', 'post merge', fixture);
          fs.writeFileSync(path.join(fixture, 'dirty.txt'), 'dirty\n');
          fs.writeFileSync(path.join(fixture, 'a.txt'), 'one\nmodified\n');

          const openResult = await win.webContents.executeJavaScript(
            '(async function(){try{await window.__neon.openRepo(' + JSON.stringify(fixture) + ');return "OK";}catch(e){return "THROW:"+e.message;}})()'
          );
          console.log('SMOKE openResult=' + JSON.stringify(openResult));
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.getElementById("graphStats").textContent.trim() !== "" && document.getElementById("graphCanvas").clientWidth > 0'
            );
          }, 12000);

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
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.querySelectorAll("#inspectorBody .readme-card").length > 0'
            );
          }, 8000);
          const readmeCardCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .readme-card").length'
          );
          const readmeHead = await win.webContents.executeJavaScript(
            'document.querySelector("#inspectorBody .readme-head") ? document.querySelector("#inspectorBody .readme-head").textContent.trim() : ""'
          );
          const readmeBold = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .readme-body b").length'
          );
          await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tab")[1].click()'
          );
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.querySelectorAll(".file-row").length > 0'
            );
          }, 8000);
          const statusStats = await win.webContents.executeJavaScript(
            'document.getElementById("statusStats").textContent'
          );
          const fileRows = await win.webContents.executeJavaScript(
            'document.querySelectorAll(".file-row").length'
          );

          await win.webContents.executeJavaScript(
            'document.querySelector(".file-row").click()'
          );
          await sleep(800);
          const fileDiffCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .diff-file").length'
          );

          await win.webContents.executeJavaScript(
            '(function(){var r=document.getElementById("graphCanvas").getBoundingClientRect();var ev=new MouseEvent("click",{clientX:r.left+43,clientY:r.top+35,bubbles:true});document.getElementById("graphCanvas").dispatchEvent(ev);})()'
          );
          await sleep(900);
          const commitCardCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .commit-card").length'
          );

          await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tab")[2].click()'
          );
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.querySelectorAll(".tree-row.tree-file").length > 0'
            );
          }, 8000);
          const fileTreeCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tree-row.tree-file").length'
          );
          await win.webContents.executeJavaScript(
            '(function(){var r=document.querySelector(".tree-row.tree-file");if(r)r.click();return !!r;})()'
          );
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.querySelectorAll("#inspectorBody .file-view").length > 0'
            );
          }, 8000);
          const fileViewCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .file-view").length'
          );
          await win.webContents.executeJavaScript(
            '(function(){var b=Array.from(document.querySelectorAll(".file-toolbar .btn")).find(function(x){return x.textContent.trim()==="DIFF";});if(b)b.click();return !!b;})()'
          );
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.querySelectorAll("#inspectorBody .diff-file, #inspectorBody .file-content").length > 0 && !document.getElementById("inspectorBody").textContent.includes("LOADING")'
            );
          }, 8000);
          const fileDiffToggleCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll("#inspectorBody .diff-file").length'
          );

          const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-workspace-'));
          fs.mkdirSync(path.join(wsRoot, 'proj-a', 'inner'), { recursive: true });
          fs.mkdirSync(path.join(wsRoot, 'proj-b'), { recursive: true });
          for (const p of ['proj-a', 'proj-b']) {
            const sub = path.join(wsRoot, p);
            sh(['init', '-b', 'main'], sub);
            sh(['config', 'user.email', 'smoke@neon.dev'], sub);
            sh(['config', 'user.name', 'Smoke Test'], sub);
            commit('x.txt', 'x\n', 'init', sub);
          }
          const scanResult = await win.webContents.executeJavaScript(
            '(async function(){var found=await window.__neon.scanWorkspace(' + JSON.stringify(wsRoot) + ');return JSON.stringify(found.map(function(r){return r.name;}));})()'
          );
          const repoGroupCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll(".repo-group").length'
          );
          const nestedRepoCount = await win.webContents.executeJavaScript(
            'document.querySelectorAll(".repo-item-nested").length'
          );
          const wsRootShown = await win.webContents.executeJavaScript(
            'document.querySelector(".repo-group-name") ? document.querySelector(".repo-group-name").textContent === ' + JSON.stringify(wsRoot) + ' : false'
          );
          fs.rmSync(wsRoot, { recursive: true, force: true });
          await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tab")[0].click()'
          );
          const shot = await win.webContents.capturePage();
          const outPath = path.join(__dirname, '..', '..', 'docs', 'screenshot.png');
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, shot.toPNG());
          console.log('SMOKE shot=' + outPath + ' bytes=' + shot.toPNG().length);

          await win.webContents.executeJavaScript(
            'document.querySelectorAll(".tab")[0].click()'
          );
          await waitFor(async () => {
            return await win.webContents.executeJavaScript(
              'document.getElementById("graphCanvas").clientWidth > 0 && document.getElementById("graphStats").textContent.trim() !== ""'
            );
          }, 8000);
          const graphDataUrl = await win.webContents.executeJavaScript(
            'document.getElementById("graphCanvas").toDataURL("image/png")'
          );
          const graphPng = Buffer.from(graphDataUrl.split(',')[1], 'base64');
          fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'graph.png'), graphPng);
          console.log('SMOKE graphPng bytes=' + graphPng.length);
          const canvasDims = await win.webContents.executeJavaScript(
            '(function(){var c=document.getElementById("graphCanvas");return c.width+"x"+c.height;})()'
          );
          console.log('SMOKE canvasDims=' + JSON.stringify(canvasDims));

          win.webContents.invalidate();
          await sleep(600);
          const shot2 = await win.webContents.capturePage();
          fs.writeFileSync(outPath, shot2.toPNG());
          console.log('SMOKE shot2 bytes=' + shot2.toPNG().length);

          const toasts = await win.webContents.executeJavaScript(
            'Array.from(document.querySelectorAll(".toast")).map(t=>t.textContent).join(" || ")'
          );
          console.log('SMOKE graph=' + JSON.stringify(graphStats) + ' branch=' + JSON.stringify(branch) +
            ' leds=' + JSON.stringify(leds) + ' pixels=' + pixels +
            ' status=' + JSON.stringify(statusStats) + ' fileRows=' + fileRows +
            ' tree=' + fileTreeCount + ' files=' + fileViewCount + ' diffToggle=' + fileDiffToggleCount +
            ' readmeCard=' + readmeCardCount + ' readmeHead=' + JSON.stringify(readmeHead) + ' readmeBold=' + readmeBold +
            ' scan=' + JSON.stringify(scanResult) + ' groups=' + repoGroupCount + ' nested=' + nestedRepoCount +
            ' wsRootShown=' + wsRootShown +
            ' dbg=' + JSON.stringify(dbg) + ' toasts=' + JSON.stringify(toasts));

          fs.rmSync(fixture, { recursive: true, force: true });
          const ok =
            /commits rendered/.test(graphStats) &&
            branch === 'main' &&
            pixels > 1000 &&
            fileRows >= 1 &&
            fileDiffCount >= 1 &&
            commitCardCount >= 1 &&
            fileTreeCount >= 1 &&
            fileViewCount >= 1 &&
            fileDiffToggleCount >= 1 &&
            readmeCardCount >= 1 &&
            readmeHead.includes('README.md') &&
            readmeBold >= 1 &&
            repoGroupCount >= 1 &&
            nestedRepoCount >= 2 &&
            wsRootShown === true &&
            JSON.parse(scanResult).length >= 2 &&
            parseInt(canvasDims.split('x')[0], 10) > 500;
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
  if (SMOKE) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'neon-smoke-profile-')));
  }
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
