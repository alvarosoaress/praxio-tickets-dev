// Status pessoal do usuario, em %APPDATA%\tickets\status.json: a lista de status que ele
// definiu e qual esta marcado em cada ticket.
//
// Arquivo separado do config.json pelo mesmo motivo do resumos.js: marcar um ticket
// acontece dezenas de vezes por dia, e cada marcacao reescreveria o arquivo da CHAVE —
// que readCfg trata como "ainda nao configurado" quando corrompe. Aqui um arquivo perdido
// custa as marcacoes; la custa a chave.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const file = () => path.join(app.getPath('userData'), 'status.json');

// { defs: [{ id, nome, cor }], por: { "<numero do ticket>": "<id>" } }
const get = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };

// Nunca lanca: perder a marcacao e irrelevante perto de derrubar a tela do usuario.
function set(blob) {
  try { fs.writeFileSync(file(), JSON.stringify(blob)); } catch {}
}

module.exports = { get, set };
