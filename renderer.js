'use strict';

const REFRESH_MS = 5 * 60 * 1000;
const AGE_TICK_MS = 60 * 1000;
// Espelham os tetos de ipc/status.js: quem reprova e o main, aqui e so para a tela nao
// oferecer o que vai ser descartado.
const MAX_STATUS = 12;
const MAX_NOME_STATUS = 24;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const icon = (name, cls) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#' + name);
  svg.appendChild(use);
  return svg;
};

let tickets = null;      // null = nunca carregou
let loadedAt = null;
let loading = false;
let timer = null;
let current = null;      // ticket aberto no detalhe
let detail = null;       // { tramites, views }

// Abas. A Fila e a posicao null; cada aba guarda o ticket e a UI daquele ticket — busca,
// origem e rolagem. Os tramites nao moram aqui: quem os guarda e o detailCache, por
// id + lastUpdate, e e ele que torna a troca de aba instantanea.
let abas = [];
let ativa = null;
let arrastando = null;   // o no sendo arrastado; ver renderTabs()

/* ---------- datas e envelhecimento ---------- */

// O portal manda "DD/MM/YYYY HH:mm:ss" — nao e parseavel por new Date().
const parseBR = s => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : null;
};

const minutesSince = s => {
  const d = parseBR(s);
  if (!d || isNaN(d)) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
};

const ageLabel = min => {
  if (min == null) return '—';
  if (min < 1) return 'agora';
  if (min < 60) return min + 'min';
  if (min < 1440) return Math.floor(min / 60) + 'h';
  return Math.floor(min / 1440) + 'd';
};

