const { ipcMain } = require('electron');
const { SEARCH_MENU, get } = require('../services/portalapi');

const numeric = id => /^\d+$/.test(String(id));

function register() {
  ipcMain.handle('tickets', async () => {
    const b = await get(`/scrape-custom/${SEARCH_MENU}`, 120_000);
    return b.error ? b : { tickets: b.tickets || [] };
  });

  // Uma request por vez, de proposito. O portal e ASP.NET e serializa requisicoes que
  // compartilham a sessao; a API tem um cookie jar global, entao chamada concorrente nao
  // ganha tempo — ela entra na fila e atrasa a que a tela esta esperando. Medido: os
  // tramites do ticket 938963 levam 2,2 s sozinhos e 4,1 s com duas irmas em paralelo.
  ipcMain.handle('ticket-detail', async (_e, id) => {
    if (!numeric(id)) return { error: 'ID de ticket inválido.' };
    const b = await get(`/tramites/${id}?anexos=1`, 90_000);
    return b.error ? b : { tramites: b.tramites || [] };
  });

  // Acessorias: o renderer so pede isto depois que os tramites ja estao na tela.
  ipcMain.handle('ticket-views', async (_e, id) => {
    if (!numeric(id)) return { error: 'ID de ticket inválido.' };
    const b = await get(`/visualizacoes/${id}`, 60_000);
    return b.error ? b : { views: b.visualizacoes || [] };
  });
}

module.exports = { register };
