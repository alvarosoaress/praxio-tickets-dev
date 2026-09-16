'use strict';

// Codigo de modulo do portal (WTR, WCX, WCE...). Mesmo formato do sanitize.js: arquivo
// puro na raiz, global para o renderer via <script src> e module.exports para o test.js.
// Tres consumidores, uma implementacao — renderer, ipc/config.js e test.js.

const MAX_MODULES = 40;

// Duas entradas porque sao dois lados da mesma coisa: string e o que o usuario digitou
// ("WTR, WCX"); array e o que chega do renderer pelo IPC, onde nada e confiavel.
// Nao-string e descartado em vez de convertido: String({}) gravaria "[object Object]"
// no config.json.
function normModules(raw) {
  const brutos = typeof raw === 'string' ? raw.split(/[,;\s]+/)
               : Array.isArray(raw) ? raw.filter(v => typeof v === 'string')
               : [];
  const out = [];
  for (const v of brutos) {
    const m = v.trim().toUpperCase();
    if (m && !out.includes(m)) out.push(m);
  }
  return out.slice(0, MAX_MODULES);
}

// Um modulo pertence a UM repositorio so. Quem aparece primeiro fica com ele: o renderer
// ja tira do anterior na hora de mover, entao isto aqui e a rede embaixo — segura lista
// malformada vinda pelo IPC sem deixar o config.json guardar o mesmo modulo duas vezes.
function unicos(repos) {
  const vistos = new Set();
  const out = [];
  for (const r of Array.isArray(repos) ? repos : []) {
    const modules = [];
    for (const m of normModules(r && r.modules)) {
      if (vistos.has(m)) continue;
      vistos.add(m);
      modules.push(m);
    }
    out.push({ ...r, modules });
  }
  return out;
}

// Qual repositorio local responde por um modulo do portal. Primeiro consumidor do mapa que
// o dialog de Configuracoes grava desde sempre — ate aqui ninguem lia esses caminhos.
// Passa pelo normModules dos dois lados porque o modulo vem do portal como veio ("wtr",
// "WTR - Transporte") e o do config veio do que o usuario digitou.
function repoDe(repos, mod) {
  const alvo = normModules(mod)[0];
  if (!alvo) return null;
  for (const r of Array.isArray(repos) ? repos : []) {
    if (normModules(r && r.modules).includes(alvo)) return r;
  }
  return null;
}

if (typeof module !== 'undefined') module.exports = { normModules, unicos, repoDe, MAX_MODULES };
