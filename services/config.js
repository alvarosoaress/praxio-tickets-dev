// Config do app, em %APPDATA%\tickets\config.json: a chave da API, o consentimento
// do resumo e o mapa de repositorios locais. Unico lugar que le e escreve esse arquivo.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const KEY_LENGTH = 104;

// app.getPath lanca se chamado antes do ready — por isso cfgPath so roda dentro
// das funcoes, nunca no topo do modulo.
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; } };
const writeCfg = c => fs.writeFileSync(cfgPath(), JSON.stringify(c));

const apiKey = () => readCfg().apiKey || '';
const setApiKey = key => writeCfg({ ...readCfg(), apiKey: key });

// O resumo manda o conteudo do ticket para fora da maquina; o usuario autoriza uma vez.
const claudeOk = () => Boolean(readCfg().claudeOk);
const setClaudeOk = () => writeCfg({ ...readCfg(), claudeOk: true });

// Mapa [{ path, modules }] de repositorio local para modulos do portal. Quem valida a
// forma e ipc/config.js; aqui so le e grava.
const repos = () => { const r = readCfg().repos; return Array.isArray(r) ? r : []; };
const setRepos = list => writeCfg({ ...readCfg(), repos: list });

module.exports = { KEY_LENGTH, apiKey, setApiKey, claudeOk, setClaudeOk, repos, setRepos };
