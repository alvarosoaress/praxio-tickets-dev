// Arquivo principal: registra o scheme, liga os modulos de IPC e abre a janela.
// Toda a logica mora em services/ (mundo externo) e ipc/ (fronteira com o renderer).
const { app, BrowserWindow, Menu, shell, protocol } = require('electron');
const path = require('path');

const ipcConfig = require('./ipc/config');
const ipcTickets = require('./ipc/tickets');
const ipcAnexos = require('./ipc/anexos');
const ipcResumo = require('./ipc/resumo');
const ipcAnalise = require('./ipc/analise');
const ipcUpdate = require('./ipc/update');
const ipcStatus = require('./ipc/status');
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
ipcAnalise.register();
ipcUpdate.register();
ipcStatus.register();

// Contra API de teste o perfil e outro: salvar a chave falsa apagaria a real, e o
// localStorage nao briga com o Tickets instalado aberto. Precisa vir antes do ready.
if (process.env.TICKETS_API) app.setPath('userData', path.join(app.getPath('appData'), 'tickets-dev'));

// Sem AppUserModelID o Windows nao sabe de quem e o toast e some com ele sem tocar som.
app.setAppUserModelId('com.alvaro.tickets');

app.whenReady().then(() => {
  ipcAnexos.registerProtocol();

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720,
    backgroundColor: '#0e1116',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // so a fila falsa liga: refresh em segundos para ver o efeito do painel sem F5
      additionalArguments: process.env.TICKETS_REFRESH_MS ? [`--refresh-ms=${process.env.TICKETS_REFRESH_MS}`] : []
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  attachDevLog(win);
  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());