const ageBucket = min => {
  if (min == null) return 'none';
  if (min < 240) return 'fresh';       // ate 4h
  if (min < 1440) return 'warm';       // ate 1 dia
  if (min < 4320) return 'stale';      // ate 3 dias
  return 'critical';
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const statusKey = s => {
  const n = norm(s);
  if (n.includes('andamento')) return 'andamento';
  if (n.includes('cliente')) return 'cliente';
  if (n.includes('conclu')) return 'concluido';
  if (n.includes('aberto')) return 'aberto';
  return 'outro';
};

/* ---------- status pessoal ---------- */

// { defs: [{ id, nome, cor }], por: { "<numero>": "<id>" } } — vem do main na abertura e
// e regravado inteiro a cada mudanca. E marca do usuario sobre o ticket, nao dado do
// portal: o numero do ticket e a chave porque ele existe sempre, e o id nem sempre.
let meus = { defs: [], por: {} };

const meuDe = t => meus.defs.find(d => d.id === meus.por[t.number]) || null;
// Id interno e estavel: renomear o status nao pode soltar as marcas que ja existem.
const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const salvarMeus = () => window.api.statusSet(meus);

/* ---------- filtros ---------- */

const filters = () => ({
  q: norm($('q').value.trim()),
  resp: $('fResp').value,
  client: $('fClient').value,
  status: $('fStatus').value,
  meu: $('fMeu').value
});

const matches = (t, f) =>
  (!f.resp || t.responsible === f.resp) &&
  (!f.client || t.client === f.client) &&
  (!f.status || t.status === f.status) &&
  (!f.meu || meus.por[t.number] === f.meu) &&
  (!f.q || norm([t.number, t.title, t.client, t.module, t.person, t.responsible, t.status].join(' ')).includes(f.q));

// labelOf existe so para o filtro do status pessoal: ali o valor e o id, que e interno, e
// o rotulo e o nome que o usuario deu. Nos outros tres valor e rotulo sao a mesma string.
function fillSelect(sel, values, allLabel, labelOf = v => v) {
  const keep = sel.value;
  sel.textContent = '';
  sel.appendChild(new Option(allLabel, ''));
  for (const v of values) sel.appendChild(new Option(labelOf(v), v));
  sel.value = values.includes(keep) ? keep : '';
  sel.dataset.active = sel.value ? '1' : '0';
}

// Valores distintos de um campo, na ordem do pt-BR. Usado pelos selects de filtro.
const uniq = key => [...new Set((tickets || []).map(t => t[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

function syncSelects() {
  fillSelect($('fResp'), uniq('responsible'), 'Todos responsáveis');
  fillSelect($('fClient'), uniq('client'), 'Todos clientes');
  fillSelect($('fStatus'), uniq('status'), 'Todos status');
  // So os status que estao marcados em algum ticket da fila — mesma regra dos outros
  // tres, que saem dos tickets e nao de uma lista fixa. Filtrar por marca que ninguem tem
  // so devolve "nenhum resultado".
  const emUso = meus.defs.filter(d => (tickets || []).some(t => meus.por[t.number] === d.id)).map(d => d.id);
  fillSelect($('fMeu'), emUso, 'Todos os meus status', id => (meus.defs.find(d => d.id === id) || {}).nome || id);
}

/* ---------- render ---------- */

// A rota /scrape-custom nao devolve id; ele so existe dentro do link do portal.
const ticketId = t => (/\/TicketPrincipal\/(\d+)/.exec(t.link || '') || [])[1] || null;

function ticketRow(t) {
  const min = minutesSince(t.lastUpdate);
  const row = el('div', 'row');
  row.setAttribute('role', 'listitem');
  row.tabIndex = 0;
  row.dataset.age = ageBucket(min);
  row.addEventListener('click', e => { if (!e.target.closest('a')) abrirAba(t); });
  row.addEventListener('keydown', e => { if (e.key === 'Enter') abrirAba(t); });
  row.addEventListener('contextmenu', e => { e.preventDefault(); abrirCtx(e, t); });

  const head = el('div', 'row-head');
  const a = el('a', 'tnum');
  a.href = t.link || '#';
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.title = 'Abrir no portal';
  a.append(t.number || '—', icon('i-external'));
  head.append(a, el('span', 'title', t.title || 'Sem título'));

  const meta = el('div', 'meta');
  meta.append(el('span', 'cli', t.client || '—'), el('span', 'dot', '/'), el('span', 'mod', t.module || '—'));
  if (t.responsible) meta.append(el('span', 'dot', '/'), el('span', 'who', t.responsible));
  if (t.person) meta.append(el('span', 'dot', '/'), el('span', 'per', t.person));

  // A marca do usuario vem antes e leva a cor; o status do portal continua na linha, em
  // --text-faint. Um item colorido por linha — dois pontos coloridos lado a lado seriam
  // duas coisas disputando a mesma leitura periferica.
  const st = el('div', 'status');
  const meu = meuDe(t);
  if (meu) {
    const m = el('span', 'mine', meu.nome);
    m.style.color = meu.cor;
    st.dataset.mine = '1';
    st.append(m, el('span', 'dot', '/'));
  }
  const portal = el('span', 'portal', t.status || 'sem status');
  portal.dataset.s = statusKey(t.status);
  st.appendChild(portal);

  const age = el('div', 'age');
  age.append(el('span', 'n', ageLabel(min)), el('span', 'l', 'parado'));
  age.title = 'Última atualização: ' + (t.lastUpdate || '—') + '\nAbertura: ' + (t.opening || '—');

  row.append(head, meta, st, age);
  return row;
}

function showState(kind, iconName, title, body, actionLabel, onAction) {
  showStateIn('state', kind, iconName, title, body, actionLabel, onAction);
}

function showStateIn(id, kind, iconName, title, body, actionLabel, onAction) {
  const s = $(id);
  s.textContent = '';
  s.dataset.kind = kind;
  s.hidden = false;
  s.append(icon(iconName), el('h2', null, title));
  if (body) s.appendChild(el('p', null, body));
  if (actionLabel) {
    const b = el('button', 'btn', actionLabel);
    b.addEventListener('click', onAction);
    s.appendChild(b);
  }
}

function showNotice(kind, text, actionLabel, onAction) {
  showNoticeIn('notice', kind, text, actionLabel, onAction);
}

function showNoticeIn(id, kind, text, actionLabel, onAction) {
  const n = $(id);
  n.dataset.kind = kind;
  n.hidden = false;
  n.querySelector('span').textContent = text;
  const b = n.querySelector('button');
  b.hidden = !actionLabel;
  b.disabled = false;   // a faixa e reusada: quem desabilitou o botao antes nao pode prender o proximo
  if (actionLabel) {
    b.textContent = actionLabel;
    b.onclick = onAction;
  }
}

// A faixa e um no so e tres coisas a disputam: erro de refresh, erro da atualizacao e
// "existe versao nova". O que acabou de acontecer ganha a vez — mas o aviso de versao nao e
// um evento, e um fato que continua verdade, entao ele volta sozinho no proximo load limpo.
const clearNotice = () => { novaVersao ? showUpdate() : ($('notice').hidden = true); };

const wrap = (cls, child) => { const n = el('div', cls); n.appendChild(child); return n; };

function skeleton() {
  const list = $('list');
  for (let i = 0; i < 6; i++) {
    const row = el('div', 'row skel');
    const head = el('div', 'row-head');
    head.append(el('span', 'sk sk-num'), el('span', 'sk sk-title'));
    row.append(head, wrap('meta', el('span', 'sk sk-meta')), wrap('status', el('span', 'sk sk-status')), wrap('age', el('span', 'sk sk-age')));
    list.appendChild(row);
  }
}

function render() {
  renderTabs();
  const list = $('list');
  list.textContent = '';
  $('state').hidden = true;

  if (tickets === null) {
    $('filters').hidden = true;
    $('count').textContent = '—';
    if (loading) skeleton();
    return;
  }

  $('count').textContent = tickets.length;
  $('filters').hidden = tickets.length === 0;

  if (tickets.length === 0) {
    $('matchcount').textContent = '';
    showState('empty', 'i-inbox', 'Fila limpa', 'Nenhum ticket aguardando o time de desenvolvimento no momento.');
    return;
  }

  const f = filters();
  const visible = tickets
    .filter(t => matches(t, f))
    .sort((a, b) => (minutesSince(b.lastUpdate) ?? -1) - (minutesSince(a.lastUpdate) ?? -1));

  $('matchcount').textContent = visible.length === tickets.length
    ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`
    : `${visible.length} de ${tickets.length}`;

  if (visible.length === 0) {
    showState('empty', 'i-filter-off', 'Nenhum resultado', 'Os filtros ativos não casam com nenhum dos ' + tickets.length + ' tickets em aberto.', 'Limpar filtros', clearFilters);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const t of visible) frag.appendChild(ticketRow(t));
  list.appendChild(frag);
}

function clearFilters() {
  $('q').value = '';
  for (const id of ['fResp', 'fClient', 'fStatus', 'fMeu']) {
    $(id).value = '';
    $(id).dataset.active = '0';
  }
  render();
}

/* ---------- menu do botao direito ---------- */

// Popover nativo: top layer (o #scroll rola e cortaria um filho posicionado), Esc e
// clique fora ja resolvidos pelo light-dismiss. Um <dialog> abriria no centro da tela,
// longe da linha que o usuario acabou de apontar.
function abrirCtx(e, t) {
  if (!t.number) return;                   // sem numero nao ha chave para guardar a marca
  const ctx = $('ctx');
  if (ctx.matches(':popover-open')) ctx.hidePopover();
  ctx.textContent = '';
  ctx.appendChild(el('div', 'ctx-head', t.number));

  const atual = meus.por[t.number] || '';
  for (const d of meus.defs) ctx.appendChild(ctxItem(d, d.id === atual, () => marcar(t, d.id)));
  if (atual) ctx.appendChild(ctxItem(null, false, () => marcar(t, '')));
  if (!meus.defs.length) ctx.appendChild(el('p', 'ctx-none', 'Nenhum status definido ainda.'));

  const cfg = el('button', 'ctx-item ctx-cfg', 'Editar status…');
  cfg.type = 'button';
  cfg.addEventListener('click', () => { ctx.hidePopover(); openConfig(); });
  ctx.appendChild(cfg);

  // Mede depois de aberto: fechado o popover nao tem tamanho, e sem o tamanho nao da para
  // saber se ele caberia abaixo do cursor.
  ctx.style.left = '0px';
  ctx.style.top = '0px';
  ctx.showPopover();
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(e.clientY, innerHeight - r.height - 8)) + 'px';
  // A tecla de menu do Windows dispara este mesmo evento na linha em foco, sem cursor:
  // sem levar o foco para dentro, o menu abriria inalcancavel pelo teclado.
  ctx.querySelector('.ctx-item').focus();
}

// def null e o item de limpar — mesma linha, sem cor, para nao virar um segundo idioma.
function ctxItem(d, marcado, onPick) {
  const b = el('button', d ? 'ctx-item' : 'ctx-item ctx-limpar');
  b.type = 'button';
  b.setAttribute('role', 'menuitemradio');
  b.setAttribute('aria-checked', marcado ? 'true' : 'false');
  const dot = el('span', 'ctx-dot');
  if (d) dot.style.background = d.cor;
  b.append(dot, el('span', 'ctx-nome', d ? d.nome : 'Sem status'));
  if (marcado) { b.dataset.on = '1'; b.appendChild(icon('i-check', 'ctx-check')); }
  b.addEventListener('click', onPick);
  return b;
}

function marcar(t, id) {
  $('ctx').hidePopover();
  if (id) meus.por[t.number] = id;
  else delete meus.por[t.number];
  salvarMeus();
  syncSelects();
  render();
}

/* ---------- anexos ---------- */

// Tipo derivado da extensao: o portal nao devolve mime na listagem.
const KINDS = [
  ['image', 'f-image', /^(png|jpe?g|gif|webp|bmp|svg)$/],
  ['video', 'f-video', /^(mp4|webm|mov|ogg|ogv|mkv)$/],
  ['audio', 'f-video', /^(mp3|wav|m4a|aac|oga)$/],
  ['pdf', 'f-pdf', /^pdf$/],
  ['sheet', 'f-sheet', /^(xlsx|xlsm|xls|ods)$/],
  ['doc', 'f-doc', /^docx$/],
  ['xml', 'f-code', /^(xml|xsd|xsl|html?|svgz)$/],
  ['text', 'f-code', /^(txt|log|sql|csv|tsv|json|md|ini|conf|cfg|yml|yaml|bat|ps1|cs|js|ts|css)$/],
  ['archive', 'f-zip', /^(zip|rar|7z|gz|tar)$/]
];

function kindOf(ext) {
  for (const [kind, icon, re] of KINDS) if (re.test(ext)) return { kind, icon };
  return { kind: 'other', icon: 'f-file' };
}

const PREVIEWABLE = new Set(['image', 'video', 'audio', 'pdf', 'sheet', 'doc', 'xml', 'text']);

function anexoChip(a) {
  const { kind, icon: ic } = kindOf(a.ext);
  const chip = el('button', 'chip');
  chip.type = 'button';
  chip.dataset.preview = PREVIEWABLE.has(kind) ? '1' : '0';
  chip.title = [a.name, [a.size, a.uploadedAt && 'enviado em ' + a.uploadedAt].filter(Boolean).join(' · ')]
    .filter(Boolean).join('\n');
  chip.append(icon(ic), el('span', 'n', a.name), el('span', 's', a.size || ''));
  chip.addEventListener('click', () => openViewer(a, kind, ic));
  return chip;
}

function renderAnexos(list) {
  const box = $('dAnexos');
  box.hidden = list.length === 0;
  if (!list.length) return;

  $('dAnexosCount').textContent = list.length === 1 ? '1 anexo' : `${list.length} anexos`;
  const strip = $('dAnexosStrip');
  strip.textContent = '';
  for (const a of list) strip.appendChild(anexoChip(a));
}

function viewerMessage(iconName, title, body, extra) {
  const m = el('div', 'v-msg');
  m.append(icon(iconName), el('h3', null, title));
  if (body) m.appendChild(el('p', null, body));
  if (extra) m.appendChild(el('code', null, extra));
  return m;
}

// Zoom na roda + arrasto, como no praxioscript. Sem biblioteca.
function imageViewer(src) {
  const wrap = el('div', 'v-image');
  const img = el('img');
  img.src = src;
  img.draggable = false;
  wrap.appendChild(img);

  let scale = 1, x = 0, y = 0, dragging = false, px = 0, py = 0;
  const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    scale = Math.min(6, Math.max(0.4, scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    if (scale === 1) { x = y = 0; }
    apply();
  }, { passive: false });

  wrap.addEventListener('pointerdown', e => {
    dragging = true; px = e.clientX; py = e.clientY;
    wrap.classList.add('dragging');
    wrap.setPointerCapture(e.pointerId);
  });
  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    x += e.clientX - px; y += e.clientY - py; px = e.clientX; py = e.clientY;
    apply();
  });
  const stop = () => { dragging = false; wrap.classList.remove('dragging'); };
  wrap.addEventListener('pointerup', stop);
  wrap.addEventListener('pointercancel', stop);
  wrap.addEventListener('dblclick', () => { scale = 1; x = y = 0; apply(); });

  return wrap;
}

// Indenta XML cru: o portal entrega NF-e numa linha só de dezenas de milhares de
// caracteres. Elemento de folha (<tag>texto</tag>) fica numa linha só.
function prettyXml(src) {
  const tokens = String(src).replace(/>\s+</g, '><').trim().split(/(<[^>]+>)/).filter(t => t !== '');
  const lines = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i];
    const pad = () => '  '.repeat(depth);

    if (!tag.startsWith('<')) { lines.push(pad() + tag.trim()); continue; }

    if (tag.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(pad() + tag);
      continue;
    }

    const meta = tag.startsWith('<?') || tag.startsWith('<!') || tag.endsWith('/>');
    const text = !tokens[i + 1]?.startsWith('<') ? tokens[i + 1] : null;
    const close = tokens[i + (text ? 2 : 1)];

    if (!meta && close?.startsWith('</')) {
      lines.push(pad() + tag + (text ?? '') + close);
      i += text ? 2 : 1;
      continue;
    }

    lines.push(pad() + tag);
    if (!meta) depth++;
  }

  return lines.join('\n');
}

function sheetTabs(sheets, onPick) {
  const tabs = $('viewerTabs');
  tabs.textContent = '';
  if (sheets.length < 2) return;
  sheets.forEach((s, i) => {
    const b = el('button', null, s.name);
    b.type = 'button';
    b.setAttribute('aria-selected', String(i === 0));
    b.addEventListener('click', () => {
      for (const o of tabs.children) o.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-selected', 'true');
      onPick(s);
    });
    tabs.appendChild(b);
  });
}

async function openViewer(a, kind, iconName) {
  const url = `anexo://portal/${a.id}?ext=${encodeURIComponent(a.ext || '')}`;
  const body = $('viewerBody');
  const token = {};
  openViewer.token = token;

  $('viewerName').textContent = a.name;
  $('viewerMeta').textContent = [a.size, a.uploadedAt].filter(Boolean).join(' · ');
  $('viewerIconUse').setAttribute('href', '#' + iconName);
  $('viewerPortal').href = current && current.link ? current.link : '#';
  $('viewerTabs').textContent = '';
  body.textContent = '';
  if (!$('viewer').open) $('viewer').showModal();

  const show = node => { if (openViewer.token === token) { body.textContent = ''; body.appendChild(node); } };

  if (kind === 'image') return show(imageViewer(url));

  if (kind === 'video' || kind === 'audio') {
    const w = el('div', 'v-media');
    const m = el(kind === 'video' ? 'video' : 'audio');
    m.src = url;
    m.controls = true;
    w.appendChild(m);
    return show(w);
  }

  if (kind === 'pdf') {
    const f = el('iframe', 'v-frame');
    f.src = url;
    return show(f);
  }

  show(viewerMessage(iconName, 'Carregando…', a.size ? `${a.size} vindo do portal.` : null));

  if (kind === 'text' || kind === 'xml') {
    const res = await window.api.anexoText(a.id);
    if (openViewer.token !== token) return;
    if (res.error) return show(viewerMessage('i-alert', 'Não foi possível ler o arquivo', res.error));
    return show(el('pre', 'v-text', kind === 'xml' ? prettyXml(res.text) : res.text));
  }

  if (kind === 'sheet' || kind === 'doc') {
    const res = await window.api.anexoHtml(a.id, kind === 'sheet' ? 'sheet' : 'doc');
    if (openViewer.token !== token) return;
    if (res.error) return show(viewerMessage('i-alert', 'Não foi possível abrir', res.error));

    const paint = s => {
      const w = el('div', kind === 'sheet' ? 'v-sheet' : 'v-doc');
      w.appendChild(sanitizeHtml(s.html));   // saida do SheetJS/mammoth tambem passa pelo sanitizador
      show(w);
    };
    sheetTabs(res.sheets, paint);
    return paint(res.sheets[0]);
  }

  show(viewerMessage(iconName, 'Sem pré-visualização', `Arquivos .${a.ext || '?'} não abrem dentro do app. Use o portal para baixar.`));
}

function closeViewer() {
  openViewer.token = null;
  $('viewer').close();
  $('viewerBody').textContent = '';   // para video/audio/pdf que continuariam rodando
  $('viewerTabs').textContent = '';
}

/* ---------- detalhe do ticket ---------- */

function metaPair(k, v, mono) {
  const frag = document.createDocumentFragment();
  frag.append(el('span', 'k', k), el('span', mono ? 'mono' : null, v || '—'));
  return frag;
}

function renderDetailHeader(t) {
  const min = minutesSince(t.lastUpdate);
  $('dNum').textContent = t.number || '—';
  $('dTitle').textContent = t.title || 'Sem título';
  $('dAge').textContent = 'parado há ' + ageLabel(min);
  $('dAge').dataset.age = ageBucket(min);
  $('dPortal').href = t.link || '#';

  const m = $('dMeta');
  m.textContent = '';
  m.append(metaPair('cliente', t.client));
  m.append(el('span', 'dot', '/'), metaPair('módulo', t.module, true));
  m.append(el('span', 'dot', '/'), metaPair('resp', t.responsible, true));
  m.append(el('span', 'dot', '/'), metaPair('solicitante', t.person));
  m.append(el('span', 'dot', '/'), metaPair('status', t.status));
  m.append(el('span', 'dot', '/'), metaPair('abertura', t.opening, true));
  m.append(el('span', 'dot', '/'), metaPair('última atualização', t.lastUpdate, true));
}

function tramiteEntry(tr) {
  const art = el('article', 'tr');
  const head = el('div', 'tr-head');
  const badge = el('span', 'badge', tr.origin || 'sem origem');
  badge.dataset.o = tr.origin || '';
  head.append(badge, el('span', 'tr-date', tr.date || '—'), el('span', 'tr-author', tr.author || '—'));
  if (tr.status) head.appendChild(el('span', 'tr-status', tr.status));

  const body = el('div', 'tr-body');
  // contentHtml vem cru do portal; sanitizeHtml e a fronteira de confianca.
  if (tr.contentHtml) body.appendChild(sanitizeHtml(tr.contentHtml));
  else body.textContent = tr.content || '';

  art.append(head, body);

  // Anexos deste tramite especifico (a faixa do topo continua mostrando todos).
  if (tr.anexos?.length) {
    const box = el('div', 'tr-anexos');
    box.append(el('span', 'tr-anexos-label', tr.anexos.length === 1 ? '1 anexo' : `${tr.anexos.length} anexos`));
    for (const a of tr.anexos) box.appendChild(anexoChip(a));
    art.appendChild(box);
  }

  return art;
}

function renderTramites() {
  const box = $('tramites');
  box.textContent = '';
  $('dState').hidden = true;
  if (!detail) return;

  const all = detail.tramites;
  const q = norm($('dq').value.trim());
  const origin = $('dOrigin').value;
  const visible = all.filter(tr =>
    (!origin || tr.origin === origin) &&
    (!q || norm([tr.content, tr.author, tr.status, tr.date].join(' ')).includes(q))
  );

  $('dFilters').hidden = all.length === 0;
  $('dCount').textContent = visible.length === all.length
    ? `${all.length} trâmite${all.length === 1 ? '' : 's'}`
    : `${visible.length} de ${all.length}`;

  if (all.length === 0) {
    showStateIn('dState', 'empty', 'i-thread', 'Nenhum trâmite', 'Este ticket ainda não tem histórico registrado no portal.');
    return;
  }
  if (visible.length === 0) {
    showStateIn('dState', 'empty', 'i-filter-off', 'Nenhum resultado', `Os filtros não casam com nenhum dos ${all.length} trâmites.`, 'Limpar filtros', () => {
      $('dq').value = '';
      $('dOrigin').value = '';
      $('dOrigin').dataset.active = '0';
      renderTramites();
    });
    return;
  }

  const frag = document.createDocumentFragment();
  for (const tr of visible) frag.appendChild(tramiteEntry(tr));  // ja vem do mais recente para o mais antigo
  box.appendChild(frag);
}

function renderViews() {
  const d = $('dViews');
  const list = detail ? detail.views : [];
  d.hidden = list.length === 0;
  if (!list.length) return;
  $('dViewsLabel').textContent = `Visto por ${list.length} ${list.length === 1 ? 'vez' : 'vezes'} · último: ${list[0].usuario} em ${list[0].data}`;
  const grid = el('div', 'views-grid');
  for (const v of list) grid.append(el('span', 'u', v.usuario), el('span', 'd', v.data));
  const body = $('dViewsBody');
  body.textContent = '';
  body.appendChild(grid);
}

// A faixa de anexos sai dos proprios tramites. Ela vinha de /anexos/:id, que devolve
// exatamente os mesmos arquivos numa request extra — e request extra custa caro aqui: o
// portal e ASP.NET e serializa o que divide a sessao, entao a chamada de anexos entrava na
// fila na frente dos tramites. Unica perda: uploadedAt, que o partial por tramite nao traz.
const anexosDe = tramites => (tramites || []).flatMap(tr => tr.anexos || []);

// Reabrir um ticket nao deve refazer o scraping inteiro. lastUpdate e a unica invalidacao
// possivel — a API nao tem cache nem ETag — e e honesta: se o portal nao registrou trâmite
// novo, os tramites sao os mesmos. Sem lastUpdate nao ha como saber, entao nao cacheia.
const detailCache = new Map();
function cacheGet(id, lastUpdate) {
  const hit = lastUpdate ? detailCache.get(id) : null;
  return hit && hit.lastUpdate === lastUpdate ? hit.detail : null;
}
function cachePut(id, lastUpdate, d) {
  if (lastUpdate) detailCache.set(id, { lastUpdate, detail: d });
}

async function openDetail(t, refazer, ui) {
  const id = ticketId(t);
  current = t;
  detail = null;
  $('listView').hidden = true;
  $('detailView').hidden = false;
  $('dq').value = ui ? ui.q : '';
  $('dOrigin').value = ui ? ui.origin : '';
  $('dOrigin').dataset.active = $('dOrigin').value ? '1' : '0';
  $('dFilters').hidden = true;
  $('dViews').hidden = true;
  $('dAnexos').hidden = true;
  $('tramites').textContent = '';
  $('dScroll').scrollTop = 0;
  renderDetailHeader(t);
  $('back').focus();
  $('dResumir').disabled = true;   // so libera quando os tramites chegam

  if (!id) {
    showStateIn('dState', 'error', 'i-alert', 'Ticket sem id', 'O portal não devolveu um link com id numérico para este ticket, então não dá para buscar os trâmites.');
    return;
  }

  const cache = refazer ? null : cacheGet(id, t.lastUpdate);
  if (cache) {
    detail = cache;
    $('dResumir').disabled = false;
    renderTramites();
    if (ui) $('dScroll').scrollTop = ui.top;
    renderAnexos(anexosDe(cache.tramites));
    renderViews();
    return;
  }

  $('dLoadbar').hidden = false;
  showStateIn('dState', 'empty', 'i-thread', 'Carregando trâmites…', 'Buscando o histórico no portal.');

  const res = await window.api.loadDetail(id);
  $('dLoadbar').hidden = true;
  if (current !== t) return;               // usuario ja saiu ou abriu outro

  if (res.error) {
    const txt = res.error === 'NO_KEY' ? 'Chave da API não configurada.' : res.error;
    showStateIn('dState', 'error', 'i-alert', 'Não foi possível carregar o ticket', txt, 'Tentar de novo', () => openDetail(t, true));
    return;
  }

  const d = { tramites: res.tramites, views: [] };
  detail = d;
  cachePut(id, t.lastUpdate, d);
  $('dResumir').disabled = false;
  renderTramites();
  if (ui) $('dScroll').scrollTop = ui.top;
  renderAnexos(anexosDe(res.tramites));

  // Visualizacoes sao acessorias e entram na mesma fila do portal: so agora, com os
  // tramites ja na tela. Chegam no objeto cacheado mesmo que o usuario ja tenha saido.
  const v = await window.api.loadViews(id);
  if (!v.error) d.views = v.views;
  if (current === t) renderViews();
}

function closeDetail() {
  current = null;
  detail = null;
  openResumo.token = null;
  $('detailView').hidden = true;
  $('listView').hidden = false;
}

/* ---------- abas ---------- */

// Qual aba fica ativa depois de fechar a de indice i, numa barra com n abas. null = a Fila.
// Fechar aba inativa nao troca de aba; fechar a ativa cai na vizinha da direita, ou na da
// esquerda quando ela era a ultima — o mesmo que o navegador faz.
const aposFechar = (n, ativa, i) =>
  ativa === null ? null :
  i > ativa ? ativa :
  i < ativa ? ativa - 1 :
  n === 1 ? null : Math.min(i, n - 2);

// ponytail: localStorage no lugar de services/ + ipc/ com limpar() fail-closed, que e o
// padrao do repo para estado persistido (status.json). Aqui o dado e uma lista de numeros
// de ticket e a propria restauracao valida: numero que nao esta na fila carregada nao vira
// aba. Se um dia o main precisar ler as abas, migra para o padrao.
const salvarAbas = () => {
  try { localStorage.setItem('tickets.abas', JSON.stringify({ n: abas.map(a => a.t.number), a: ativa })); } catch {}
};

// Busca, origem e rolagem vivem no DOM, nao em objeto — sair de uma aba sem passar por aqui
// perde os tres.
function guardarUI() {
  if (ativa === null) return;
  const a = abas[ativa];
  a.q = $('dq').value;
  a.origin = $('dOrigin').value;
  a.top = $('dScroll').scrollTop;
}

function irPara(i) {
  if (i === ativa) return;
  guardarUI();
  ativa = i;
  if (i === null) closeDetail();
  else openDetail(abas[i].t, false, abas[i]);
  renderTabs();
  salvarAbas();
}

function abrirAba(t) {
  // A chave e o numero, nao o objeto: load() troca os objetos da fila inteira a cada
  // refresh, e comparar por identidade abriria o mesmo ticket numa segunda aba.
  const i = abas.findIndex(a => a.t.number === t.number);
  if (i >= 0) return irPara(i);
  guardarUI();
  abas.push({ t, q: '', origin: '', top: 0 });
  ativa = abas.length - 1;
  openDetail(t, false, null);
  renderTabs();
  salvarAbas();
}

function fecharAba(i) {
  const proxima = aposFechar(abas.length, ativa, i);
  if (ativa !== i) guardarUI();          // a aba ativa continua na tela: o que ela tem, fica
  abas.splice(i, 1);
  ativa = proxima;
  if (proxima === null) closeDetail();
  else if (abas[proxima].t !== current) openDetail(abas[proxima].t, false, abas[proxima]);
  renderTabs();
  salvarAbas();
}

// So a primeira carga restaura. Numero salvo que nao esta na fila nao vira aba — e a
// validacao inteira, e por isso nao ha limpar() aqui: lixo no localStorage nao casa nada.
function restaurarAbas() {
  if (restaurarAbas.feito) return;
  restaurarAbas.feito = true;
  let salvo = null;
  try { salvo = JSON.parse(localStorage.getItem('tickets.abas')); } catch {}
  if (!salvo || !Array.isArray(salvo.n)) return;
  abas = salvo.n
    .map(num => tickets.find(t => t.number === num))
    .filter(Boolean)
    .map(t => ({ t, q: '', origin: '', top: 0 }));
  renderTabs();
  if (Number.isInteger(salvo.a) && abas[salvo.a]) irPara(salvo.a);
}

function renderTabs() {
  if (arrastando) return;                // repintar no meio do arrasto mataria o gesto
  // render() e o unico gancho da barra — e ele roda a cada tecla da busca da lista e a cada
  // minuto, pelo tick da idade. A chave corta o repintar quando nada que a aba mostra mudou.
  const chave = ativa + '|' + abas.map(a => {
    const meu = meuDe(a.t);
    return [a.t.number, a.t.client, meu && meu.cor].join(':');
  }).join(',');
  if (renderTabs.chave === chave) return;
  renderTabs.chave = chave;

  const bar = $('tabs');
  while (bar.children.length > 1) bar.lastElementChild.remove();
  $('tabFila').setAttribute('aria-selected', ativa === null ? 'true' : 'false');

  abas.forEach((a, i) => {
    const b = el('div', 'tab');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === ativa ? 'true' : 'false');
    b.tabIndex = 0;
    b.draggable = true;
    b.dataset.n = a.t.number;
    b.title = a.t.title || '';

    // Um sinal so na aba: a marca do usuario. Envelhecimento fica na lista e no "parado ha"
    // do detalhe — ambar numa barra sempre visivel viraria enfeite, e ambar so envelhece.
    const meu = meuDe(a.t);
    if (meu) {
      const d = el('span', 'ctx-dot');
      d.style.background = meu.cor;
      b.appendChild(d);
    }
    b.append(el('span', 't-num', a.t.number), el('span', 't-n', a.t.client || '—'));

    const x = el('button', 'mchip-x');
    x.type = 'button';
    x.title = 'Fechar (Ctrl+W)';
    x.setAttribute('aria-label', 'Fechar aba');
    x.appendChild(icon('i-close'));
    x.addEventListener('click', e => { e.stopPropagation(); fecharAba(i); });

    b.appendChild(x);
    b.addEventListener('click', () => irPara(i));
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irPara(i); } });
    b.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); fecharAba(i); } });

    // Reordenar arrastando. Enquanto o gesto corre, so o no do DOM se move: reconstruir a
    // barra aqui destruiria o elemento arrastado e o arrasto morreria no meio. O array e
    // refeito no dragend, a partir da ordem final da barra.
    b.addEventListener('dragstart', () => { arrastando = b; });
    b.addEventListener('dragover', e => {
      e.preventDefault();
      if (!arrastando || arrastando === b) return;
      const r = b.getBoundingClientRect();
      bar.insertBefore(arrastando, e.clientX > r.left + r.width / 2 ? b.nextSibling : b);
    });
    b.addEventListener('dragend', () => {
      arrastando = null;
      renderTabs.chave = null;
      const ordem = [...bar.querySelectorAll('.tab[data-n]')].map(no => no.dataset.n);
      const numAtivo = ativa === null ? null : abas[ativa].t.number;
      abas.sort((x, y) => ordem.indexOf(String(x.t.number)) - ordem.indexOf(String(y.t.number)));
      if (numAtivo !== null) ativa = abas.findIndex(a => a.t.number === numAtivo);
      renderTabs();
      salvarAbas();
    });

    bar.appendChild(b);
  });
}

