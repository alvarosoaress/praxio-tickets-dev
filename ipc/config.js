const { ipcMain, dialog, BrowserWindow } = require('electron');
const { KEY_LENGTH, apiKey, setApiKey, claudeOk, setClaudeOk, repos, setRepos } = require('../services/config');

const MAX_REPOS = 20;
const MAX_PATH = 400;

// Este write reescreve o config.json que guarda a CHAVE, e readCfg trata arquivo
// corrompido como "ainda nao configurado" — ali isso custa a chave do usuario. Por isso
// tipo e teto sao checados antes de gravar, e o que nao presta e descartado em silencio
// em vez de derrubar a lista inteira.
//
// Existencia da pasta NAO e checada de proposito: o repo pode estar num drive offline ou
// ainda nao clonado, e reprovar a lista toda por uma linha faria o autosave perder as
// linhas boas. Quem descobre que o caminho nao presta e o probe da hotfix, na hora, com
// mensagem propria para cada caso.
//
// A ordem da lista e o contrato: ipc/hotfix.js e ipc/resumo.js recebem do renderer o
// indice de uma linha daqui. Por isso linha descartada some antes de gravar, e nao depois.
function limpar(list) {
  if (!Array.isArray(list)) return null;
  const validos = [];
  for (const r of list.slice(0, MAX_REPOS)) {
    if (!r || typeof r !== 'object') continue;
    const p = typeof r.path === 'string' ? r.path.trim().slice(0, MAX_PATH) : '';
    if (!p) continue;
    validos.push({ path: p });
  }
  return validos;
}

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

  ipcMain.handle('get-repos', () => ({ repos: repos() }));

  ipcMain.handle('set-repos', (_e, list) => {
    const limpo = limpar(list);
    if (!limpo) return { error: 'Lista de repositórios inválida.' };
    setRepos(limpo);
    return { ok: true, repos: limpo };
  });

  // Seletor nativo de pasta. Nao valida nada e nao e fronteira: quem confere e set-repos,
  // porque o renderer pode chama-lo sem passar por aqui. A janela pai importa — sem ela o
  // picker pode abrir atras da janela do app.
  ipcMain.handle('pick-dir', async e => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      return r.canceled || !r.filePaths.length ? {} : { path: r.filePaths[0] };
    } catch {
      return {};
    }
  });
}

module.exports = { register };
