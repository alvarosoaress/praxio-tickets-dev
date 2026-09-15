const { ipcMain } = require('electron');
const { KEY_LENGTH, apiKey, setApiKey, claudeOk, setClaudeOk } = require('../services/config');

function register() {
  ipcMain.handle('has-key', () => Boolean(apiKey()));

  ipcMain.handle('set-key', (_e, key) => {
    key = String(key || '').trim();
    if (key.length !== KEY_LENGTH) return { error: `A chave deve ter ${KEY_LENGTH} caracteres (esta tem ${key.length}).` };
    setApiKey(key);
    return { ok: true };
  });

  ipcMain.handle('claude-ok', () => claudeOk());
  ipcMain.handle('claude-allow', () => { setClaudeOk(); return { ok: true }; });
}

module.exports = { register };