/* ---------- resumo do ticket ---------- */

const RESUMO_LABELS = ['O QUE ESTÁ OCORRENDO', 'ONDE', 'POR QUÊ', 'POSSÍVEL SOLUÇÃO'];

// O modelo devolve o rotulo sozinho numa linha e a prosa embaixo. Se ele fugir do formato,
// o texto orfao vira bloco sem rotulo: nada pode sumir da tela por causa do parser.
function parseResumo(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const label = line.replace(/[:.]+$/, '').toUpperCase();
    if (RESUMO_LABELS.includes(label)) { out.push({ k: label, body: '' }); continue; }
    if (!out.length) { out.push({ k: '', body: line }); continue; }
    const cur = out[out.length - 1];
    cur.body += (cur.body ? ' ' : '') + line;
  }
  return out.filter(b => b.k || b.body);
}

function paintResumo(blocos) {
  const body = $('resumoBody');
  body.textContent = '';
  for (const b of blocos) {
    if (b.k) body.appendChild(el('h3', 'rs-k', b.k));
    if (b.body) body.appendChild(el('p', 'rs-p', b.body));
    if (b.skel) {
      const sk = el('div', 'rs-skel');
      sk.append(el('span'), el('span'));
      body.appendChild(sk);
    }
  }
  $('resumoState').hidden = true;
  body.hidden = false;
}

