const { ipcMain } = require('electron');
const { SEARCH_MENU, get } = require('../services/portalapi');

const numeric = id => /^\d+$/.test(String(id));

function register() {
  // So a lista do grid, para a tela aparecer logo. A data real do "parado ha" vem depois,
  // por 'tickets-last'.
  ipcMain.handle('tickets', async () => {
    const b = await get(`/scrape-custom/${SEARCH_MENU}`, 120_000);
    return b.error ? b : { tickets: b.tickets || [] };
  });

  // A coluna "Ultimo tramite" do grid do portal atrasa — medido em producao, um ticket
  // com tramite de hoje 09:30 vinha com lastUpdate de cinco dias atras. Como "parado ha" e
  // o sinal primario da tela (PRODUCT.md), o renderer troca o valor do grid pela data do
  // tramite mais recente, que e a unica fiel. A API busca todos em paralelo, uma sessao do
  // portal por ticket; o historico inteiro vem junto (um deles tem 5,7 MB de HTML).
  ipcMain.handle('tickets-last', async (_e, ids) => {
    ids = (Array.isArray(ids) ? ids : []).filter(numeric);
    if (!ids.length) return { datas: {} };
    const b = await get(`/ultimos-tramites?ids=${ids.join(',')}`, 90_000);
    if (b.status !== 404) return b.error ? b : { datas: b.datas || {} };
    // ponytail: API anterior a /ultimos-tramites — um ticket por vez, como antes. Sai
    // quando o portal-scraper novo estiver no ar.
    const datas = {};
    for (const id of ids) {
      const r = await get(`/tramites/${id}`, 90_000);
      // Mais recente primeiro, e `date` pode ser null quando o elemento falta no HTML.
      datas[id] = (r.tramites || []).find(tr => tr.date)?.date || null;
    }
    return { datas };
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
