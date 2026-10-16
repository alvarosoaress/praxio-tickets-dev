const { ipcMain } = require('electron');
const { azure, setAzure } = require('../services/config');
const { dono, bugExistente, urlItem, subirAnexo, criarBug } = require('../services/azure');
const { anexoBytes } = require('../services/portalapi');
const cache = require('../services/resumos');

function register() {
  // O token nunca volta ao renderer, como a chave da API: so o nome de quem e o dono.
  ipcMain.handle('azure-get', () => {
    const a = azure();
    return a ? { nome: a.nome } : {};
  });

  // Confere o token no Azure antes de gravar: token que nao funciona nao entra, e o dono
  // que vem dessa conferencia e o responsavel de todo Bug criado com ele.
  ipcMain.handle('azure-set', async (_e, pat) => {
    pat = String(pat || '').trim();
    if (!/^[A-Za-z0-9]{20,200}$/.test(pat)) return { error: 'Isso não parece um token do Azure DevOps.' };
    const d = await dono(pat);
    if (d.error) return d;
    setAzure({ pat, email: d.email, nome: d.nome });
    return { nome: d.nome };
  });

  // Bug que ja existe para o ticket, de qualquer dev: e o que troca Criar Bug por Ver Bug.
  // Sem token nao ha a quem perguntar, e o botao fica em Criar Bug.
  ipcMain.handle('azure-bug-de', async (_e, id) => {
    if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
    const a = azure();
    if (!a) return {};
    const r = await bugExistente(a.pat, id);
    return r.error || !r.id ? r : { id: r.id, url: urlItem(r.id) };
  });

  // O conteudo do card e o resumo DO CACHE, nao um texto vindo do renderer — mesma postura
  // de ipc/analise.js. O renderer garante o resumo antes (gera ou refaz), e aqui so se
  // confere que ele existe.
  ipcMain.handle('azure-bug', async (_e, { id, ticket, tramites }) => {
    if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
    const a = azure();
    if (!a) return { error: 'NO_PAT' };
    const hit = cache.get(id);
    if (!hit || !hit.text) return { error: 'NO_RESUMO' };
    if (!ticket || !ticket.number) return { error: 'O portal não devolveu o número deste ticket, que é o começo do título do Bug.' };
    tramites = Array.isArray(tramites) ? tramites : [];

    const ja = await bugExistente(a.pat, id);
    if (ja.error) return ja;
    if (ja.id) return { id: ja.id, url: urlItem(ja.id), existia: true };

    // Um anexo por vez, baixado e subido so em memoria (nada em disco): a fila do portal e
    // serial de qualquer jeito, e assim so um arquivo ocupa memoria. Anexo que falha NAO
    // derruba o Bug — mesma regra do resumo —, mas volta nomeado para a tela dizer qual faltou.
    const anexos = [], falhas = [];
    const vistos = new Set();
    for (const x of tramites.flatMap(tr => tr.anexos || [])) {
      if (!x || vistos.has(x.id)) continue;
      vistos.add(x.id);
      const nome = String(x.name || `anexo-${x.id}`);
      const b = await anexoBytes(x.id);   // valida o id como numerico
      const u = b.error ? b : await subirAnexo(a.pat, nome, b.buffer);
      if (u.error) falhas.push(`${nome} (${u.error})`);
      else anexos.push({ url: u.url, name: nome });
    }

    const r = await criarBug(a.pat, a.email, ticket, id, tramites, hit.text, anexos);
    return r.error ? r : { ...r, falhas };
  });
}

module.exports = { register };