function setResumindo(on) {
  $('resumoLoadbar').hidden = !on;
  $('resumoRedo').disabled = on;
  $('dResumir').disabled = on;
  $('dResumirLabel').textContent = on ? 'Resumindo…' : 'Resumir';
  // A hotfix leva o texto do resumo junto; enquanto ele nao existe nao ha o que levar.
  if (on) $('resumoHotfix').disabled = true;
}

// Pede o aceite antes de qualquer chamada: o conteudo do ticket sai da maquina.
async function pedirResumo() {
  if (await window.api.claudeOk()) return openResumo(false);
  $('claudeAsk').showModal();
}

async function openResumo(refazer) {
  const t = current;
  const id = t && ticketId(t);
  if (!id) return;

  const token = {};
  openResumo.token = token;

  $('resumoTitle').textContent = t.title || 'Sem título';
  if (!$('resumo').open) $('resumo').showModal();

  // Refazer sobre um resumo ja na tela mantem o texto antigo enquanto o novo nao chega:
  // mesma regra da lista, um refresh que falha nunca esvazia o que ja estava visivel.
  // O carimbo "resumido em" fica junto — texto velho com data em branco mente sobre a idade.
  const tinhaTexto = Boolean($('resumoBody').querySelector('.rs-p'));
  if (!tinhaTexto) {
    $('resumoMeta').textContent = '';
    paintResumo(RESUMO_LABELS.map(k => ({ k, skel: true })));
  }
  $('resumoNotice').hidden = true;
  setResumindo(true);

  const tram = (detail && detail.tramites) || [];
  let res = await window.api.resumo(id, t, tram, Boolean(refazer));

  // O main so pede o repositorio quando vai mesmo gerar: resumo em cache abre sem pergunta
  // nenhuma. A barra para enquanto o dialog esta aberto — ela significa "o app esta
  // trabalhando", e aqui quem esta e o usuario.
  if (res.error === 'NEED_REPO') {
    setResumindo(false);
    const idx = await escolherRepo(true);
    if (openResumo.token !== token) return;
    // Desistir de um Refazer nao pode apagar o resumo que ja estava na tela — mesma regra
    // do refresh da lista. Sem texto anterior nao ha o que segurar, entao fecha.
    if (idx === null) {
      if (tinhaTexto) $('resumoHotfix').disabled = false;
      else closeResumo();
      return;
    }
    setResumindo(true);
    res = await window.api.resumo(id, t, tram, Boolean(refazer), idx);
  }

  if (openResumo.token !== token) return;   // usuario fechou ou abriu outro ticket
  setResumindo(false);

  if (res.error === 'NO_CONSENT') {
    $('resumo').close();
    $('claudeAsk').showModal();
    return;
  }
  if (res.error) {
    if (tinhaTexto) {
      showNoticeIn('resumoNotice', 'down', 'Não foi possível refazer: ' + res.error + ' O resumo abaixo é o anterior.');
      $('resumoHotfix').disabled = false;   // o resumo anterior continua valendo como briefing
      return;
    }
    $('resumoBody').hidden = true;
    showStateIn('resumoState', 'error', 'i-alert', 'Não foi possível resumir', res.error, 'Tentar de novo', () => openResumo(true));
    return;
  }

  paintResumo(parseResumo(res.text));
  $('resumoHotfix').disabled = false;
  // Só o carimbo: o numero do ticket ja esta na barra do detalhe, logo acima.
  $('resumoMeta').textContent = res.at ? 'resumido em ' + fmtQuando(res.at) : '';
  // Desatualizado nao se conserta sozinho: a chamada custa, entao quem decide e o usuario.
  if (res.stale) {
    showNoticeIn('resumoNotice', 'stale', 'Este resumo é anterior ao último trâmite do ticket. Use Refazer para atualizar.');
  }
}

