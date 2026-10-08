'use strict';

// Fila falsa: imita a portalapi para testar o app sem o portal. O painel em
// http://localhost:3311 cria, remove, envelhece e quebra tickets; o app le daqui com
// TICKETS_API apontado. Shapes conferidos contra docs/API.md e o portal-scraper/index.js.
//
//   node tools/fake-api.js         so o servidor
//   node tools/fake-api.js --app   servidor + painel + o app ja apontado (npm run fake)
//
// Estado so em memoria: fechar e reabrir volta para a semente.
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const PORT = Number(process.env.FAKE_PORT) || 3311;
const KEY = 'x'.repeat(104);
const PORTAL = 'https://portaldocliente.praxio.com.br/Ticket/';
const H = 3600000;
const DEV = 'PAUL.CARVALHO';

const p2 = n => String(n).padStart(2, '0');
// Formato do portal: DD/MM/YYYY HH:mm, com segundos so na grade
const br = (ms, seg) => {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
    + (seg ? `:${p2(d.getSeconds())}` : '');
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---------- anexos, gerados em memoria ----------

function png(w, h) {
  const tab = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = b => { let c = ~0; for (const x of b) c = tab[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(corpo));
    return Buffer.concat([len, corpo, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = x * 255 / w; raw[o + 1] = y * 255 / h; raw[o + 2] = 160;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// texto so ASCII: a string vai crua dentro de ( ) no stream
function pdf(texto) {
  const s = `BT /F1 18 Tf 72 760 Td (${texto}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${s.length} >>\nstream\n${s}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const off = objs.map((o, i) => { const n = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return n; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + off.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function xlsx() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Funcionário', 'Data', 'Horas'], ['João da Silva', '01/10/2026', 8], ['Maria Conceição', '02/10/2026', 6.5]
  ]), 'Escala');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Total'], [14.5]]), 'Resumo');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const ANEXOS = {
  900001: { name: 'print-escala.png', ext: 'png', type: 'image/png', gerar: () => png(480, 270) },
  900002: { name: 'Laudo tecnico.pdf', ext: 'pdf', type: 'application/pdf', gerar: () => pdf('Laudo tecnico - ticket de teste') },
  900003: { name: 'Resumo de horas.xlsx', ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', gerar: xlsx },
  // latin1 de proposito: e o caso do cp1252 que o anexo-text refaz
  900004: { name: 'consulta.sql', ext: 'sql', type: 'application/octet-stream',
    gerar: () => Buffer.from("-- Funcionários sem lançamento\nSELECT * FROM ESCALA WHERE SITUACAO = 'NÃO LANÇADO';\n", 'latin1') },
  900005: { name: 'nfe.xml', ext: 'xml', type: 'text/xml',
    gerar: () => Buffer.from('<?xml version="1.0"?><nfe><emit><cnpj>00000000000100</cnpj><nome>Viação Teste</nome></emit><total>123,45</total></nfe>') },
  900006: { name: 'log.txt', ext: 'txt', type: 'text/plain; charset=utf-8',
    gerar: () => Buffer.from('07/10/2026 10:00:01 ERRO: lançamento não encontrado para a matrícula 4411\n') },
  900007: { name: 'backup.zip', ext: 'zip', type: 'application/zip', gerar: () => Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'latin1') }
};
for (const a of Object.values(ANEXOS)) a.bytes = a.gerar();
const anexoJson = id => {
  const a = ANEXOS[id];
  return { id: String(id), name: a.name, ext: a.ext, size: `${(a.bytes.length / 1024).toFixed(2).replace('.', ',')} KB`, uploadedAt: null };
};

// ---------- fila ----------

const TITULOS = ['Funcionário sem lançamento na escala', 'Excesso de bagagem não gera cálculo de comissão',
  'Erro ao emitir BP-e em contingência', 'Relatório de vendas duplica poltrona', 'Integração com TEF cai às 18h',
  'Saldo de caixa não fecha no turno'];
const CLIENTES = ['SAO LUIZ - GO', 'VIACAO GARCIA - PR', 'REAL EXPRESSO - DF', 'EUCATUR - RO', 'GONTIJO - MG'];
const MODULOS = ['ESC', 'WCX', 'BPE', 'VDA', 'TEF', 'CXA'];
const PESSOAS = ['Divino Alves Soares', 'Marina Lopes', 'Carlos Henrique', 'Patrícia Gomes'];
const STATUS = ['Aberto', 'Em andamento', 'Aguardando cliente', 'Em análise', 'Concluído'];
const ESCALACAO = 'Versão de teste: 26.10.1\nCaminho: Cadastros > Funcionários > Escala\n'
  + 'Período de teste: 01/10/2026 a 05/10/2026\nBase de teste: SAO_LUIZ_HOMOLOG\nServidor: SRV-APP02\n'
  + 'Problema: funcionário importado não recebe lançamento na escala do dia.';

let seq, tseq, tickets, modo, atraso, proximoAnexo;

function addTramite(t, { origin = 'operador', texto, anexos = [], ts = Date.now() }) {
  const author = { cliente: t.person, operador: DEV, privado: 'ALVARO.SOARES' }[origin] || DEV;
  t.tramites.unshift({ seq: ++tseq, ts, origin, author, status: t.status, texto: texto || `Trâmite de teste ${tseq}.`, anexos });
}

function novoTicket({ titulo, horas = 0, status = 'Aberto', semId = false, anexos = [], texto } = {}) {
  const i = ++seq, ts = Date.now() - horas * H, d = new Date();
  const segue = horas > 0 || anexos.length || texto;
  const abertura = segue ? ts - 2 * H : ts;
  const t = {
    id: semId ? null : String(940000 + i),
    number: `${p2(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}-${String(1100 + i).padStart(6, '0')}`,
    title: titulo || TITULOS[i % TITULOS.length], client: CLIENTES[i % CLIENTES.length],
    module: MODULOS[i % MODULOS.length], person: PESSOAS[i % PESSOAS.length], status,
    opening: abertura, tramites: [],
    views: [{ usuario: DEV, data: br(ts, true) }, { usuario: 'ALVARO.SOARES', data: br(abertura, true) }]
  };
  addTramite(t, { origin: 'cliente', texto: `Abertura: ${t.title}.`, ts: abertura });
  if (segue) addTramite(t, { origin: 'operador', texto, anexos, ts });
  return t;
}

// Semente: uma idade por faixa do envelhecimento, um status por cor, um ticket com o
// formulario de escalacao e anexo de cada familia, e um com link sem id.
function reset() {
  seq = 0; tseq = 0; modo = 'normal'; atraso = 8; proximoAnexo = 0;
  tickets = [
    novoTicket({ horas: 0.5, status: 'Em andamento' }),
    novoTicket({ horas: 6, status: 'Aguardando cliente' }),
    novoTicket({ horas: 48, status: 'Aberto' }),
    novoTicket({ horas: 144, status: 'Em análise' }),
    novoTicket({ horas: 26, status: 'Em andamento', titulo: 'Funcionário sem lançamento na escala',
      texto: ESCALACAO, anexos: [900001, 900002, 900003] }),
    novoTicket({ horas: 10, status: 'Concluído', semId: true })
  ];
  addTramite(tickets[4], { origin: 'cliente', texto: 'Segue a consulta, o XML e o log do erro.', anexos: [900004, 900005, 900006, 900007], ts: Date.now() - 25 * H });
}

const linha = t => ({
  number: t.number, link: t.id ? `${PORTAL}TicketPrincipal/${t.id}` : `${PORTAL}Lista`, title: t.title,
  opening: br(t.opening, true), lastUpdate: br(t.tramites[0].ts, true), team: '(N4)', client: t.client,
  module: t.module, person: t.person, responsible: DEV, status: t.status, avaliacao: null, ia: false
});

const tramiteJson = (tr, index, comAnexos) => {
  const o = {
    index, id: tr.anexos.length ? String(7000000 + tr.seq) : null, date: br(tr.ts), author: tr.author,
    origin: tr.origin, status: tr.status, content: tr.texto,
    contentHtml: `<div>${esc(tr.texto).replace(/\n/g, '<br>')}</div>`
  };
  if (comAnexos && tr.anexos.length) o.anexos = tr.anexos.map(anexoJson);
  return o;
};

const porId = id => tickets.find(t => t.id === id);
const porNumero = n => tickets.find(t => t.number === n);

// ---------- painel ----------

const MODOS = {
  normal: 'Normal',
  401: '401 Falha no login (erro do servidor)',
  403: '403 chave rejeitada',
  500: '500 erro interno',
  lento: 'Lento (atraso abaixo)',
  'sem-ultimos': '/ultimos-tramites 404 (fallback por ticket)',
  offline: 'Offline (derruba a conexão)'
};

function idade(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

function painel() {
  const opts = (lista, atual) => lista.map(v => `<option${v === atual ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const form = (acao, campos, botao) =>
    `<form method="post" action="/_ctl/${acao}">${campos}<button>${botao}</button></form>`;
  const n = t => `<input type="hidden" name="number" value="${esc(t.number)}">`;
  const linhas = tickets.map(t => `<tr>
    <td><b>${esc(t.number)}</b>${t.id ? '' : ' <small>(sem id)</small>'}<br><small>${esc(t.title)}</small></td>
    <td>${idade(t.tramites[0].ts)}<br><small>${t.tramites.length} trâmites</small></td>
    <td>${form('status', n(t) + `<select name="status">${opts(STATUS, t.status)}</select>`, 'Mudar')}</td>
    <td>${form('tramite', n(t) + `<select name="origin">${opts(['cliente', 'operador', 'privado'], 'cliente')}</select>
      <input name="texto" placeholder="texto (opcional)"><label><input type="checkbox" name="anexo" value="1"> anexo</label>`, '+ Trâmite')}</td>
    <td>${form('envelhecer', n(t) + '<input name="horas" type="number" step="0.5" min="0" value="30" style="width:5em"> h', 'Envelhecer')}</td>
    <td>${form('remover', n(t), 'Remover')}</td>
  </tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fila falsa</title><style>
  body{font:14px system-ui,sans-serif;background:#0e1116;color:#d6dae0;margin:24px}
  table{border-collapse:collapse;width:100%}td{border-top:1px solid #2a3038;padding:8px;vertical-align:top}
  form{display:inline-flex;gap:6px;align-items:center;margin:0}small{color:#8a929c}
  input,select,button{background:#161b22;color:inherit;border:1px solid #2a3038;padding:4px 6px;font:inherit}
  button{cursor:pointer}button:hover{border-color:#5aa9ff}code{user-select:all;word-break:break-all}
  .barra{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}h1{font-size:18px;margin:0}
  </style></head><body>
  <h1>Fila falsa · ${tickets.length} tickets · modo: ${esc(MODOS[modo])}</h1>
  <p><small>Chave para colar no app:</small> <code>${KEY}</code><br>
  <small>Aberto por npm run fake, o app atualiza sozinho a cada 5 s. Fora dele, F5.</small></p>
  <div class="barra">
    ${form('novo', '<input name="titulo" placeholder="título (opcional)" size="36">', '+ Novo ticket')}
    ${form('modo', `<select name="modo">${Object.entries(MODOS).map(([k, v]) => `<option value="${k}"${k === modo ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input name="atraso" type="number" min="0" value="${atraso}" style="width:4em"> s`, 'Aplicar')}
    ${form('reset', '', 'Resetar')}
  </div>
  <table>${linhas || '<tr><td>Fila vazia.</td></tr>'}</table></body></html>`;
}

function controlar(acao, f) {
  const t = porNumero(f.get('number'));
  if (acao === 'novo') tickets.unshift(novoTicket({ titulo: f.get('titulo') || undefined }));
  else if (acao === 'reset') reset();
  else if (acao === 'modo') { if (MODOS[f.get('modo')]) modo = f.get('modo'); atraso = Math.max(0, Number(f.get('atraso')) || 0); }
  else if (!t) return;
  else if (acao === 'remover') tickets = tickets.filter(x => x !== t);
  else if (acao === 'status' && STATUS.includes(f.get('status'))) t.status = f.get('status');
  else if (acao === 'tramite') {
    const ids = Object.keys(ANEXOS);
    const anexos = f.get('anexo') ? [Number(ids[proximoAnexo++ % ids.length])] : [];
    addTramite(t, { origin: f.get('origin'), texto: f.get('texto'), anexos });
  } else if (acao === 'envelhecer') {
    // desloca todos juntos para o mais novo ficar N h atras sem quebrar a ordem
    const delta = Date.now() - (Number(f.get('horas')) || 0) * H - t.tramites[0].ts;
    for (const tr of t.tramites) tr.ts += delta;
    t.opening += delta;
  }
}

// ---------- servidor ----------

function criarServidor() {
  reset();
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://local');
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(painel());
    }
    if (req.method === 'POST' && u.pathname.startsWith('/_ctl/')) {
      let corpo = '';
      for await (const c of req) corpo += c;
      controlar(u.pathname.slice(6), new URLSearchParams(corpo));
      res.writeHead(303, { Location: '/' });
      return res.end();
    }

    if (modo === 'offline') return req.socket.destroy();
    if (modo === 'lento') await new Promise(r => setTimeout(r, atraso * 1000));
    if (!req.headers.authorization) return json(401, { error: 'Header Authorization ausente' });
    if (modo === '401') return json(401, { error: 'Falha no login', message: 'Não foi possível autenticar no portal' });
    if (modo === '403') return json(403, { error: 'Chave de autenticacao invalida' });
    if (modo === '500') return json(500, { error: 'Erro interno no scraping' });

    let m;
    if ((m = /^\/scrape-custom\/(\d+)$/.exec(u.pathname))) {
      return json(200, { message: `Scraping concluído para customSearchMenu=${m[1]}`, customSearchMenuId: m[1],
        ticketCount: tickets.length, tickets: tickets.map(linha) });
    }
    if (u.pathname === '/ultimos-tramites') {
      if (modo === 'sem-ultimos') return json(404, { error: 'Cannot GET /ultimos-tramites' });
      const ids = String(u.searchParams.get('ids') || '').split(',').filter(Boolean);
      if (!ids.length || ids.length > 200) return json(400, { error: 'ids deve ter de 1 a 200 números separados por vírgula' });
      return json(200, { datas: Object.fromEntries(ids.map(id => { const t = porId(id); return [id, t ? br(t.tramites[0].ts) : null]; })) });
    }
    if ((m = /^\/tramites\/(\d+)$/.exec(u.pathname))) {
      const t = porId(m[1]);
      if (!t) return json(404, { error: 'Ticket não encontrado' });
      const com = u.searchParams.get('anexos') === '1';
      return json(200, { ticketId: t.id, total: t.tramites.length, tramites: t.tramites.map((tr, i) => tramiteJson(tr, i, com)) });
    }
    if ((m = /^\/visualizacoes\/(\d+)$/.exec(u.pathname))) {
      const t = porId(m[1]);
      return json(200, { ticketId: m[1], total: t ? t.views.length : 0, visualizacoes: t ? t.views : [] });
    }
    if ((m = /^\/anexo\/([^/]+)$/.exec(u.pathname))) {
      if (!/^\d+$/.test(m[1])) return json(400, { error: 'anexoId deve ser um número válido' });
      const a = ANEXOS[m[1]];
      if (!a) return json(500, { error: 'Erro ao baixar anexo' });
      res.writeHead(200, { 'Content-Type': a.type, 'Content-Length': a.bytes.length,
        'Content-Disposition': `attachment;filename="${encodeURIComponent(a.name)}"` });
      return res.end(a.bytes);
    }
    json(404, { error: `Cannot ${req.method} ${u.pathname}` });
  });
}

module.exports = { criarServidor, KEY };

if (require.main === module) {
  const url = `http://localhost:${PORT}`;
  criarServidor().listen(PORT, () => {
    console.log(`Fila falsa em ${url}\nChave: ${KEY}`);
    if (!process.argv.includes('--app')) return;
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    const app = spawn(require('electron'), ['.'], {
      cwd: path.join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, TICKETS_API: url, TICKETS_REFRESH_MS: '5000' }
    });
    app.on('exit', () => process.exit(0));
  });
}
