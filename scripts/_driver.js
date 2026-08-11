'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
    const problems = [];
    win.webContents.on('console-message', (_e, level, message, line) => {
      if (level >= 2) problems.push('[' + level + '] ' + message + ' line ' + line);
    });
    const ev = (code) => win.webContents.executeJavaScript(code);
    const waitFor = async (check, timeout = 15000, interval = 150) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await check()) return;
        await sleep(interval);
      }
      throw new Error('timeout');
    };
    const js = (o) => JSON.stringify(o);

    await waitFor(() => ev('typeof window.__neon !== "undefined"'));
    console.log('DRIVER ready');

    const scan = await ev('(async function(){var r=await window.__neon.scanWorkspace(' + js('E:\\SCRIPTS') + ');return JSON.stringify(r.map(function(x){return x.name;}));})()');
    console.log('DRIVER scan=' + scan);
    const cats = await ev('(function(){return JSON.stringify(Array.from(document.querySelectorAll(".ws-folder-name")).map(function(n){return n.textContent;}));})()');
    console.log('DRIVER categories=' + cats);
    const count = await ev('(function(){var g=document.querySelector(".repo-group");return g ? g.querySelector(".repo-group-count").textContent : "none";})()');
    console.log('DRIVER group count=' + count);

    await ev('(function(){var f=Array.from(document.querySelectorAll(".ws-folder")).find(function(x){return x.querySelector(".ws-folder-name").textContent==="AI-Agents";});if(f)f.click();})()');
    await waitFor(() => ev('(function(){return document.querySelectorAll(".repo-item").length > 1;})()'));
    const aiEntry = await ev('(function(){return JSON.stringify(window.__neon.state.workspaces[0].folders["AI-Agents"]);})()');
    console.log('DRIVER AI-Agents entry=' + aiEntry);
    const aiRepos = await ev('(function(){return JSON.stringify(Array.from(document.querySelectorAll(".repo-item .repo-name")).map(function(n){return n.textContent;}));})()');
    console.log('DRIVER AI-Agents rendered repos=' + aiRepos);

    const open1 = await ev('(async function(){try{await window.__neon.openRepo(' + js('E:\\SCRIPTS\\AI-Agents\\aria') + ');return "OK";}catch(e){return "THROW:"+e.message;}})()');
    console.log('DRIVER open aria=' + open1);
    await sleep(800);
    const toasts = await ev('(function(){return JSON.stringify(Array.from(document.querySelectorAll(".toast")).map(function(t){return t.textContent;}));})()');
    console.log('DRIVER toasts=' + toasts);
    console.log('DRIVER problems=' + JSON.stringify(problems));
  } catch (e) {
    console.log('DRIVER ERROR ' + e.message);
  } finally {
    app.exit(0);
  }
});