// ISO do cache -> "10/09/2026 15:22", o mesmo formato que o portal usa no resto da tela.
function fmtQuando(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function closeResumo() {
  openResumo.token = null;
  setResumindo(false);
  $('resumoNotice').hidden = true;
  $('resumoBody').textContent = '';   // senao o proximo ticket abre com o resumo do anterior
  $('resumoHotfix').disabled = true;
  $('resumo').close();
}

/* ---------- hotfix a partir do resumo ---------- */

// Codigos que o main devolve quando a hotfix nem chegou a comecar. Erro de git no meio da
// sequencia nao esta aqui de proposito: ele vem como texto do proprio git e vai para a
// faixa, nao para um dialog.
const HOTFIX_CODIGOS = new Set(['NO_RESUMO', 'NO_SLUG', 'NO_REPO', 'NO_DEEPLINK', 'NO_DIR', 'NO_GIT', 'NO_GITFLOW', 'NO_GITFLOW_INIT']);

// Cada um destes tem um conserto diferente. Um "não foi possível criar a hotfix" para todos
// faria o usuario adivinhar qual — a mesma razao da regra de ouro #5.
function hotfixErro(res) {
  switch (res.error) {
    case 'NO_RESUMO': return ['Sem resumo para levar',
      'A hotfix entrega o resumo do ticket ao Claude, e este ticket ainda não tem um. Gere o resumo primeiro.'];
    case 'NO_SLUG': return ['Ticket sem número utilizável',
      'O portal não devolveu para este ticket um número que sirva de nome de branch.'];
    case 'NO_REPO': return ['Nenhum repositório apontado',
      'Abra Configurações → Repositórios e aponte a pasta local onde a hotfix deve nascer.'];
    case 'NO_DEEPLINK': return ['O Claude ainda não se registrou nesta máquina',
      'O app abre o Claude por um link do sistema, e esse link só passa a existir depois que você roda "claude" num terminal e envia um prompt. Faça isso uma vez e tente de novo.'];
    case 'NO_DIR': return ['A pasta do repositório não existe',
      'O caminho apontado em Configurações não está acessível: drive desconectado, ou o repositório ainda não foi clonado.', res.repo];
    case 'NO_GIT': return ['Isso não é um repositório git',
      'A pasta existe, mas não tem um .git dentro. Confira o caminho em Configurações.', res.repo];
    case 'NO_GITFLOW': return ['git flow não está instalado',
      'O comando não respondeu nesta máquina. Ele precisa estar no PATH do processo do Tickets, não só no seu terminal — depois de instalar, reabra o app.'];
    case 'NO_GITFLOW_INIT': return ['Este repositório não usa git flow',
      'Falta rodar "git flow init" nele. Sem isso o comando pararia numa pergunta que ninguém pode responder daqui, então o app cancela antes de travar.', res.repo];
    default: return ['Não foi possível criar a hotfix', res.error];
  }
}

// Um dialog para os quatro momentos que cercam a hotfix: escolher o repositorio, avisar do
// stash, e explicar o que impediu. Quatro telas para o mesmo instante ("antes de comecar,
// isto") seriam quatro lugares para procurar a mesma resposta.
//
// Devolve uma promessa: o valor do select no confirmar, `true` quando nao ha select, e
// null quando o usuario desiste — Cancelar, Esc ou clique fora dao no mesmo. Assim quem
// chama le a pergunta de cima para baixo, sem calistenia de callback.
//
// O rotulo do botao de sair muda com o que ele faz: ha o que cancelar quando existe uma
// acao pendente, e so o que fechar quando o dialog e informacao. Mesma decisao do #cfg.
let hotfixAskResp = null;
const responderAsk = v => { const r = hotfixAskResp; hotfixAskResp = null; if (r) r(v); };

function abrirHotfixAsk(titulo, texto, codigo, confirmLabel, opcoes) {
  responderAsk(null);                     // pergunta nova nao deixa a anterior pendurada
  $('hotfixAsk').close();                 // showModal num dialog ja aberto lanca
  $('hotfixAskTitle').textContent = titulo;
  const p = $('hotfixAskText');
  p.textContent = texto;
  if (codigo) p.append(el('br'), el('code', null, codigo));   // caminho e dado medido: mono

  const sel = $('hotfixAskRepo');
  sel.textContent = '';
  $('hotfixAskSel').hidden = !opcoes;
  for (const o of opcoes || []) sel.appendChild(new Option(o.t, o.v));

  const yes = $('hotfixAskYes');
  yes.hidden = !confirmLabel;
  if (confirmLabel) yes.textContent = confirmLabel;
  $('hotfixAskNo').textContent = confirmLabel ? 'Cancelar' : 'Fechar';
  $('hotfixAsk').showModal();
  return new Promise(r => { hotfixAskResp = r; });
}

// Qual dos repositorios salvos usar. Devolve o INDICE na lista que o main acabou de
// mandar — e ele quem tem os caminhos, e e essa ordem que hotfix-start vai reler.
//
// `semRepo` e o resumo: la a doc do repositorio e precisao a mais, entao "sem repositório"
// e uma opcao e lista vazia nem chega a perguntar. A hotfix nao tem esse caminho: sem
// repositorio nao ha onde criar a branch.
async function escolherRepo(semRepo) {
  const { repos = [] } = await window.api.getRepos();
  if (!repos.length) {
    if (semRepo) return -1;
    const [titulo, texto] = hotfixErro({ error: 'NO_REPO' });
    abrirHotfixAsk(titulo, texto, null, null);
    return null;
  }

  const opcoes = repos.map((r, i) => ({ v: String(i), t: r.path }));
  if (semRepo) opcoes.push({ v: '-1', t: 'Sem repositório' });

  const v = await abrirHotfixAsk('Em qual repositório?',
    semRepo ? 'O resumo lê os .md da raiz do repositório para chamar as units pelo nome.'
            : 'A branch nasce da produção deste repositório, e o Claude abre dentro dele.',
    null, 'Continuar', opcoes);
  return v === null ? null : Number(v);
}

function setHotfixando(on) {
  $('resumoLoadbar').hidden = !on;
  $('resumoHotfix').disabled = on;
  $('resumoHotfixLabel').textContent = on ? 'Abrindo…' : 'Hotfix';
}

async function pedirHotfix() {
  const t = current;
  const id = t && ticketId(t);
  if (!id) return;

  const idx = await escolherRepo(false);
  if (idx === null) return;

  setHotfixando(true);
  const res = await window.api.hotfixProbe(id, t, idx);
  setHotfixando(false);

  if (res.error) return hotfixFalhou(res);

  // Workspace limpo nao tem o que avisar: nada vai ser guardado, entao nao ha pergunta.
  if (res.dirty) {
    const n = res.dirty === 1 ? '1 arquivo alterado' : `${res.dirty} arquivos alterados`;
    const ok = await abrirHotfixAsk('Guardar as alterações antes?',
      `Este repositório tem ${n} em ${res.branch}. Tudo vai para um stash antes de criar ${res.alvo} — nada se perde, e "git stash pop" traz de volta.`,
      res.repo, 'Guardar e criar');
    if (!ok) return;
  }

  // t e id vao junto: entre as duas perguntas o usuario pode ter trocado de aba, e reler
  // `current` aqui criaria a hotfix do ticket errado.
  setHotfixando(true);
  const r = await window.api.hotfixStart(id, t, idx);
  setHotfixando(false);

  if (r.error) return hotfixFalhou(r);
  closeResumo();   // sucesso nao tem faixa: o terminal abrindo e a confirmacao
}

function hotfixFalhou(res) {
  if (HOTFIX_CODIGOS.has(res.error)) {
    const [titulo, texto, codigo] = hotfixErro(res);
    return abrirHotfixAsk(titulo, texto, codigo, null);
  }
  // Depois que o stash existe, um erro que nao o cita faz o usuario achar que perdeu o
  // trabalho. A faixa e a mesma do "nao foi possivel refazer": o resumo continua atras dela.
  const onde = res.stash ? ` Suas alterações estão no stash "${res.stash}" — "git stash pop" traz de volta.` : '';
  showNoticeIn('resumoNotice', 'down', 'Não foi possível criar a hotfix: ' + res.error + onde);
}

/* ---------- atualizacao ---------- */

let novaVersao = null;   // { version, local, url } enquanto houver release mais nova
let baixando = false;

// Faixa ambar, o mesmo variante do resumo desatualizado: neste app ambar significa "o que
// voce esta vendo e velho", e um app atras da release e exatamente isso. Diz as duas
// versoes porque o app nao mostra a propria em lugar nenhum — "1.1.0 disponivel" sozinho
// nao responde o quanto ficou para tras.
function showUpdate() {
  if (!novaVersao) return;
  showNotice('stale', `Versão ${novaVersao.version} disponível — esta é a ${novaVersao.local}.`,
    baixando ? 'Baixando…' : 'Instalar e reabrir', aplicarUpdate);
  $('noticeAction').disabled = baixando;
}

// O rotulo diz que o app vai fechar, em vez de uma frase avisando disso: o .exe tem ~97 MB,
// a espera e de um minuto e o app se fecha sozinho no fim. Descobrir isso depois do clique
// seria susto. "Atualizar" esta fora de cogitacao — e o nome do botao da barra, 40px acima,
// que recarrega a lista.
async function aplicarUpdate() {
  if (baixando) return;
  baixando = true;
  showUpdate();

  const res = await window.api.updateApply(novaVersao.url);
  baixando = false;

  // Sucesso nao tem faixa: o app fecha e reabre sozinho, e isso e a confirmacao.
  if (res.error) showNotice('down', 'Não foi possível atualizar: ' + res.error, 'Tentar de novo', aplicarUpdate);
  else showUpdate();
}

// Uma vez por abertura. Sem release, sem rede ou sem novidade a tela nao muda: a checagem
// nao pode custar nada a quem so quer ver os tickets. E nao pinta por cima de uma faixa que
// ja esta na tela — quem estava ali e mais urgente, e o aviso volta no proximo load limpo.
async function checkUpdate() {
  const res = await window.api.updateCheck();
  if (res.error || res.atual || !res.url) return;
  novaVersao = res;
  if ($('notice').hidden) showUpdate();
}

/* ---------- carga ---------- */

function setLoading(on) {
  loading = on;
  $('loadbar').hidden = !on;
  $('refresh').disabled = on;
  $('refreshLabel').textContent = on ? 'Atualizando…' : 'Atualizar';
  $('refresh').querySelector('svg').classList.toggle('spin', on);
}

// Ticket novo = numero que nao estava na carga anterior. A primeira carga (prev null) nunca
// notifica: a fila inteira seria "nova" toda vez que o app abre. Um refresh que falha nao
// mexe em `tickets`, entao ele tambem nao inventa novidade na carga seguinte.
const ticketsNovos = (prev, next) => {
  if (!prev) return [];
  const vistos = new Set(prev.map(t => t.number || t.link));
  return (next || []).filter(t => !vistos.has(t.number || t.link));
};

// O som e o do toast do Windows — a tela vive num segundo monitor, o aviso precisa ser
// audivel. Nao passa pela regra #8: isso nao e movimento na tela, e notificacao do SO.
function notificar(novos) {
  for (const t of novos) {
    new Notification('Ticket novo · ' + (t.number || '—'),
      { body: [t.client, t.title].filter(Boolean).join(' — ') });
  }
}

async function load() {
  if (loading) return;
  setLoading(true);
  if (tickets === null) render();

  const res = await window.api.loadTickets();
  if (res.error) {
    setLoading(false);
    return onError(res.error, res.status);
  }

  clearNotice();
  notificar(ticketsNovos(tickets, res.tickets));
  // O lastUpdate do grid atrasa dias. Ate a data real chegar, a linha mostra a do refresh
  // anterior ou "—", nunca a errada.
  const antes = new Map((tickets || []).map(t => [t.number, t.lastUpdate]));
  const grid = res.tickets.map(t => t.lastUpdate);
  for (const t of res.tickets) t.lastUpdate = (t.number && antes.get(t.number)) || null;
  tickets = res.tickets;
  // Cada refresh troca os objetos da fila inteira. Sem reapontar, a aba seguraria o objeto
  // da carga anterior com o lastUpdate congelado, e o detailCache nunca invalidaria.
  // ponytail: a aba ativa nao e reapontada de verdade — o guarda de corrida de openDetail
  // compara identidade de objeto, e mexer em current no meio de um fetch em voo prenderia a
  // tela em "Carregando tramites...". O cabecalho dela so se atualiza ao sair e voltar, ou
  // com F5. Se incomodar, o caminho e o guarda passar a comparar t.number.
  for (const a of abas) a.t = tickets.find(x => x.number === a.t.number) || a.t;
  loadedAt = new Date();
  $('updated').textContent = 'atualizado ' + loadedAt.toLocaleTimeString('pt-BR');
  syncSelects();
  render();
  restaurarAbas();

  // A barra segue ligada ate as datas chegarem: o refresh seguinte nao comeca com elas em
  // voo. Ticket sem data (falhou, ou veio sem id) fica com a do grid.
  const ids = tickets.map(ticketId);
  const { datas = {} } = await window.api.lastTramites(ids.filter(Boolean));
  tickets.forEach((t, i) => { t.lastUpdate = datas[ids[i]] || t.lastUpdate || grid[i]; });
  setLoading(false);
  render();
}

function onError(error, status) {
  const isKeyProblem = status === 403 || /chave de autentica|authorization ausente/i.test(error);
  const stale = tickets !== null;

  if (error === 'NO_KEY') {
    tickets = null;
    render();
    showState('empty', 'i-key', 'Configure a chave da API',
      'O app precisa da chave de 104 caracteres para ler os tickets do portal.',
      'Configurar chave', openConfig);
    return;
  }

  // Uma falha de refresh nunca apaga a lista que ja esta na tela.
  if (isKeyProblem) {
    const msg = 'Chave rejeitada pela API.';
    stale ? showNotice('down', msg, 'Trocar chave', openConfig)
          : showState('error', 'i-key', msg, 'A chave tem o tamanho certo, mas o servidor não a aceitou.', 'Trocar chave', openConfig);
    return;
  }

  if (/sem conexao|sem conexão|demorou demais/i.test(error)) {
    stale ? showNotice('down', error + ' Mostrando a última lista carregada.', 'Tentar de novo', load)
          : showState('error', 'i-offline', error, 'Verifique a rede e o endereço portalapi.188720391.xyz.', 'Tentar de novo', load);
    return;
  }

  // Erro do proprio servidor (ex.: 401 "Falha no login" = o portal recusou o login DA API).
  // Renderizado verbatim: nao e problema da chave do usuario.
  stale ? showNotice('down', 'A API respondeu: ' + error, 'Tentar de novo', load)
        : showState('error', 'i-alert', 'A API não conseguiu buscar os tickets', error, 'Tentar de novo', load);
}

/* ---------- configuracao ---------- */

// Espelho da tela enquanto o dialog esta aberto. Nao e estado do app: some ao fechar.
let cfgRepos = [];
let keySaved = false;

// A chave NUNCA chega ao renderer (regra de ouro #1) — hasKey() devolve boolean e mais
// nada. Estas 104 bolinhas sao geradas aqui e so dizem "ja existe uma chave gravada".
const KEY_MASK = '•'.repeat(104);
const mascarado = () => $('cfgKey').value === KEY_MASK;

function mascarar() {
  const inp = $('cfgKey');
  inp.value = KEY_MASK;
  inp.dataset.mask = '1';
  $('cfgCount').textContent = 'chave configurada';
  $('cfgSave').disabled = false;
  $('cfgSave').textContent = 'Salvar';
}

function desmascarar() {
  const inp = $('cfgKey');
  inp.value = '';
  inp.dataset.mask = '0';
  $('cfgCount').textContent = '0 / 104';
}

async function openConfig() {
  const dlg = $('cfg');
  $('cfgError').textContent = '';
  $('cfgField').dataset.invalid = '0';
  desmascarar();
  $('cfgSave').disabled = true;
  $('cfgSave').textContent = 'Salvar e carregar';
  if (!dlg.open) dlg.showModal();

  const [temChave, res] = await Promise.all([window.api.hasKey(), window.api.getRepos()]);
  keySaved = temChave;
  // Com chave gravada nao ha nada a fazer neste campo, entao ele nao rouba o foco; sem
  // ela, colar a chave e a unica tarefa da tela.
  if (keySaved) mascarar();
  else $('cfgKey').focus();

  window.api.appVersion().then(v => { $('cfgVersion').textContent = v; });

  cfgRepos = res.repos || [];
  renderRepos();
  renderStatus();
}

function renderRepos() {
  const box = $('cfgRepos');
  box.textContent = '';
  if (!cfgRepos.length) {
    box.appendChild(el('p', 'repo-none', 'Nenhum repositório apontado.'));
    return;
  }
  cfgRepos.forEach((r, i) => box.appendChild(repoRow(r, i)));
}

function repoRow(r, i) {
  const row = el('div', 'repo');
  row.dataset.i = i;

  const inp = el('input', 'repo-input');
  inp.type = 'text';
  inp.value = r.path || '';
  inp.spellcheck = false;
  inp.placeholder = 'C:\dev\praxio\Autumn.SIGAi';
  inp.setAttribute('aria-label', 'Caminho do repositório');

  const pick = el('button', 'btn btn-ghost', 'Procurar…');
  pick.type = 'button';               // dentro de <form method="dialog"> o default fecharia o dialog
  pick.dataset.act = 'pick';

  const del = el('button', 'btn btn-ghost btn-icon');
  del.type = 'button';
  del.dataset.act = 'del';
  del.title = 'Remover repositório';
  del.setAttribute('aria-label', 'Remover repositório');
  del.appendChild(icon('i-close'));

  const path = el('div', 'repo-path');
  path.append(inp, pick, del);

  row.append(path);
  return row;
}

// Le a tela, sem filtrar: o indice de cada linha tem que continuar batendo com o
// data-i do DOM. Quem descarta caminho vazio e o ipc, na gravacao.
const collectRepos = () => [...$('cfgRepos').querySelectorAll('.repo')].map(row => ({
  path: row.querySelector('.repo-input').value.trim()
}));

// Autosave: o rodape governa so a chave. Ninguem espera apertar Salvar numa lista de
// repositorios, e salvar em lote junto com a chave faria o campo vazio derrubar tudo.
function saveRepos() {
  cfgRepos = collectRepos();
  return window.api.setRepos(cfgRepos);
}



// Diferente dos repositorios, aqui o espelho da tela E o estado do app: a lista pinta a
// lista de tickets atras do dialog, entao editar e mexer em `meus` e repintar as duas.
function renderStatus() {
  const box = $('cfgStatus');
  box.textContent = '';
  if (!meus.defs.length) {
    box.appendChild(el('p', 'repo-none', 'Nenhum status definido.'));
    return;
  }
  meus.defs.forEach((d, i) => box.appendChild(statusRow(d, i)));
}

function statusRow(d, i) {
  const row = el('div', 'st');
  row.dataset.i = i;

  const cor = el('input', 'st-cor');
  cor.type = 'color';
  cor.value = d.cor;
  cor.setAttribute('aria-label', 'Cor de ' + d.nome);

  const nome = el('input', 'st-nome');
  nome.type = 'text';
  nome.value = d.nome;
  nome.maxLength = 24;
  nome.spellcheck = false;
  nome.setAttribute('aria-label', 'Nome do status');

  const del = el('button', 'btn btn-ghost btn-icon');
  del.type = 'button';                  // dentro de <form method="dialog"> o default fecharia o dialog
  del.dataset.act = 'delst';
  del.title = 'Remover ' + d.nome;
  del.setAttribute('aria-label', 'Remover ' + d.nome);
  del.appendChild(icon('i-close'));

  row.append(cor, nome, del);
  return row;
}

// Autosave, como os repositorios: o rodape governa so a chave.
function saveStatus(repintar) {
  salvarMeus();
  if (!repintar) return;
  syncSelects();
  render();
}

async function saveConfig() {
  await saveRepos();   // pega a linha que o usuario editou e ainda nao largou

  // Chave intocada: nada a revalidar, e refazer o fetch de ~3,5s seria cobrar por uma
  // mudanca que nao houve. Campo apagado tambem conta como intocado — apagar sem querer
  // nao pode derrubar a chave que ja funciona.
  const key = $('cfgKey').value.trim();
  if (keySaved && (mascarado() || !key)) return $('cfg').close();

  const res = await window.api.setKey(key);
  if (res.error) {
    $('cfgError').textContent = res.error;
    $('cfgField').dataset.invalid = '1';
    $('cfgKey').focus();
    return;
  }
  keySaved = true;
  $('cfg').close();
  clearNotice();
  load();
}

/* ---------- ligacao ---------- */

function wire() {
$('refresh').addEventListener('click', load);
$('settings').addEventListener('click', openConfig);
$('q').addEventListener('input', render);

for (const id of ['fResp', 'fClient', 'fStatus']) {
  $(id).addEventListener('change', e => {
    e.target.dataset.active = e.target.value ? '1' : '0';
    render();
  });
}

// Clique fora fecha qualquer dialog: com padding 0 no <dialog>, so o backdrop tem o
// proprio elemento como alvo do clique. O mousedown entra na conta porque arrastar uma
// selecao de texto de dentro para fora solta o click no backdrop — e isso nao e desistir.
// Fechar sempre e o caminho de cancelar: cada dialog resolve o pendente no evento 'close'.
let downNoBackdrop = false;
document.addEventListener('mousedown', e => { downNoBackdrop = e.target.tagName === 'DIALOG'; });
document.addEventListener('click', e => {
  if (downNoBackdrop && e.target.tagName === 'DIALOG') e.target.close();
});

$('back').addEventListener('click', () => irPara(null));
$('viewerClose').addEventListener('click', closeViewer);
$('viewer').addEventListener('close', closeViewer);   // Esc nativo do <dialog>
$('dResumir').addEventListener('click', pedirResumo);
$('resumoClose').addEventListener('click', closeResumo);
$('resumo').addEventListener('close', closeResumo);
$('resumoRedo').addEventListener('click', () => openResumo(true));
$('resumoHotfix').addEventListener('click', pedirHotfix);
$('hotfixAskNo').addEventListener('click', () => $('hotfixAsk').close());
$('hotfixAskForm').addEventListener('submit', e => {
  e.preventDefault();
  // Responde ANTES de fechar: o close abaixo dispara o handler que resolve com null, e
  // responderAsk zera o pendente — quem chegar primeiro e a resposta que vale.
  responderAsk($('hotfixAskSel').hidden ? true : $('hotfixAskRepo').value);
  $('hotfixAsk').close();
});
// Cancelar, Esc e clique fora sao a mesma resposta: o usuario desistiu.
$('hotfixAsk').addEventListener('close', () => responderAsk(null));
$('claudeAskNo').addEventListener('click', () => $('claudeAsk').close());
$('claudeAskForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('claudeAsk').close();
  await window.api.claudeAllow();
  openResumo(false);
});
$('dq').addEventListener('input', renderTramites);
$('dOrigin').addEventListener('change', e => {
  e.target.dataset.active = e.target.value ? '1' : '0';
  renderTramites();
});

$('cfgForm').addEventListener('submit', e => { e.preventDefault(); saveConfig(); });
$('cfgCancel').addEventListener('click', () => $('cfg').close());
// Clicar no campo mascarado limpa para colar por cima; sair sem digitar nada devolve a
// mascara, para o dialog nao passar a mentir que nao ha chave.
$('cfgKey').addEventListener('focus', () => { if (mascarado()) desmascarar(); });
$('cfgKey').addEventListener('blur', () => { if (keySaved && !$('cfgKey').value.trim()) mascarar(); });

$('cfgKey').addEventListener('input', e => {
  // O showModal() ja da foco a este campo antes da mascara chegar, entao o evento 'focus'
  // nao dispara e digitar concatenaria com as bolinhas. Quem digita quer a chave nova.
  if (e.target.value.includes('•')) e.target.value = e.target.value.replace(/•/g, '');
  const n = e.target.value.trim().length;
  e.target.dataset.mask = '0';
  $('cfgCount').textContent = n + ' / 104';
  // Com chave ja gravada o botao nunca bloqueia: o que ele confirma pode ser so os
  // repositorios. Sem chave, nao ha o que salvar ate colarem alguma coisa.
  $('cfgSave').disabled = !keySaved && n === 0;
  // "e carregar" so aparece quando vai mesmo recarregar — chave nova completa.
  $('cfgSave').textContent = n === 104 || !keySaved ? 'Salvar e carregar' : 'Salvar';
  if (n === 104) { $('cfgError').textContent = ''; $('cfgField').dataset.invalid = '0'; }
});

$('cfgAddRepo').addEventListener('click', () => {
  cfgRepos = collectRepos();
  cfgRepos.push({ path: '' });
  renderRepos();
  const linhas = $('cfgRepos').querySelectorAll('.repo-input');
  linhas[linhas.length - 1].focus();
});

// Delegado: as linhas sao remontadas a cada mudanca, entao listener por botao vazaria.
$('cfgRepos').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const row = b.closest('.repo');
  const i = +row.dataset.i;

  if (b.dataset.act === 'del') {
    cfgRepos = collectRepos();
    cfgRepos.splice(i, 1);
    renderRepos();
    saveRepos();
  } else if (b.dataset.act === 'pick') {
    const res = await window.api.pickDir();
    if (!res.path) return;                 // cancelou: nada muda
    row.querySelector('.repo-input').value = res.path;
    saveRepos();
  }
});

