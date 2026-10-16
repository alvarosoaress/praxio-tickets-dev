// Cliente do Azure DevOps: cria o Bug do ticket no board Run SIGAI com o PAT do proprio
// desenvolvedor. Nunca lanca: sempre { ...dados } ou { error }.
const { ehEscalacao } = require('./claude');

const ORG = 'https://dev.azure.com/praxio';
const PROJ = ORG + '/Autumn';
const AREA = 'Autumn\\Run SIGAI';
const PORTAL_TICKET = 'https://portaldocliente.praxio.com.br/Ticket/TicketPrincipal/';
// Campos customizados do processo do projeto. O Numero ticket e integer, entao leva o id
// do portal (945489), nao o numero de exibicao (1026-002742), que vai no titulo.
const F_NUM_TICKET = 'Custom.3ee72faf-7179-42ea-b6b8-6482806f3f78';
const F_TIPO_SOLIC = 'Custom.e30925fd-1369-4c34-b90a-99f049d30f51';

// Modulo do portal -> [Produto, Tag]. Fixo de proposito: as tags do projeto tem duplicatas
// por modulo ("WCE - WinCE- Controle de Estoque" e "WCE - WinCE Controle de Estoque e
// Almoxarifado"), e aqui vale a que o time usa nos bugs recentes. Modulo fora da tabela
// cria o Bug sem os dois campos.
const MODULOS = {
  WAB: ['SGI - WAB - Abastecimento', 'WAB - WinAB - Controle de Abastecimento'],
  WCB: ['SGI - WCB - Contabilidade', 'WCB - WinCB - Contabilidade'],
  WCE: ['SGI - WCE - Controle Estoque', 'WCE - WinCE Controle de Estoque e Almoxarifado'],
  WCF: ['SGI - WCF - Controle Financeiro', 'WCF - WinCF - Controle Financeiro'],
  WCO: ['SGI - WCO - Compras', 'WCO - WinCO - Compras'],
  WCP: ['SGI - WCP - Portaria', 'WCP - WinCP - Controle de Portaria'],
  WCR: ['SGI - WCR - Controle de Rodoviárias', null],
  WCT: ['SGI - WCT - Controle Tráfego', 'WCT - WinCT - Controle de Tráfego'],
  WCX: ['SGI - WCX - Tesouraria e Arrecadação', 'WCX - WinCX - Tesouraria e Arrecadação'],
  WCXQ: ['SGI - WCXQ - Quiosque Tesouraria', 'WCQ - WinCXQ - Quiosque de Tesouraria'],
  WEH: ['SGI - WEH - Escala de Horário', 'WEH - WinEH - Escala de Horário'],
  WEP: ['SGI - WEP - Controle de Ponto', 'WEP - WinEP - Controle de Ponto'],
  WFR: ['SGI - WFR - Fretamento e Turismo', 'WFR - WinFR - Fretamento e Turismo'],
  WFT: ['SGI - WFT - Faturamento', 'WFT - WinFT - Faturamento'],
  WGD: ['SGI - WGD - Gestão Eletrônica de Documentos', 'WGD - WinGED - Gestão Eletrônica de Documentos'],
  WLE: ['SGI - WLE - Locação de Equipamentos', 'WLE - WinLE - Locação de Equipamentos'],
  WLF: ['SGI - WLF - Livros Fiscais', 'WLF - WinLF - Livros Fiscais'],
  WLG: ['SGI - WLG - Log de Atividades', null],
  WMF: ['SGI - WMF - Manutenção de Frota', 'WMF - WinMF - Manutenção de Frota'],
  WMO: ['SGI - WMO - Mapa Controle Operacional', 'WMO - WinMCO - Mapa de Controle Operacional'],
  WPA: ['SGI - WPA - Controle de Parâmetros', null],
  WPN: ['SGI - WPN - Quiosque De Borracharia', 'WPN - WinPN - Quiosque de Borracharia'],
  WRH: ['SGI - WRH - Recursos Humanos', 'WRH - WinRH - Recursos Humanos'],
  WSV: ['SGI - WSV - Quiosque De Serviços', 'WSV - WinSV - Quiosque de Serviços'],
  WTR: ['SGI - WTR - Conhecimento De Transportes', 'WTR - WinTR - Conhecimento de Transportes'],
  WVR: ['SGI - WVR - Venda De Passagens', 'WVR - WinVR - Venda na Rodoviaria']
};

const RESUMO_LABELS = ['O QUE ESTÁ OCORRENDO', 'ONDE', 'POR QUÊ', 'POSSÍVEL SOLUÇÃO'];

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlItem = id => `${PROJ}/_workitems/edit/${id}`;

