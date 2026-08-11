'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'neon-probe-')));
  require('../src/main/index.js');
  let win = null;
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  try {
    if (!win) { console.log('PROBE no window'); return; }
    await new Promise((r) => {
      if (!win.webContents.isLoading()) return r();
      win.webContents.once('did-finish-load', r);
    });
    const ev = (code) => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 50; i++) {
      if (await ev('typeof window.__neon !== "undefined"')) break;
      await sleep(100);
    }
    const res = await ev('(async function(){try{var l=await window.gitAPI.scanLevel("E:\\\\SCRIPTS\\\\Servers");return JSON.stringify({gitDirs:l.dirs.filter(function(d){return d.git;}).map(function(d){return d.name;}),plainDirs:l.dirs.filter(function(d){return !d.git;}).map(function(d){return d.name;}),repos:l.repos.map(function(r){return r.name;})});}catch(e){return "THROW:"+e.message;}})()');
    console.log('PROBE Servers=' + res);

    const scan = await ev('(async function(){var found=await window.__neon.scanWorkspace("E:\\\\SCRIPTS\\\\Servers");await new Promise(function(r){setTimeout(r,300);});var badges=Array.from(document.querySelectorAll(".ws-git-badge.ws-git")).map(function(b){var row=b.closest(".ws-folder");return row?row.querySelector(".ws-folder-name").textContent:null;});return JSON.stringify({found:found.map(function(r){return r.name;}),gitBadges:badges});})()');
    console.log('PROBE scanRender=' + scan);
  } catch (e) {
    console.log('PROBE ERROR ' + e.stack);
  } finally {
    app.exit(0);
  }
});