$('cfgAddStatus').addEventListener('click', () => {
  if (meus.defs.length >= MAX_STATUS) return;
  meus.defs.push({ id: novoId(), nome: 'Novo status', cor: '#5aa9ff' });
  renderStatus();
  const campos = $('cfgStatus').querySelectorAll('.st-nome');
  const ultimo = campos[campos.length - 1];
  ultimo.focus();
  ultimo.select();                       // o nome nasce provisorio: digitar por cima e o caminho comum
  saveStatus(false);                     // nada muda na lista ainda: status novo nao esta marcado em ninguem
});

// Delegado: as linhas sao remontadas a cada mudanca.
$('cfgStatus').addEventListener('click', e => {
  const b = e.target.closest('button[data-act="delst"]');
  if (!b) return;
  const i = +b.closest('.st').dataset.i;
  const id = meus.defs[i].id;
  meus.defs.splice(i, 1);
  // Apagar o status apaga as marcas dele — o main descartaria essas linhas na gravacao de
  // qualquer jeito, e a tela nao pode ficar mostrando uma marca que ja nao existe.
  for (const n of Object.keys(meus.por)) if (meus.por[n] === id) delete meus.por[n];
  renderStatus();
  saveStatus(true);
});

$('cfgStatus').addEventListener('change', e => {
  const row = e.target.closest('.st');
  if (!row) return;
  const d = meus.defs[+row.dataset.i];
  if (e.target.classList.contains('st-cor')) d.cor = e.target.value;
  else if (e.target.classList.contains('st-nome')) d.nome = e.target.value.trim().slice(0, MAX_NOME_STATUS) || d.nome;
  renderStatus();
  saveStatus(true);
});

