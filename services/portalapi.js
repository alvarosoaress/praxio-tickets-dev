// Cliente da portalapi. Unico lugar do app que fala com a rede externa — o renderer
// tem CSP default-src 'none' e nao alcanca nada por conta propria.
const { apiKey } = require('./config');

// TICKETS_API aponta o app para uma API local durante o desenvolvimento.
const API = process.env.TICKETS_API || 'https://portalapi.188720391.xyz';
const SEARCH_MENU = '27662';

// Nunca lanca: sempre { ...dados } ou { error }.
async function get(path, timeoutMs) {
  const key = apiKey();
  if (!key) return { error: 'NO_KEY' };
  try {
    const r = await fetch(API + path, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(timeoutMs) // fetch nao tem timeout por padrao
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return { error: b.error || `HTTP ${r.status}`, status: r.status };
    return b;
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'A API demorou demais para responder.' : 'Sem conexao com a API.' };
  }
}

// Busca os bytes de um anexo. Usado pelos conversores.
async function anexoBytes(id) {
  const key = apiKey();
  if (!key) return { error: 'NO_KEY' };
  if (!/^\d+$/.test(String(id))) return { error: 'ID de anexo inválido.' };
  try {
    const r = await fetch(`${API}/anexo/${id}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(180_000)
    });
    if (!r.ok) return { error: `HTTP ${r.status}`, status: r.status };
    return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'O anexo demorou demais para baixar.' : 'Sem conexao com a API.' };
  }
}

// Stream cru, para o protocolo anexo://. A Response vai em stream e o body passa direto
// para o Chromium, sem nada em disco e sem base64 inflando a memoria.
//
// Usa o fetch global (undici) e NAO o net.fetch do Electron. O net.fetch monta um Headers
// a partir da resposta do Chromium, e um anexo com nome acentuado chega la com U+FFFD:
// Headers.set rejeita isso como ByteString e a excecao acontece DENTRO do Electron, antes
// deste codigo — sem try/catch possivel, e derruba o processo main. O undici decodifica
// header em latin1, que nunca produz U+FFFD. Medido nos dois caminhos.
//
// Nunca lanca: a Response, ou { error, status }.
async function anexoStream(id) {
  const key = apiKey();
  if (!key) return { error: 'NO_KEY', status: 401 };
  if (!/^\d+$/.test(String(id))) return { error: 'ID de anexo inválido.', status: 400 };
  try {
    return await fetch(`${API}/anexo/${id}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(180_000)
    });
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'O anexo demorou demais para responder.' : 'Sem conexao com a API.', status: 502 };
  }
}

module.exports = { SEARCH_MENU, get, anexoBytes, anexoStream };
