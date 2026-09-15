const { ipcMain, protocol } = require('electron');
const { apiKey } = require('../services/config');
const { get, anexoBytes, anexoStream } = require('../services/portalapi');
const { MAX_CONVERT_BYTES, MIME, toText, toHtml } = require('../services/anexo');

function register() {
  ipcMain.handle('anexos', async (_e, id) => {
    if (!/^\d+$/.test(String(id))) return { error: 'ID de ticket inválido.' };
    const b = await get(`/anexos/${id}`, 60_000);
    return b.error ? b : { anexos: b.anexos || [] };
  });

  // Arquivos de texto vêm pelo IPC, não por fetch('anexo://…'): o protocolo é outra
  // origem e o fetch morreria em CORS. <img>/<video>/<iframe> não têm esse problema.
  ipcMain.handle('anexo-text', async (_e, id) => {
    const res = await anexoBytes(id);
    if (res.error) return res;
    if (res.buffer.length > MAX_CONVERT_BYTES) return { error: 'Arquivo grande demais para exibir na tela.' };
    return { text: toText(res.buffer) };
  });

  ipcMain.handle('anexo-html', async (_e, { id, kind }) => {
    const res = await anexoBytes(id);
    if (res.error) return res;
    if (res.buffer.length > MAX_CONVERT_BYTES) return { error: 'Arquivo grande demais para converter na tela.' };
    return toHtml(res.buffer, kind);
  });
}

// Roda dentro do app.whenReady(). O registerSchemesAsPrivileged que este handler exige
// fica no main.js, no escopo de modulo — ele precisa acontecer ANTES do ready.
function registerProtocol() {
  // anexo://portal/<id>?ext=pdf — o id vai no PATH, nunca no host: um host todo
  // numerico e lido como IPv4 decimal (1218235 vira 0.18.150.187).
  protocol.handle('anexo', async req => {
    const u = new URL(req.url);
    const id = u.pathname.replace(/^\//, '');
    if (!/^\d+$/.test(id)) return new Response('id inválido', { status: 400 });
    if (!apiKey()) return new Response('sem chave', { status: 401 });

    const upstream = await anexoStream(id);
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
}

module.exports = { register, registerProtocol };
