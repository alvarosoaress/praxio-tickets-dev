const { app, BrowserWindow, Menu, ipcMain, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');

// TICKETS_API aponta o app para uma API local durante o desenvolvimento.
const API = process.env.TICKETS_API || 'https://portalapi.188720391.xyz';
const SEARCH_MENU = '27662';
const KEY_LENGTH = 104;
const MAX_CONVERT_BYTES = 25 * 1024 * 1024; // xlsx/docx convertem em memoria; zip de 16MB existe na base

// Só os tipos que o visualizador abre; usado quando o portal responde octet-stream.
const MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogg: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4'
};

// anexo://<id> serve os bytes do anexo vindos da API. Assim <img>, <video> e o
// visualizador de PDF do Chromium leem direto, em stream, sem nada em disco e sem
// base64 inflando a memoria.
protocol.registerSchemesAsPrivileged([{
  scheme: 'anexo',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; } };
const writeCfg = c => fs.writeFileSync(cfgPath(), JSON.stringify(c));

ipcMain.handle('has-key', () => Boolean(readCfg().apiKey));

ipcMain.handle('set-key', (_e, key) => {
  key = String(key || '').trim();
  if (key.length !== KEY_LENGTH) return { error: `A chave deve ter ${KEY_LENGTH} caracteres (esta tem ${key.length}).` };
  writeCfg({ ...readCfg(), apiKey: key });
  return { ok: true };
});

// Nunca lanca atraves do IPC: sempre { ...dados } ou { error }.
async function get(path, timeoutMs) {
  const { apiKey } = readCfg();
  if (!apiKey) return { error: 'NO_KEY' };
  try {
    const r = await fetch(API + path, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(timeoutMs) // fetch nao tem timeout por padrao
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return { error: b.error || `HTTP ${r.status}`, status: r.status };
    return b;
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'A API demorou demais para responder.' : 'Sem conexao com a API.' };
  }
}

ipcMain.handle('tickets', async () => {
  const b = await get(`/scrape-custom/${SEARCH_MENU}`, 120_000);
  return b.error ? b : { tickets: b.tickets || [] };
});

ipcMain.handle('ticket-detail', async (_e, id) => {
  if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
  const [tramites, views] = await Promise.all([
    get(`/tramites/${id}?anexos=1`, 90_000),
    get(`/visualizacoes/${id}`, 60_000)
  ]);
  if (tramites.error) return tramites;
  // Visualizacoes sao acessorias: se falharem, o ticket ainda abre.
  return { tramites: tramites.tramites || [], views: views.error ? [] : (views.visualizacoes || []) };
});

ipcMain.handle('anexos', async (_e, id) => {
  if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
  const b = await get(`/anexos/${id}`, 60_000);
  return b.error ? b : { anexos: b.anexos || [] };
});

// Busca os bytes de um anexo. Usado pelo protocolo e pelos conversores.
async function anexoBytes(id) {
  const { apiKey } = readCfg();
  if (!apiKey) return { error: 'NO_KEY' };
  if (!/^\d+$/.test(String(id))) return { error: 'ID de anexo inválido.' };
  try {
    const r = await fetch(`${API}/anexo/${id}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(180_000)
    });
    if (!r.ok) return { error: `HTTP ${r.status}`, status: r.status };
    return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'O anexo demorou demais para baixar.' : 'Sem conexao com a API.' };
  }
}

// Arquivos de texto vêm pelo IPC, não por fetch('anexo://…'): o protocolo é outra
// origem e o fetch morreria em CORS. <img>/<video>/<iframe> não têm esse problema.
ipcMain.handle('anexo-text', async (_e, id) => {
  const res = await anexoBytes(id);
  if (res.error) return res;
  if (res.buffer.length > MAX_CONVERT_BYTES) return { error: 'Arquivo grande demais para exibir na tela.' };

  let text = res.buffer.toString('utf8');
  // Muito .sql/.txt da base vem em cp1252; o U+FFFD denuncia o decode errado.
  if (text.includes('�')) text = res.buffer.toString('latin1');
  return { text };
});

// Planilha e .docx viram HTML aqui no main: as bibliotecas ficam fora do renderer e o
// resultado ainda passa pelo sanitizador antes de entrar no DOM.
ipcMain.handle('anexo-html', async (_e, { id, kind }) => {
  const res = await anexoBytes(id);
  if (res.error) return res;
  if (res.buffer.length > MAX_CONVERT_BYTES) return { error: 'Arquivo grande demais para converter na tela.' };
  try {
    if (kind === 'sheet') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(res.buffer, { type: 'buffer' });
      return {
        sheets: wb.SheetNames.map(name => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { id: 'sheet' })
        }))
      };
    }
    const { convertToHtml } = require('mammoth');
    const out = await convertToHtml({ buffer: res.buffer });
    return { sheets: [{ name: 'documento', html: out.value }] };
  } catch (e) {
    return { error: 'Não foi possível ler este arquivo: ' + e.message };
  }
});

app.whenReady().then(() => {
  // anexo://portal/<id>?ext=pdf — o id vai no PATH, nunca no host: um host todo
  // numerico e lido como IPv4 decimal (1218235 vira 0.18.150.187).
  protocol.handle('anexo', async req => {
    const u = new URL(req.url);
    const id = u.pathname.replace(/^\//, '');
    if (!/^\d+$/.test(id)) return new Response('id inválido', { status: 400 });

    const { apiKey } = readCfg();
    if (!apiKey) return new Response('sem chave', { status: 401 });

    // net.fetch devolve a Response em stream; o body passa direto para o Chromium.
    const upstream = await net.fetch(`${API}/anexo/${id}`, { headers: { Authorization: apiKey } });
    const headers = new Headers(upstream.headers);

    // O portal marca TODO anexo como "attachment". Repassar isso faz o Chromium
    // abrir "Salvar como" em vez de renderizar — justamente o que nao queremos.
    headers.set('Content-Disposition', 'inline');

    // Quando o portal nao sabe o tipo, o visualizador tambem nao saberia.
    const ct = headers.get('Content-Type') || '';
    if (!ct || ct.startsWith('application/octet-stream')) {
      const guess = MIME[u.searchParams.get('ext')];
      if (guess) headers.set('Content-Type', guess);
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  });

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 720,
    backgroundColor: '#0e1116',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Em desenvolvimento (TICKETS_API apontando para uma API local), o console do
  // renderer sai no terminal e num arquivo — o .exe empacotado nao tem console, e
  // sem isso erro de CSP e de protocolo some em silencio.
  if (process.env.TICKETS_API) {
    const log = path.join(app.getPath('userData'), 'dev.log');
    win.webContents.on('console-message', e => {
      const line = `[renderer:${e.level}] ${e.message}\n`;
      console.log(line.trim());
      try { fs.appendFileSync(log, line); } catch {}
    });
  }
  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());
