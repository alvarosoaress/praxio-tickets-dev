// Atualizacao pelo GitHub. Le a ultima release publica do repo, compara com a versao
// deste binario e, se o usuario mandar, baixa o instalador novo e o roda.
//
// O repo e publico de proposito: sem token, sem chave, sem autenticacao nenhuma. Se um dia
// virar privado, esta feature para de funcionar e nao ha como consertar sem embutir
// credencial no .exe — que e exatamente o que a regra de ouro proibe.
const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO = 'alvarosoaress/praxio-tickets-dev';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

// Fronteira de confianca: a URL do .exe vem do JSON do GitHub, e o que se faz com esses
// bytes e EXECUTAR na maquina do usuario. Por isso ela e conferida contra o prefixo deste
// repositorio em vez de ser seguida de olhos fechados — asset de outro lugar nao baixa.
const DOWNLOAD_BASE = `https://github.com/${REPO}/releases/download/`;

// A API do GitHub responde 403 para requisicao sem User-Agent.
const UA = { 'User-Agent': 'tickets-app' };

const CHECK_MS = 10_000;
const DOWNLOAD_MS = 600_000;   // o .exe tem ~97 MB e a rede do escritorio nao e rapida

// "v1.2" -> [1,2,0]. Parte que falta vira 0, entao "1.2" e "1.2.0" sao a mesma versao.
const partes = v => String(v || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

// Comparacao numerica, nao lexicografica: "1.10.0" > "1.9.0", que o > de string erra.
function maisNova(remota, local) {
  const a = partes(remota), b = partes(local);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Nunca lanca: { version, local, url, page } quando ha novidade, { atual: true } quando nao ha,
// { error } quando o GitHub nao respondeu. Sem release publicada a API devolve 404, que
// vira error e some da tela — app novo em repo sem release nao acusa nada.
async function checar() {
  // Rodando de `npm start` nao ha instalacao para trocar, e quem roda do repositorio
  // atualiza com `git pull`. Avisar ali seria um botao que nao tem o que fazer.
  if (!app.isPackaged) return { atual: true };
  try {
    const r = await fetch(LATEST, {
      headers: { ...UA, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(CHECK_MS)
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const b = await r.json();

    const asset = (b.assets || []).find(a => /\.exe$/i.test(a && a.name || '')
      && String(a.browser_download_url || '').startsWith(DOWNLOAD_BASE));
    // Release sem .exe anexado nao e atualizavel — avisar de uma versao que nao da para
    // instalar so produz um botao que falha.
    if (!asset || !maisNova(b.tag_name, app.getVersion())) return { atual: true };

    return {
      version: String(b.tag_name).replace(/^v/i, ''),
      local: app.getVersion(),
      url: asset.browser_download_url,
      bytes: asset.size || 0,
      page: `https://github.com/${REPO}/releases/latest`
    };
  } catch {
    return { error: 'Sem conexao com o GitHub.' };
  }
}

// Nunca lanca: { ok: true } e o app fecha para o instalador entrar, ou { error } e nada mudou.
//
// O asset do target nsis e um INSTALADOR, nao o app: trocar o .exe da pasta por ele
// substituiria o programa pelo seu proprio setup. Entao ele e baixado e executado.
async function aplicar(url) {
  if (!String(url || '').startsWith(DOWNLOAD_BASE)) return { error: 'Endereço de download inválido.' };
  if (!app.isPackaged) return { error: 'Esta cópia roda do repositório — atualize com git pull.' };

  const setup = path.join(app.getPath('temp'), 'tickets-setup.exe');
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!r.ok) return { error: `O GitHub respondeu HTTP ${r.status} ao baixar o .exe.` };
    fs.writeFileSync(setup, Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    try { fs.rmSync(setup, { force: true }); } catch {}
    return { error: e.name === 'TimeoutError' ? 'O download demorou demais.' : `Falha ao baixar: ${e.message}` };
  }

  // `/S` e a instalacao silenciosa do nsis; `--force-run` e o que faz o instalador reabrir
  // o app no fim — sem ele, install silencioso termina calado e o usuario fica sem janela.
  // O ping segura ~3s para este processo sair antes: o instalador nao sobrescreve arquivo
  // em uso. O `start ""` com titulo vazio evita que o caminho entre aspas vire titulo.
  //
  // ponytail: espera fixa em vez de esperar o PID sair. Se a maquina for lenta a ponto de
  // o instalador chegar antes, virar loop de tasklist resolve.
  const cm = spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & start "" "${setup}" /S --force-run`],
    { detached: true, stdio: 'ignore', windowsHide: true });
  cm.on('error', () => {});
  cm.unref();

  app.quit();
  return { ok: true };
}

module.exports = { checar, aplicar, maisNova };
