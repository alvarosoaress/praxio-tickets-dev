const { ipcMain } = require('electron');
const { claudeOk } = require('../services/config');
const { resumir } = require('../services/claude');
const cache = require('../services/resumos');

function register() {
  ipcMain.handle('resumo', async (_e, { id, ticket, tramites, refazer }) => {
    if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
    // O conteudo do ticket sai da maquina; sem o aceite explicito, nada e enviado.
    if (!claudeOk()) return { error: 'NO_CONSENT' };

    // O cache vive em disco e sobrevive ao restart. Resumo anterior ao ultimo tramite
    // NAO e refeito sozinho: volta com stale=true para a UI avisar. Refazer custa
    // dezenas de segundos e dinheiro — quem decide pagar e o usuario, clicando.
    const lastUpdate = (ticket && ticket.lastUpdate) || '';
    if (!refazer) {
      const hit = cache.get(id);
      if (hit) return { text: hit.text, cached: true, stale: hit.lastUpdate !== lastUpdate, at: hit.at || null };
    }

    const at = new Date().toISOString();
    const res = await resumir(ticket, tramites);
    if (!res.text) return res;
    cache.set(id, lastUpdate, res.text, at);
    return { text: res.text, at };
  });
}

module.exports = { register };