// "15/10/2026 13:12:52" do portal -> ISO com o offset de Brasilia, que nao tem horario de
// verao desde 2019. new Date() leria o dia como mes (regra de ouro #12).
function dataAzure(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(br || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00` : null;
}

// Mesmo formato dos bugs do time: "1026-002742 - Titulo do portal". O Azure corta em 255.
const tituloBug = t => `${t.number} - ${t.title || 'Sem título'}`.slice(0, 255);

// Repro Steps, no formato que o time ja usa: o tramite de escalacao colado (o formulario
// com versao, caminho e base) e, abaixo, o resumo. O contentHtml vai cru porque o campo e
// rich text do Azure, e quem o sanitiza ao gravar e o proprio Azure, que e onde ele renderiza.
function reproHtml(t, id, tramites, resumo) {
  const tr = (tramites || []).find(ehEscalacao);   // vem do mais recente para o mais antigo
  const cab = [esc(t.client), t.person && 'aberto por ' + esc(t.person), t.opening && 'em ' + esc(t.opening)].filter(Boolean).join(' · ');
  let h = `<div><b>Ticket:</b> <a href="${PORTAL_TICKET}${id}">${esc(t.number)}</a> · ${cab}</div><br>`;
  if (tr) h += `<div>${esc(tr.date)}<br>${esc(tr.author)} (${esc(tr.origin === 'privado' ? 'Privado' : tr.origin)})</div>${tr.contentHtml || esc(tr.content)}`;
  h += '<hr><div><b>Resumo (gerado pelo Claude a partir do ticket)</b></div>';
  for (const raw of String(resumo || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const label = line.replace(/[:.]+$/, '').toUpperCase();
    h += RESUMO_LABELS.includes(label) ? `<br><div><b>${esc(label)}</b></div>` : `<div>${esc(line)}</div>`;
  }
  return h;
}

function camposBug(t, id, tramites, resumo, email, anexos = []) {
  const add = (p, value) => ({ op: 'add', path: p, value });
  const [produto, tag] = MODULOS[String(t.module || '').toUpperCase()] || [];
  const abertura = dataAzure(t.opening);
  return [
    add('/fields/System.Title', tituloBug(t)),
    add('/fields/System.AreaPath', AREA),
    add('/fields/System.AssignedTo', email),
    tag && add('/fields/System.Tags', tag),
    produto && add('/fields/Custom.Produto', produto),
    t.client && add('/fields/Custom.Cliente', String(t.client)),
    add(`/fields/${F_NUM_TICKET}`, Number(id)),
    abertura && add('/fields/Custom.DataAberturaSAC', abertura),
    add(`/fields/${F_TIPO_SOLIC}`, 'SIM'),
    add('/fields/Custom.SLA', '3 - Normal'),
    add('/fields/Microsoft.VSTS.Common.Priority', 2),
    add('/fields/Microsoft.VSTS.Common.Severity', '3 - Medium'),
    add('/fields/AgileBgmRodotec.Entregagarantida', false),   // obrigatorio no processo
    add('/fields/Microsoft.VSTS.TCM.ReproSteps', reproHtml(t, id, tramites, resumo)),
    add('/relations/-', { rel: 'Hyperlink', url: PORTAL_TICKET + id, attributes: { comment: 'Ticket no portal' } }),
    ...anexos.map(a => add('/relations/-', { rel: 'AttachedFile', url: a.url, attributes: { comment: a.name } }))
  ].filter(Boolean);
}

async function az(pat, method, url, body, ctype = 'application/json', timeoutMs = 30_000) {
  try {
    const r = await fetch(url, {
      method,
      headers: { Authorization: 'Basic ' + Buffer.from(':' + pat).toString('base64'), 'Content-Type': ctype },
      body: Buffer.isBuffer(body) ? body : body && JSON.stringify(body),
      redirect: 'manual',   // token ruim as vezes vira 302 para a tela de login, nao 401
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (r.status === 401 || r.status === 203 || (r.status >= 300 && r.status < 400)) {
      return { error: 'O Azure recusou o token. Ele pode ter expirado, sido revogado ou não ter o escopo Work Items (Read & write).' };
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.message || `HTTP ${r.status}` };   // verbatim, regra de ouro #5
    return j;
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'O Azure demorou demais para responder.' : 'Sem conexão com o Azure.' };
  }
}

// Dono do token: e ele quem fica como responsavel pelo Bug.
async function dono(pat) {
  const j = await az(pat, 'GET', `${ORG}/_apis/connectionData`);
  if (j.error) return j;
  const u = j.authenticatedUser || {};
  const email = u.properties && u.properties.Account && u.properties.Account.$value;
  if (!email) return { error: 'O Azure recusou o token. Ele pode ter expirado, sido revogado ou não ter o escopo Work Items (Read & write).' };
  return { nome: u.providerDisplayName || email, email };
}

// Bug ja criado para este ticket, pelo id do portal no campo Numero ticket. Dois cliques,
// ou dois devs no mesmo ticket, nao viram dois cards.
async function bugExistente(pat, id) {
  const j = await az(pat, 'POST', `${PROJ}/_apis/wit/wiql?api-version=7.1&$top=1`, {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Autumn' AND [System.WorkItemType] = 'Bug' AND [${F_NUM_TICKET}] = ${Number(id)}`
  });
  if (j.error) return j;
  const w = (j.workItems || [])[0];
  return { id: w ? w.id : null };
}

// Teto do Azure DevOps Services para anexo por upload simples.
const MAX_ANEXO_BYTES = 60 * 1024 * 1024;

// Sobe os bytes de um anexo e devolve a url que o Bug referencia. Upload sem Bug fica
// orfao no Azure, entao quem chama confere o Bug existente antes de subir qualquer coisa.
async function subirAnexo(pat, nome, buffer) {
  if (buffer.length > MAX_ANEXO_BYTES) return { error: 'maior que 60 MB' };
  const j = await az(pat, 'POST', `${PROJ}/_apis/wit/attachments?fileName=${encodeURIComponent(nome)}&api-version=7.1`,
    buffer, 'application/octet-stream', 180_000);
  return j.error ? j : { url: j.url };
}

async function criarBug(pat, email, t, id, tramites, resumo, anexos) {
  const j = await az(pat, 'POST', `${PROJ}/_apis/wit/workitems/$Bug?api-version=7.1`,
    camposBug(t, id, tramites, resumo, email, anexos), 'application/json-patch+json');
  if (j.error) return j;
  return { id: j.id, url: urlItem(j.id) };
}

module.exports = { MODULOS, dataAzure, tituloBug, reproHtml, camposBug, dono, bugExistente, urlItem, subirAnexo, criarBug };
