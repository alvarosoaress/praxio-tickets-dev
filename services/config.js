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
//
// O aceite e versionado porque ele descreve por extenso O QUE sai (regra de ouro #13).
// Quando isso muda de categoria, o aceite antigo deixou de cobrir o que acontece agora e
// tem que ser pedido de novo — o valor velho (`true`) simplesmente nao casa.
//   v2: alem do texto dos tramites, o resumo passou a mandar as imagens anexadas.
//   v3: o resumo passou a mandar tambem os .md da raiz do repositorio do modulo. Categoria
//       nova: ate aqui so saia conteudo do ticket; agora sai documentacao interna do codigo.
const CONSENT_V = 3;
const claudeOk = () => readCfg().claudeOk === CONSENT_V;
const setClaudeOk = () => writeCfg({ ...readCfg(), claudeOk: CONSENT_V });

// Lista [{ path }] dos repositorios locais do usuario. E uma lista, e nao um mapa: quem
// escolhe qual usar e o usuario, no momento em que clica — o app nao adivinha mais pelo
// modulo do portal. Quem valida a forma e ipc/config.js; aqui so le e grava.
const repos = () => { const r = readCfg().repos; return Array.isArray(r) ? r : []; };
const setRepos = list => writeCfg({ ...readCfg(), repos: list });

module.exports = { KEY_LENGTH, apiKey, setApiKey, claudeOk, setClaudeOk, repos, setRepos };
