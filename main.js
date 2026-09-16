// Arquivo principal: registra o scheme, liga os modulos de IPC e abre a janela.
// Toda a logica mora em services/ (mundo externo) e ipc/ (fronteira com o renderer).
const { app, BrowserWindow, Menu, shell, protocol } = require('electron');
const path = require('path');

const ipcConfig = require('./ipc/config');
const ipcTickets = require('./ipc/tickets');
const ipcAnexos = require('./ipc/anexos');
const ipcResumo = require('./ipc/resumo');
const ipcHotfix = require('./ipc/hotfix');
const { attachDevLog } = require('./services/devlog');

// anexo://<id> serve os bytes do anexo vindos da API. Assim <img>, <video> e o
// visualizador de PDF do Chromium leem direto, em stream, sem nada em disco e sem
// base64 inflando a memoria. Precisa acontecer antes do whenReady.
protocol.registerSchemesAsPrivileged([{
  scheme: 'anexo',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

ipcConfig.register();
ipcTickets.register();
ipcAnexos.register();
ipcResumo.register();
ipcHotfix.register();

app.whenReady().then(() => {
  ipcAnexos.registerProtocol();

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720,
    backgroundColor: '#0e1116',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  attachDevLog(win);
  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());