$('cfgStatus').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('st-nome')) return;
  e.preventDefault();                    // Enter aqui submeteria o <form method="dialog">
  e.target.blur();                       // o blur dispara o change, que grava
});

$('cfgRepos').addEventListener('change', e => {
  if (e.target.classList.contains('repo-input')) saveRepos();
});

$('tabFila').addEventListener('click', () => irPara(null));

const inDetail = () => !$('detailView').hidden;

document.addEventListener('keydown', e => {
  // Dialogs e o menu cuidam do proprio Esc — o popover fecha sozinho no light-dismiss.
  if ($('cfg').open || $('viewer').open || $('resumo').open || $('claudeAsk').open || $('ctx').matches(':popover-open')) return;
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
    e.preventDefault();
    if (!inDetail()) load();
    else if (current) {
      if (ativa !== null) Object.assign(abas[ativa], { q: '', origin: '', top: 0 });
      openDetail(current, true);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    const box = inDetail() ? $('dq') : $('q');
    box.focus();
    box.select();
    return;
  }
  // Abas. A porta la de cima ja barrou dialog e menu abertos, entao um atalho daqui nunca
  // troca de ticket deixando o visualizador ou o resumo do anterior na tela.
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (ativa !== null) fecharAba(ativa);
    return;
  }
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const n = abas.length + 1;                       // a Fila e a primeira da roda
    const pos = (ativa === null ? 0 : ativa + 1) + (e.shiftKey ? -1 : 1);
    const alvo = (pos + n) % n;
    irPara(alvo === 0 ? null : alvo - 1);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    const i = +e.key - 1;                            // Ctrl+1 e a Fila
    if (i === 0) irPara(null);
    else if (abas[i - 1]) irPara(i - 1);
    return;
  }
  if (e.key !== 'Escape') return;
  const box = inDetail() ? $('dq') : $('q');
  if (document.activeElement === box && box.value) {   // 1o Esc limpa a busca
    box.value = '';
    inDetail() ? renderTramites() : render();
  } else if (inDetail()) {                             // 2o Esc volta para a Fila, sem fechar a aba
    irPara(null);
  }
});

// Idade e o dado principal desta tela: recalcula sozinha, sem bater na API.
setInterval(() => { if (tickets && tickets.length && !loading) render(); }, AGE_TICK_MS);
timer = setInterval(load, REFRESH_MS);

load();
checkUpdate();
window.api.statusGet().then(b => {
  meus = b;
  if (tickets) { syncSelects(); render(); }
});
}

if (typeof document !== 'undefined') wire();
if (typeof module !== 'undefined') module.exports = { aposFechar, ticketsNovos, parseBR, minutesSince, ageLabel, ageBucket, statusKey, norm, matches, prettyXml, kindOf, parseResumo, anexosDe, cacheGet, cachePut, showNoticeIn };
