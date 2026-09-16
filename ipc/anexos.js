const { ipcMain, protocol } = require('electron');
const { apiKey } = require('../services/config');
const { anexoBytes, anexoStream } = require('../services/portalapi');
const { MAX_CONVERT_BYTES, respHeaders, toText, toHtml } = require('../services/anexo');

function register() {
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
  // Ao contrario de um ipcMain.handle, este handler nao tem rede embaixo: uma excecao aqui
  // vira "A JavaScript error occurred in the main process" e derruba o app inteiro. Por
  // isso o try/catch, e por isso nenhum header do portal e copiado — ver respHeaders().
  protocol.handle('anexo', async req => {
    try {
      const u = new URL(req.url);
      const id = u.pathname.replace(/^\//, '');
      if (!/^\d+$/.test(id)) return new Response('id inválido', { status: 400 });
      if (!apiKey()) return new Response('sem chave', { status: 401 });

      const upstream = await anexoStream(id);
      if (upstream.error) return new Response(upstream.error, { status: upstream.status || 502 });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders(upstream.headers.get('content-type'), u.searchParams.get('ext'))
      });
    } catch (e) {
      console.error('[anexo]', e);
      return new Response('falha ao servir o anexo', { status: 502 });
    }
  });
}

module.exports = { register, registerProtocol };
