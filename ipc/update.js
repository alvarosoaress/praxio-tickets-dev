const { ipcMain } = require('electron');
const update = require('../services/update');

// A URL chega de volta do renderer, que nao e confiavel — quem confere o endereco e
// services/update.js, na fronteira, e nao este repasse (mesmo espirito da regra #9).
function register() {
  ipcMain.handle('update-check', () => update.checar());
  ipcMain.handle('update-apply', (_e, url) => update.aplicar(url));
}

module.exports = { register };
