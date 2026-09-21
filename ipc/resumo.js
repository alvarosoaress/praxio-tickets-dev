const { ipcMain } = require('electron');
const { claudeOk, repos } = require('../services/config');
const { resumir, escolherAnexos, IMG_MIME, MAX_IMG_BYTES, MAX_PDF_BYTES, MAX_PDF_PAGINAS } = require('../services/claude');
const { anexoBytes } = require('../services/portalapi');
const { toPlain, paginasPdf } = require('../services/anexo');
const cache = require('../services/resumos');

// Baixa os anexos escolhidos e entrega cada um na forma que o modelo recebe: imagem e PDF
// em base64, o resto convertido para texto puro aqui no main.
//
// Falha de um anexo NAO derruba o resumo, e essa e a regra central desta funcao: o texto
// dos tramites sozinho ja era o resumo inteiro ate aqui, entao perder uma planilha e muito
// menos ruim que nao entregar resumo nenhum. Todo `continue` abaixo e isso.
//
// O `size` do portal e so uma etiqueta em pt-BR; os tetos que valem sao conferidos nos
// bytes que chegaram, porque sao eles que realmente viram token.
async function carregarAnexos(escolhidos) {
  const out = [];
  for (const a of escolhidos) {
    const r = await anexoBytes(a.id);
    if (r.error || !r.buffer) continue;

    if (a.lane === 'image') {
      if (r.buffer.length > MAX_IMG_BYTES) continue;
      out.push({ name: a.name, mime: IMG_MIME[String(a.ext || '').toLowerCase()], b64: r.buffer.toString('base64') });
      continue;
    }

    if (a.lane === 'pdf') {
      if (r.buffer.length > MAX_PDF_BYTES) continue;
      // Uma pagina de PDF custa ~1,5-3k tokens. Quando da para contar, corta cedo; quando
      // nao da (PDF 1.5+ comprime os objetos de pagina), quem segura e o teto de bytes.
      const pgs = paginasPdf(r.buffer);
      if (pgs !== null && pgs > MAX_PDF_PAGINAS) continue;
      out.push({ name: a.name, mime: 'application/pdf', b64: r.buffer.toString('base64') });
      continue;
    }

    // sheet / doc / texto: viram texto puro e entram embutidos no prompt.
    const conv = await toPlain(r.buffer, a.lane);
    if (conv.error || !conv.text || !conv.text.trim()) continue;
    out.push({ name: a.name, texto: conv.text });
  }
  return out;
}

function register() {
  ipcMain.handle('resumo', async (_e, { id, ticket, tramites, refazer, repoIdx }) => {
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

    // Só quem vai gerar precisa de repositorio, e por isso a pergunta vem depois do cache:
    // o caso comum e abrir um resumo que ja existe, e ali um dialog seria um clique que nao
    // decide nada. NEED_REPO devolve a vez ao renderer, que pergunta e rechama com o indice.
    if (repoIdx === undefined || repoIdx === null) return { error: 'NEED_REPO' };

    const at = new Date().toISOString();
    // Id de anexo continua validado do lado de la (anexoBytes), e so entra aqui anexo que
    // veio dos proprios tramites — o renderer nunca escolhe qual arquivo sai da maquina.
    const { anexos } = escolherAnexos(tramites);
    // Indice da lista salva, como na hotfix: o renderer aponta uma opcao que ja viu, nunca
    // um caminho. -1 (ou indice que nao existe) e "seguir sem repositorio" — o resumo sai
    // como sempre saiu, porque a doc e precisao a mais e nao pre-requisito.
    const repo = repos()[Number(repoIdx)];
    const res = await resumir(ticket, tramites, await carregarAnexos(anexos), repo && repo.path);
    if (!res.text) return res;
    cache.set(id, lastUpdate, res.text, at);
    return { text: res.text, at };
  });
}

module.exports = { register };
