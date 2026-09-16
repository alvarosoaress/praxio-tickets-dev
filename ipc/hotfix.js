const { ipcMain } = require('electron');
const { repos } = require('../services/config');
const { repoDe } = require('../modulos');
const { abrirNoTerminal } = require('../services/claude');
const git = require('../services/git');
const cache = require('../services/resumos');

// O renderer manda { id, ticket } e nada mais — nunca um caminho. Quem resolve o
// repositorio e este lado, a partir do mapa modulo->repo do config.json: mesmo espirito da
// regra de ouro #9, o caminho e montado de um lado so.
//
// Cada erro tem codigo proprio porque a tela diz coisa diferente em cada caso — "aponte um
// repositorio" e "rode git flow init" sao consertos que nao se parecem.
async function preparar(id, ticket) {
  if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };

  // A pre-condicao "ja possui resumo" e verificada aqui, e nao presumida do botao estar
  // visivel: o resumo e o conteudo do briefing, sem ele nao ha o que entregar ao Claude.
  const hit = cache.get(id);
  if (!hit || !hit.text) return { error: 'NO_RESUMO' };

  const slug = git.slugTicket(ticket && ticket.number);
  if (!slug) return { error: 'NO_SLUG' };

  const mod = (ticket && ticket.module) || '';
  const repo = repoDe(repos(), mod);
  if (!repo) return { error: 'NO_REPO', module: mod };

  const p = await git.probe(repo.path);
  if (p.error) return { ...p, repo: repo.path };

  return { ...p, repo: repo.path, slug, resumo: hit.text };
}

function register() {
  ipcMain.handle('hotfix-probe', async (_e, { id, ticket }) => {
    const r = await preparar(id, ticket);
    if (r.error) return r;
    return { repo: r.repo, branch: r.branch, dirty: r.dirty, alvo: r.prefix + r.slug };
  });

  // Reroda os mesmos checks de proposito. O renderer nao e confiavel, e entre as duas
  // chamadas o disco pode ter mudado — o usuario tem esse repositorio aberto noutra janela
  // o dia inteiro.
  ipcMain.handle('hotfix-start', async (_e, { id, ticket }) => {
    const r = await preparar(id, ticket);
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
