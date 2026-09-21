const { ipcMain } = require('electron');
const { repos } = require('../services/config');
const { abrirNoTerminal, temDeepLink } = require('../services/claude');
const git = require('../services/git');
const cache = require('../services/resumos');

// O renderer manda { id, ticket, repoIdx } — um INDICE da lista salva, nunca um caminho.
// Quem le config.repos e monta o caminho e este lado, como na regra de ouro #9: o cliente
// aponta qual das opcoes que ele ja viu, o servidor decide o que isso significa. Indice que
// nao existe na lista cai em NO_REPO junto com lista vazia, e nao ha terceiro caso.
//
// Cada erro tem codigo proprio porque a tela diz coisa diferente em cada caso — "aponte um
// repositorio" e "rode git flow init" sao consertos que nao se parecem.
async function preparar(id, ticket, repoIdx) {
  if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };

  // A pre-condicao "ja possui resumo" e verificada aqui, e nao presumida do botao estar
  // visivel: o resumo e o conteudo do briefing, sem ele nao ha o que entregar ao Claude.
  const hit = cache.get(id);
  if (!hit || !hit.text) return { error: 'NO_RESUMO' };

  const slug = git.slugTicket(ticket && ticket.number);
  if (!slug) return { error: 'NO_SLUG' };

  const repo = repos()[Number(repoIdx)];
  if (!repo || !repo.path) return { error: 'NO_REPO' };

  // Antes do probe de proposito: sem o handler do deep link a hotfix nao teria como abrir
  // nada no fim, e descobrir isso depois deixaria o usuario numa branch nova sem terminal.
  if (!await temDeepLink()) return { error: 'NO_DEEPLINK' };

  const p = await git.probe(repo.path);
  if (p.error) return { ...p, repo: repo.path };

  return { ...p, repo: repo.path, slug, resumo: hit.text };
}

function register() {
  ipcMain.handle('hotfix-probe', async (_e, { id, ticket, repoIdx }) => {
    const r = await preparar(id, ticket, repoIdx);
    if (r.error) return r;
    return { repo: r.repo, branch: r.branch, dirty: r.dirty, alvo: r.prefix + r.slug };
  });

  // Reroda os mesmos checks de proposito. O renderer nao e confiavel, e entre as duas
  // chamadas o disco pode ter mudado — o usuario tem esse repositorio aberto noutra janela
  // o dia inteiro.
  ipcMain.handle('hotfix-start', async (_e, { id, ticket, repoIdx }) => {
    const r = await preparar(id, ticket, repoIdx);
    if (r.error) return r;

    const h = await git.hotfix(r.repo, r.slug, r);
    if (h.error) return h;

    const texto = git.buildBriefing(ticket, r.resumo, r.slug);
    const b = git.escreverBriefing(r.repo, r.gitDir, r.slug, texto);
    if (b.error) return { error: b.error, step: 'briefing', stash: h.stash };

    abrirNoTerminal(r.repo, b.nome);
    return { ok: true, repo: r.repo, branch: r.prefix + r.slug, existed: h.existed, stash: h.stash };
  });
}

module.exports = { register };
