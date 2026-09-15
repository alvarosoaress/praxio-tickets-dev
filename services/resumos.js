// Cache de resumo em disco, em %APPDATA%\tickets\resumos.json.
//
// Arquivo separado do config.json de proposito: este cresce, e descartavel e pode ser
// apagado a qualquer momento sem consequencia. Misturar com a chave da API significaria
// reescrever o arquivo da chave a cada resumo — e readCfg trata arquivo corrompido como
// "ainda nao configurado", que ali custa a chave e aqui nao custa nada.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const file = () => path.join(app.getPath('userData'), 'resumos.json');
const readAll = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };

// Devolve o registro inteiro — { text, lastUpdate, at } — e nao julga se ainda vale.
// Quem compara o lastUpdate e o handler, porque resumo velho aqui nao e descartado: e
// mostrado com aviso. Refazer custa dezenas de segundos e dinheiro, entao a decisao e
// do usuario, nunca automatica.
function get(id) {
  return readAll()[id] || null;
}

// Nunca lanca: perder o cache e irrelevante, derrubar o resumo do usuario nao.
function set(id, lastUpdate, text, at) {
  try {
    const all = readAll();
    all[id] = { lastUpdate, text, at };
    fs.writeFileSync(file(), JSON.stringify(all));
  } catch {}
}

module.exports = { get, set };
