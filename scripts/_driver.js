'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'neon-driver-')));
  require('../src/main/index.js');
  let win = null;
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  try {
    if (!win) { console.log('DRIVER no window'); return; }
    await new Promise((r) => {
      if (!win.webContents.isLoading()) return r();
      win.webContents.once('did-finish-load', r);
    });
    const ev = (code) => win.webContents.executeJavaScript(code);
    const waitFor = async (check, timeout = 8000, interval = 200) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await check()) return;
        await sleep(interval);
      }
      throw new Error('timeout');
    };
    const js = (o) => JSON.stringify(o);
    const sh = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const mkRepo = (p) => {
      fs.mkdirSync(p, { recursive: true });
      sh(['init', '-b', 'main'], p);
      sh(['config', 'user.email', 'x@x'], p);
      sh(['config', 'user.name', 'X'], p);
      fs.writeFileSync(path.join(p, 'f.txt'), 'x\n');
      sh(['add', '.'], p);
      sh(['commit', '-m', 'init'], p);
    };

    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-ws-'));
    const a = path.join(wsRoot, 'proj-a');
    const b = path.join(wsRoot, 'proj-b');
    const repo1 = path.join(wsRoot, 'proj-c', 'deep', 'sub', 'repo1');
    mkRepo(a);
    mkRepo(b);
    mkRepo(repo1);
    const fixture = path.join(os.tmpdir(), 'neon-drv-fixture-' + Date.now());
    mkRepo(fixture);

    await waitFor(() => ev('typeof window.__neon !== "undefined"'));
    console.log('DRIVER open fixture + scan ws (mirrors smoke):');
    console.log('DRIVER fixtureOpen=' + await ev('(async function(){try{await window.__neon.openRepo(' + js(fixture) + ');return "OK";}catch(e){return "THROW:"+e.message;}})()'));
    console.log('DRIVER scan=' + await ev('(async function(){return (await window.__neon.scanWorkspace(' + js(wsRoot) + ')).length;})()'));
    console.log('DRIVER expandChain=' + await ev('(async function(){await window.__neon.openRepo(' + js(path.join(wsRoot,'proj-c')) + ');await window.__neon.openRepo(' + js(path.join(wsRoot,'proj-c','deep')) + ');await window.__neon.openRepo(' + js(path.join(wsRoot,'proj-c','deep','sub')) + ');return "OK";})()'));
    win.webContents.invalidate();
    await sleep(300);
    const storedBefore = await ev('(function(){var ws=JSON.parse(localStorage.getItem("neon.workspaces"));var out={count:ws.length,root:ws[0].root,folders:Object.keys(ws[0].folders)};out.rootRepos=ws[0].folders[""].repos;return JSON.stringify(out);})()');
    console.log('DRIVER stored-before=' + storedBefore);

    console.log('DRIVER reloading...');
    win.webContents.reload();
    const t0 = Date.now();
    try {
      await waitFor(() => ev('typeof window.__neon !== "undefined" && document.querySelectorAll(".repo-group").length>0'), 15000);
      console.log('DRIVER reload-settled in ' + (Date.now() - t0) + 'ms');
    } catch (e) {
      console.log('DRIVER reload TIMEOUT after ' + (Date.now() - t0) + 'ms');
    }
    const diag = await ev('(function(){var s=window.__neon?window.__neon.state:null;var ws=JSON.parse(localStorage.getItem("neon.workspaces")||"[]");var rootRepos=ws[0]&&ws[0].folders[""]?ws[0].folders[""].repos:[];var checks={};for(var i=0;i<rootRepos.length;i++){var p=rootRepos[i];checks[p]=window.__neon? "state:"+JSON.stringify((s&&s.workspaces[0]&&s.workspaces[0].folders[""]&&s.workspaces[0].folders[""].repos||[]).indexOf(p)) : "none";}return JSON.stringify({neon:typeof window.__neon, groups:document.querySelectorAll(".repo-group").length, items:document.querySelectorAll(".repo-item").length, wsState:s?JSON.stringify(s.workspaces.map(function(w){return {root:w.root, f:Object.keys(w.folders)};})):null, rootReposSaved:rootRepos, restoredRootRepos:s&&s.workspaces[0]&&s.workspaces[0].folders[""]?s.workspaces[0].folders[""].repos:null, linkRepos:s?JSON.stringify(s.repos.map(function(r){return r.path;})):null});})()');
    console.log('DRIVER diag=' + diag);
  } catch (e) {
    console.log('DRIVER ERROR ' + e.stack);
  } finally {
    app.exit(0);
  }
});
