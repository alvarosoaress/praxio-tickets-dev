// Em desenvolvimento (TICKETS_API apontando para uma API local), o console do renderer
// sai no terminal e num arquivo — o .exe empacotado nao tem console, e sem isso erro de
// CSP e de protocolo some em silencio.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function attachDevLog(win) {
  if (!process.env.TICKETS_API) return;
  const log = path.join(app.getPath('userData'), 'dev.log');
  win.webContents.on('console-message', e => {
    const line = `[renderer:${e.level}] ${e.message}\n`;
    console.log(line.trim());
    try { fs.appendFileSync(log, line); } catch {}
  });
}

module.exports = { attachDevLog };
