const { ipcMain } = require('electron');
const { SEARCH_MENU, get } = require('../services/portalapi');

const numeric = id => /^\d+$/.test(String(id));

function register() {
  // A coluna "Ultimo tramite" do grid do portal atrasa — medido em producao, um ticket
  // com tramite de hoje 09:30 vinha com lastUpdate de cinco dias atras. Como "parado ha" e
  // o sinal primario da tela (PRODUCT.md), o valor do grid e substituido pela data do
  // tramite mais recente, que e a unica fiel. Uma request por vez: a API serializa por
  // sessao. Falha de um ticket nao derruba a lista — ele fica com a data do grid.
  // ponytail: N+1 serializado. Com a fila atual (3-4 tickets) custa ~1 s por ticket; numa
  // fila grande isso vira minutos e o certo passa a ser a API devolver a data ja corrigida.
  ipcMain.handle('tickets', async () => {
    const b = await get(`/scrape-custom/${SEARCH_MENU}`, 120_000);
    if (b.error) return b;
    const tickets = b.tickets || [];
    for (const t of tickets) {
      const id = (/\/TicketPrincipal\/(\d+)/.exec(t.link || '') || [])[1];
      if (!id) continue;
      const r = await get(`/tramites/${id}`, 90_000);
      // Mais recente primeiro, e `date` pode ser null quando o elemento falta no HTML.
      const data = (r.tramites || []).find(tr => tr.date)?.date;
      if (data) t.lastUpdate = data;
    }
    return { tickets };
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
