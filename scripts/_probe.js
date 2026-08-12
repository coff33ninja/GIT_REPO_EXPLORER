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
    await ev('(async function(){await window.__neon.scanWorkspace("E:\\\\SCRIPTS\\\\Servers");return "done";})()');
    await sleep(800);
    const shot = await win.webContents.capturePage();
    const out = path.join(__dirname, '..', 'docs', 'git-badges.png');
    fs.writeFileSync(out, shot.toPNG());
    console.log('PROBE shot=' + out + ' bytes=' + shot.toPNG().length);
    console.log('PROBE badges=' + await ev('JSON.stringify(Array.from(document.querySelectorAll(".ws-git-badge")).map(function(b){return {t:b.textContent,git:b.classList.contains("ws-git"),name:b.closest(".ws-folder")?b.closest(".ws-folder").querySelector(".ws-folder-name").textContent:null};}))'));
  } catch (e) {
    console.log('PROBE ERROR ' + e.stack);
  } finally {
    app.exit(0);
  }
});
