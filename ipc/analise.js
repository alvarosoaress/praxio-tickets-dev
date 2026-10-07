const { ipcMain } = require('electron');
const fs = require('fs');
const { repos } = require('../services/config');
const { abrirNoTerminal, temDeepLink } = require('../services/claude');
const briefing = require('../services/briefing');
const cache = require('../services/resumos');

// O renderer manda { id, ticket, repoIdx } — um INDICE da lista salva, nunca um caminho.
// Quem le config.repos e monta o caminho e este lado, como na regra de ouro #9: o cliente
// aponta qual das opcoes que ele ja viu, o servidor decide o que isso significa. Indice que
// nao existe na lista cai em NO_REPO junto com lista vazia, e nao ha terceiro caso.
//
// Cada erro tem codigo proprio porque a tela diz coisa diferente em cada caso.
async function analisar(id, ticket, repoIdx) {
  if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };

  // A pre-condicao "ja possui resumo" e verificada aqui, e nao presumida do botao estar
  // visivel: o resumo e o conteudo do briefing, sem ele nao ha o que entregar ao Claude.
  const hit = cache.get(id);
  if (!hit || !hit.text) return { error: 'NO_RESUMO' };

  const slug = briefing.slugTicket(ticket && ticket.number);
  if (!slug) return { error: 'NO_SLUG' };

  const repo = repos()[Number(repoIdx)];
  if (!repo || !repo.path) return { error: 'NO_REPO' };
  if (!fs.existsSync(repo.path)) return { error: 'NO_DIR', repo: repo.path };

  // Antes de escrever: sem o handler do deep link nada abriria, e o .md ficaria largado.
  if (!await temDeepLink()) return { error: 'NO_DEEPLINK' };

  const texto = briefing.buildBriefing(ticket, hit.text, slug);
  const b = briefing.escreverBriefing(repo.path, slug, texto);
  if (b.error) return b;

  abrirNoTerminal(repo.path, b.nome);
  return { ok: true };
}

function register() {
  ipcMain.handle('analise', (_e, { id, ticket, repoIdx }) => analisar(id, ticket, repoIdx));
}

module.exports = { register };
