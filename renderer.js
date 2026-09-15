'use strict';

const REFRESH_MS = 5 * 60 * 1000;
const AGE_TICK_MS = 60 * 1000;

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

/* ---------- filtros ---------- */

const filters = () => ({
  q: norm($('q').value.trim()),
  resp: $('fResp').value,
  client: $('fClient').value,
  status: $('fStatus').value
});

const matches = (t, f) =>
  (!f.resp || t.responsible === f.resp) &&
  (!f.client || t.client === f.client) &&
  (!f.status || t.status === f.status) &&
  (!f.q || norm([t.number, t.title, t.client, t.module, t.person, t.responsible, t.status].join(' ')).includes(f.q));

function fillSelect(sel, values, allLabel) {
  const keep = sel.value;
  sel.textContent = '';
  sel.appendChild(new Option(allLabel, ''));
  for (const v of values) sel.appendChild(new Option(v, v));
  sel.value = values.includes(keep) ? keep : '';
  sel.dataset.active = sel.value ? '1' : '0';
}

function syncSelects() {
  const uniq = key => [...new Set(tickets.map(t => t[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  fillSelect($('fResp'), uniq('responsible'), 'Todos responsáveis');
  fillSelect($('fClient'), uniq('client'), 'Todos clientes');
  fillSelect($('fStatus'), uniq('status'), 'Todos status');
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
  row.addEventListener('click', e => { if (!e.target.closest('a')) openDetail(t); });
  row.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(t); });

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

  const st = el('div', 'status', t.status || 'sem status');
  st.dataset.s = statusKey(t.status);

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
  if (actionLabel) {
    b.textContent = actionLabel;
    b.onclick = onAction;
  }
}

const clearNotice = () => { $('notice').hidden = true; };

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
  for (const id of ['fResp', 'fClient', 'fStatus']) {
    $(id).value = '';
    $(id).dataset.active = '0';
  }
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

async function openDetail(t, refazer) {
  const id = ticketId(t);
  current = t;
  detail = null;
  $('listView').hidden = true;
  $('detailView').hidden = false;
  $('dq').value = '';
  $('dOrigin').value = '';
  $('dOrigin').dataset.active = '0';
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

  const res = await window.api.resumo(id, t, (detail && detail.tramites) || [], Boolean(refazer));
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
      return;
    }
    $('resumoBody').hidden = true;
    showStateIn('resumoState', 'error', 'i-alert', 'Não foi possível resumir', res.error, 'Tentar de novo', () => openResumo(true));
    return;
  }

  paintResumo(parseResumo(res.text));
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
  $('resumo').close();
}

/* ---------- carga ---------- */

function setLoading(on) {
  loading = on;
  $('loadbar').hidden = !on;
  $('refresh').disabled = on;
  $('refreshLabel').textContent = on ? 'Atualizando…' : 'Atualizar';
  $('refresh').querySelector('svg').classList.toggle('spin', on);
}

async function load() {
  if (loading) return;
  setLoading(true);
  if (tickets === null) render();

  const res = await window.api.loadTickets();
  setLoading(false);

  if (res.error) return onError(res.error, res.status);

  clearNotice();
  tickets = res.tickets;
  loadedAt = new Date();
  $('updated').textContent = 'atualizado ' + loadedAt.toLocaleTimeString('pt-BR');
  syncSelects();
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

function openConfig() {
  const dlg = $('cfg');
  $('cfgKey').value = '';
  $('cfgError').textContent = '';
  $('cfgCount').textContent = '0 / 104';
  $('cfgField').dataset.invalid = '0';
  dlg.showModal();
  $('cfgKey').focus();
}

async function saveConfig() {
  const key = $('cfgKey').value.trim();
  const res = await window.api.setKey(key);
  if (res.error) {
    $('cfgError').textContent = res.error;
    $('cfgField').dataset.invalid = '1';
    $('cfgKey').focus();
    return;
  }
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

$('back').addEventListener('click', closeDetail);
$('viewerClose').addEventListener('click', closeViewer);
$('viewer').addEventListener('close', closeViewer);   // Esc nativo do <dialog>
$('dResumir').addEventListener('click', pedirResumo);
$('resumoClose').addEventListener('click', closeResumo);
$('resumo').addEventListener('close', closeResumo);
$('resumoRedo').addEventListener('click', () => openResumo(true));
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
$('cfgKey').addEventListener('input', e => {
  const n = e.target.value.trim().length;
  $('cfgCount').textContent = n + ' / 104';
  if (n === 104) { $('cfgError').textContent = ''; $('cfgField').dataset.invalid = '0'; }
});

const inDetail = () => !$('detailView').hidden;

document.addEventListener('keydown', e => {
  if ($('cfg').open || $('viewer').open || $('resumo').open || $('claudeAsk').open) return;   // dialogs cuidam do proprio Esc
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
    e.preventDefault();
    inDetail() ? (current && openDetail(current, true)) : load();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    const box = inDetail() ? $('dq') : $('q');
    box.focus();
    box.select();
    return;
  }
  if (e.key !== 'Escape') return;
  const box = inDetail() ? $('dq') : $('q');
  if (document.activeElement === box && box.value) {   // 1o Esc limpa a busca
    box.value = '';
    inDetail() ? renderTramites() : render();
  } else if (inDetail()) {                             // 2o Esc volta para a lista
    closeDetail();
  }
});

// Idade e o dado principal desta tela: recalcula sozinha, sem bater na API.
setInterval(() => { if (tickets && tickets.length && !loading) render(); }, AGE_TICK_MS);
timer = setInterval(load, REFRESH_MS);

load();
}

if (typeof document !== 'undefined') wire();
if (typeof module !== 'undefined') module.exports = { parseBR, minutesSince, ageLabel, ageBucket, statusKey, norm, matches, prettyXml, kindOf, parseResumo, anexosDe, cacheGet, cachePut };
