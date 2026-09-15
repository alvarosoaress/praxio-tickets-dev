const { ipcMain } = require('electron');
const { SEARCH_MENU, get } = require('../services/portalapi');

function register() {
  ipcMain.handle('tickets', async () => {
    const b = await get(`/scrape-custom/${SEARCH_MENU}`, 120_000);
    return b.error ? b : { tickets: b.tickets || [] };
  });

  ipcMain.handle('ticket-detail', async (_e, id) => {
    if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
    const [tramites, views] = await Promise.all([
      get(`/tramites/${id}?anexos=1`, 90_000),
      get(`/visualizacoes/${id}`, 60_000)
    ]);
    if (tramites.error) return tramites;
    // Visualizacoes sao acessorias: se falharem, o ticket ainda abre.
    return { tramites: tramites.tramites || [], views: views.error ? [] : (views.visualizacoes || []) };
  });
}

module.exports = { register };
