const { ipcMain } = require('electron');
const status = require('../services/status');

const MAX_DEFS = 12;
const MAX_NOME = 24;
const MAX_MARCAS = 500;
const ID = /^[a-z0-9]{1,16}$/;
const COR = /^#[0-9a-f]{6}$/i;

// Os quatro que o app ja traz. Servem so enquanto o arquivo nunca foi gravado: apagar
// todos e uma escolha do usuario, e um default que ressuscita sozinho nao e default, e
// teimosia. Por isso a checagem la embaixo e "existe a chave defs", nao "a lista tem item".
const DEFAULTS = [
  { id: 'olhando', nome: 'Olhando', cor: '#5aa9ff' },
  { id: 'pendente', nome: 'Pendente', cor: '#b28cff' },
  { id: 'bloqueado', nome: 'Bloqueado', cor: '#ff6b6b' },
  { id: 'resolvido', nome: 'Resolvido', cor: '#3ecf8e' }
];

// Fronteira de confianca: `cor` vai para um style inline no renderer e `id` vira seletor
// de atributo — nenhum dos dois pode ser string livre. Item ruim e descartado em silencio,
// como em set-repos: uma linha malformada nao pode derrubar a lista inteira do autosave.
function limpar(blob) {
  if (!blob || typeof blob !== 'object') return null;

  const defs = [];
  const vistos = new Set();
  for (const d of Array.isArray(blob.defs) ? blob.defs.slice(0, MAX_DEFS) : []) {
    if (!d || typeof d !== 'object') continue;
    const id = typeof d.id === 'string' ? d.id : '';
    const nome = typeof d.nome === 'string' ? d.nome.trim().slice(0, MAX_NOME) : '';
    const cor = typeof d.cor === 'string' ? d.cor.trim().toLowerCase() : '';
    if (!ID.test(id) || vistos.has(id) || !nome || !COR.test(cor)) continue;
    vistos.add(id);
    defs.push({ id, nome, cor });
  }

  // Marca para um status que nao existe mais nao e gravada: apagar o status limpa as
  // marcacoes dele, e o arquivo nao guarda referencia solta.
  const por = {};
  const marcas = blob.por && typeof blob.por === 'object' ? Object.entries(blob.por) : [];
  for (const [num, id] of marcas.slice(0, MAX_MARCAS)) {
    if (typeof id === 'string' && vistos.has(id)) por[String(num).slice(0, 32)] = id;
  }

  return { defs, por };
}

function register() {
  ipcMain.handle('status-get', () => {
    const b = status.get();
    return limpar(Array.isArray(b.defs) ? b : { ...b, defs: DEFAULTS }) || { defs: DEFAULTS, por: {} };
  });

  ipcMain.handle('status-set', (_e, blob) => {
    const limpo = limpar(blob);
    if (!limpo) return { error: 'Lista de status inválida.' };
    status.set(limpo);
    return { ok: true, ...limpo };
  });
}

module.exports = { register, limpar, DEFAULTS, MAX_DEFS, MAX_NOME };
