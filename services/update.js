// Atualizacao pelo GitHub. Le a ultima release publica do repo, compara com a versao
// deste binario e, se o usuario mandar, baixa o .exe novo e o poe no lugar do atual.
//
// O repo e publico de proposito: sem token, sem chave, sem autenticacao nenhuma. Se um dia
// virar privado, esta feature para de funcionar e nao ha como consertar sem embutir
// credencial no .exe — que e exatamente o que a regra de ouro proibe.
const { app } = require('electron');
const { spawn } = require('child_process');
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

// O caminho do .exe ORIGINAL. O portable se extrai num diretorio temporario e roda de la,
// entao process.execPath aponta para a copia descartavel — trocar aquilo nao atualiza nada.
// Quem sabe o caminho de verdade e a variavel que o proprio launcher do electron-builder
// exporta. Rodando por `npm start` ela nao existe, e nao ha .exe para trocar.
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || '';

// Restos da troca anterior. O .old so pode morrer depois que aquele processo terminou, ou
// seja, num boot seguinte — nunca no mesmo. Falhar aqui nao custa nada: e lixo, nao estado.
function limparAntigo() {
  try { fs.rmSync(exePath() + '.old', { force: true }); } catch {}
}

// Nunca lanca: { version, local, url, page } quando ha novidade, { atual: true } quando nao ha,
// { error } quando o GitHub nao respondeu. Sem release publicada a API devolve 404, que
// vira error e some da tela — app novo em repo sem release nao acusa nada.
async function checar() {
  limparAntigo();
  // Rodando de `npm start` nao existe .exe para trocar, e quem roda do repositorio atualiza
  // com `git pull`. Avisar ali seria um botao que nao tem o que fazer.
  if (!exePath()) return { atual: true };
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

// Espera o app morrer e reabre o .exe ja trocado. Precisa ser um processo de fora: quem
// faz a troca esta prestes a sair. O `start ""` com titulo vazio e o mesmo detalhe do
// abrirNoTerminal — sem ele o start toma o caminho entre aspas como titulo da janela.
//
// ponytail: espera fixa de ~3s em vez de esperar o PID sair. Se a maquina for lenta a
// ponto de o launcher portable ainda segurar o diretorio temporario, virar loop de
// tasklist resolve — nunca aconteceu para justificar escrever.
function relancar(exe) {
  const cm = spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`],
    { detached: true, stdio: 'ignore', windowsHide: true });
  cm.on('error', () => {});
  cm.unref();
}

// Nunca lanca: { ok: true } e o app fecha, ou { error } e nada mudou no disco.
async function aplicar(url) {
  if (!String(url || '').startsWith(DOWNLOAD_BASE)) return { error: 'Endereço de download inválido.' };

  const exe = exePath();
  if (!exe) return { error: 'Esta cópia não é o .exe portátil — baixe a nova versão pelo GitHub.' };

  const novo = exe + '.new', velho = exe + '.old';
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!r.ok) return { error: `O GitHub respondeu HTTP ${r.status} ao baixar o .exe.` };
    fs.writeFileSync(novo, Buffer.from(await r.arrayBuffer()));

    // O Windows deixa RENOMEAR um .exe em uso, mas nao sobrescrever — por isso o atual sai
    // do caminho antes de o novo entrar, em vez de o novo ser escrito por cima.
    limparAntigo();
    fs.renameSync(exe, velho);
    try {
      fs.renameSync(novo, exe);
    } catch (e) {
      fs.renameSync(velho, exe);   // desfaz: sair daqui sem .exe deixaria o usuario sem app
      throw e;
    }
  } catch (e) {
    try { fs.rmSync(novo, { force: true }); } catch {}
    return { error: e.name === 'TimeoutError' ? 'O download demorou demais.' : `Falha ao atualizar: ${e.message}` };
  }

  relancar(exe);
  return { ok: true };
}

module.exports = { checar, aplicar, maisNova };
