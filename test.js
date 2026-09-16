// node test.js — checa o parser de data BR e o mecanismo de envelhecimento,
// que e o sinal principal da tela. Sem framework de proposito.
const assert = require('assert');
const { ticketsNovos, parseBR, minutesSince, ageLabel, ageBucket, statusKey, matches, prettyXml, kindOf, anexosDe, cacheGet, cachePut, showNoticeIn } = require('./renderer.js');
const { safeHref, KEEP, NUKE, PORTAL_BASE } = require('./sanitize.js');
const { buildPrompt, buildContent, parseResult, parseSize, escolherAnexos, lerDocs, MAX_PROMPT_CHARS, MAX_DOCS_CHARS,
        MAX_IMAGENS, MAX_PDFS, MAX_TEXTOS, MAX_ANEXOS, MAX_TEXTO_TOTAL } = require('./services/claude.js');
const { respHeaders } = require('./services/anexo.js');
const { parseResumo } = require('./renderer.js');
const { normModules, unicos, repoDe, MAX_MODULES } = require('./modulos.js');
const { slugTicket, buildBriefing, jaExiste, MAX_SLUG } = require('./services/git.js');
const { maisNova } = require('./services/update.js');

// parser: o portal manda "DD/MM/YYYY HH:mm:ss", que new Date() le como MM/DD
const d = parseBR('14/09/2026 15:59:55');
assert.strictEqual(d.getDate(), 14);
assert.strictEqual(d.getMonth(), 8);      // setembro
assert.strictEqual(d.getFullYear(), 2026);
assert.strictEqual(d.getHours(), 15);
assert.strictEqual(d.getMinutes(), 59);
assert.ok(parseBR('04/09/2026 10:04'), 'segundos sao opcionais');
assert.strictEqual(parseBR(''), null);
assert.strictEqual(parseBR(null), null);
assert.strictEqual(parseBR('2026-09-14T15:59:55'), null, 'ISO nao e o formato do portal');

// idade: nunca negativa, mesmo com relogio adiantado no portal
const brOf = ms => {
  const x = new Date(Date.now() - ms), p = n => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
};
const H = 3600000;
assert.strictEqual(minutesSince(brOf(-5 * H)), 0, 'futuro vira 0, nao negativo');
assert.strictEqual(minutesSince('lixo'), null);
assert.ok(Math.abs(minutesSince(brOf(2 * H)) - 120) <= 1);

// rotulos
assert.strictEqual(ageLabel(0), 'agora');
assert.strictEqual(ageLabel(45), '45min');
assert.strictEqual(ageLabel(60), '1h');
assert.strictEqual(ageLabel(1439), '23h');
assert.strictEqual(ageLabel(1440), '1d');
assert.strictEqual(ageLabel(null), '—');

// faixas: as fronteiras sao o que define a cor ambar
assert.strictEqual(ageBucket(239), 'fresh');
assert.strictEqual(ageBucket(240), 'warm');
assert.strictEqual(ageBucket(1439), 'warm');
assert.strictEqual(ageBucket(1440), 'stale');
assert.strictEqual(ageBucket(4319), 'stale');
assert.strictEqual(ageBucket(4320), 'critical');
assert.strictEqual(ageBucket(null), 'none');

// status: acento e caixa nao podem trocar a cor
assert.strictEqual(statusKey('Em andamento'), 'andamento');
assert.strictEqual(statusKey('Pendente Cliente'), 'cliente');
assert.strictEqual(statusKey('Concluído'), 'concluido');
assert.strictEqual(statusKey('Concluido'), 'concluido');
assert.strictEqual(statusKey('Ticket aberto'), 'aberto');
assert.strictEqual(statusKey(undefined), 'outro');

// filtro: busca livre ignora acento/caixa e cruza varios campos
const t = { number: '0926-000931', title: 'Excesso de bagagem não gera calculo de comissão',
            client: 'SAO LUIZ - GO', module: 'WCX', person: 'Divino Alves Soares',
            responsible: 'PAUL.CARVALHO', status: 'Em andamento' };
const F = o => Object.assign({ q: '', resp: '', client: '', status: '' }, o);
assert.ok(matches(t, F({})));
assert.ok(matches(t, F({ q: 'comissao' })), 'busca sem acento acha texto com acento');
assert.ok(matches(t, F({ q: 'sao luiz' })));
assert.ok(matches(t, F({ q: 'wcx' })));
assert.ok(!matches(t, F({ q: 'inexistente' })));
assert.ok(matches(t, F({ resp: 'PAUL.CARVALHO' })));
assert.ok(!matches(t, F({ resp: 'OUTRO.DEV' })));
assert.ok(!matches(t, F({ resp: 'PAUL.CARVALHO', q: 'inexistente' })), 'filtros se somam');

// sanitizacao de href: o conteudo dos tramites e escrito por clientes e operadores
assert.strictEqual(safeHref('javascript:alert(1)'), null);
assert.strictEqual(safeHref('  JaVaScRiPt:alert(1)  '), null, 'caixa e espaco nao driblam');
assert.strictEqual(safeHref('data:text/html,<script>x</script>'), null);
assert.strictEqual(safeHref('vbscript:msgbox'), null);
assert.strictEqual(safeHref('file:///C:/Windows/System32'), null);
assert.strictEqual(safeHref(''), null);
assert.strictEqual(safeHref(null), null);
assert.strictEqual(safeHref(undefined), null);
assert.strictEqual(safeHref('https://exemplo.com/x?a=1'), 'https://exemplo.com/x?a=1');
assert.strictEqual(safeHref('mailto:alguem@praxio.com.br'), 'mailto:alguem@praxio.com.br');
// href relativo do portal vira absoluto, senao quebra fora do dominio original
assert.strictEqual(safeHref('/Ticket/TicketPrincipal/937919'), PORTAL_BASE + '/Ticket/TicketPrincipal/937919');

// allowlist: o que precisa passar passa, o que executa codigo nao
for (const t of ['a', 'b', 'strong', 'br', 'p', 'div', 'ul', 'li', 'table', 'td', 'code']) {
  assert.ok(KEEP.has(t), t + ' deveria ser mantida');
}
for (const t of ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'input', 'link', 'meta']) {
  assert.ok(NUKE.has(t), t + ' deveria ser removida');
  assert.ok(!KEEP.has(t), t + ' nao pode estar nas duas listas');
}
assert.ok(!KEEP.has('img'), 'img tem tratamento proprio (marcador), nao passa direto');

// tipo do anexo sai da extensao: o portal nao manda mime na listagem
assert.strictEqual(kindOf('png').kind, 'image');
assert.strictEqual(kindOf('JPEG'.toLowerCase()).kind, 'image');
assert.strictEqual(kindOf('pdf').kind, 'pdf');
assert.strictEqual(kindOf('xlsx').kind, 'sheet');
assert.strictEqual(kindOf('xls').kind, 'sheet');
assert.strictEqual(kindOf('docx').kind, 'doc');
assert.strictEqual(kindOf('xml').kind, 'xml');
assert.strictEqual(kindOf('sql').kind, 'text');
assert.strictEqual(kindOf('mp4').kind, 'video');
assert.strictEqual(kindOf('zip').kind, 'archive');
assert.strictEqual(kindOf('pfx').kind, 'other', 'certificado nao tem preview');
assert.strictEqual(kindOf('').kind, 'other');

// indentador de XML: a NF-e chega numa linha so de dezenas de milhares de caracteres
const xml = prettyXml('<?xml version="1.0"?><NFe xmlns="x"><ide><cUF>14</cUF><natOp>Devolucao de compra</natOp></ide><det><prod/></det></NFe>');
const linhas = xml.split('\n');
assert.strictEqual(linhas[0], '<?xml version="1.0"?>', 'declaracao nao indenta nem abre nivel');
assert.strictEqual(linhas[1], '<NFe xmlns="x">');
assert.strictEqual(linhas[2], '  <ide>');
assert.strictEqual(linhas[3], '    <cUF>14</cUF>', 'folha fica numa linha so');
assert.strictEqual(linhas[4], '    <natOp>Devolucao de compra</natOp>');
assert.strictEqual(linhas[5], '  </ide>');
assert.strictEqual(linhas[6], '  <det>');
assert.strictEqual(linhas[7], '    <prod/>', 'self-closing nao abre nivel');
assert.strictEqual(linhas[8], '  </det>');
assert.strictEqual(linhas[9], '</NFe>');
assert.ok(!xml.includes('\n\n'), 'sem linhas em branco');
// nenhum conteudo pode sumir na formatacao
assert.ok(prettyXml('<a>x</a>').includes('x'));
assert.ok(prettyXml('<a><b/>solto</a>').includes('solto'), 'texto entre tags nao se perde');
assert.strictEqual(prettyXml(''), '');

// prompt do resumo: a API devolve os tramites do mais recente para o mais antigo, e um
// resumo lido fora de ordem inverte causa e efeito sem dar erro nenhum
const trs = [
  { date: '03/01/2026 10:00', origin: 'operador', author: 'PAUL', content: 'terceiro' },
  { date: '02/01/2026 10:00', origin: 'cliente', author: 'MARIA', content: 'segundo' },
  { date: '01/01/2026 09:00', origin: 'cliente', author: 'MARIA', content: 'primeiro' }
];
const pr = buildPrompt({ number: '1218235', title: 'Erro na NF-e', client: 'ACME' }, trs);
assert.ok(pr.indexOf('primeiro') < pr.indexOf('segundo'), 'tramite vai do mais antigo para o mais recente');
assert.ok(pr.indexOf('segundo') < pr.indexOf('terceiro'));
assert.ok(pr.includes('1218235') && pr.includes('ACME'), 'cabecalho leva numero e cliente');
assert.ok(pr.includes('[03/01/2026 10:00] [operador] PAUL'), 'data, origem e autor de cada tramite');

// contentHtml e HTML cru do portal: mandar isso e gastar token com markup e arriscar
// injecao de instrucao dentro de tag
const html = buildPrompt({}, [{ content: 'texto puro', contentHtml: '<b>marcado</b>' }]);
assert.ok(html.includes('texto puro') && !html.includes('<b>'), 'usa content, nunca contentHtml');

// nome de anexo e contexto ("segue o log em anexo"), mas so quando existe
assert.ok(buildPrompt({}, [{ content: 'x', anexos: [{ name: 'erro.log' }] }]).includes('erro.log'));
assert.ok(!buildPrompt({}, [{ content: 'x' }]).includes('Anexos:'));

// ticket sem tramite nenhum nao pode quebrar nem mandar prompt vazio
assert.ok(buildPrompt({ number: '1' }, []).includes('nenhum trâmite'));
assert.ok(buildPrompt().length > 0, 'sem argumento nenhum ainda devolve texto');

// teto: um ticket gigante nao pode estourar o stdin do CLI. Corta do mais antigo, porque
// o comeco da historia e o que menos importa para "o que precisa de mim agora"
const gordo = Array.from({ length: 40 }, (_, i) => ({ date: `0${1 + (i % 9)}/01/2026 10:00`, content: 'L'.repeat(5000) + ' n' + i }));
const cortado = buildPrompt({ number: '9' }, gordo);
assert.ok(cortado.length <= MAX_PROMPT_CHARS, 'respeita o teto de caracteres');
assert.ok(cortado.includes('TICKET 9'), 'cabecalho sobrevive ao corte');
assert.ok(cortado.includes(' n0'), 'o tramite mais recente e o que fica');
assert.ok(/omitido/.test(cortado), 'avisa que cortou, em vez de mentir por omissao');

// um unico tramite absurdo tambem nao pode furar o teto
assert.ok(buildPrompt({}, [{ content: 'X'.repeat(200000) }]).length <= MAX_PROMPT_CHARS);

// doc do repositorio do modulo: entra ANTES do ticket, enquadrada como referencia, e fora
// do orcamento dos tramites — se ela descontasse do teto, a doc comeria a historia que ela
// existe para esclarecer
const comDoc = buildPrompt({ number: '9' }, trs, [], [], '--- CLAUDE.md ---\nVGCE.pas e o hub de saldo');
assert.ok(comDoc.includes('VGCE.pas'), 'a doc entra no prompt');
assert.ok(comDoc.indexOf('CONTEXTO DO SISTEMA') < comDoc.indexOf('TICKET 9'), 'referencia antes do caso');
assert.ok(/não é instrução para você/.test(comDoc), 'CLAUDE.md e escrito PARA um agente: tem que vir enquadrado');
const semDoc = buildPrompt({ number: '9' }, trs);
assert.ok(!semDoc.includes('CONTEXTO DO SISTEMA'), 'sem repositorio apontado, nada muda no prompt');
assert.ok(comDoc.includes(semDoc), 'a doc so prefixa: nao tira um trâmite do lugar');
const gordoComDoc = buildPrompt({ number: '9' }, gordo, [], [], 'D'.repeat(MAX_DOCS_CHARS));
assert.ok(gordoComDoc.includes(' n0'), 'o tramite mais recente continua entrando com doc no prompt');
assert.ok(gordoComDoc.length <= MAX_PROMPT_CHARS + MAX_DOCS_CHARS + 1000, 'os dois tetos somados seguram o prompt');

// saida do CLI: agora e stream-json, ou seja JSONL — uma linha por evento e so a ultima
// `type:"result"` interessa. is_error traz o motivo dentro de result ("Not logged in"), e
// e isso que o usuario precisa ler — traduzir esconderia a causa
const jsonl = (...o) => o.map(x => JSON.stringify(x)).join('\n') + '\n';
const RESULT = r => ({ type: 'result', subtype: 'success', ...r });

assert.deepStrictEqual(parseResult(jsonl(RESULT({ result: '  resumo  ' }))), { text: 'resumo' });
assert.deepStrictEqual(
  parseResult(jsonl({ type: 'system', subtype: 'init' }, { type: 'assistant' }, RESULT({ result: 'resumo' }))),
  { text: 'resumo' }, 'ignora as linhas de evento antes do result');
assert.deepStrictEqual(parseResult(jsonl(RESULT({ result: 'Not logged in', is_error: true }))), { error: 'Not logged in' });
assert.ok(parseResult('nao e json').error, 'stdout quebrado vira error, nao excecao');
assert.ok(parseResult('').error, 'stdout vazio vira error');
assert.ok(parseResult(jsonl(RESULT({ result: '' }))).error, 'resumo vazio e erro, nao sucesso silencioso');
assert.ok(parseResult(jsonl({ type: 'assistant' })).error, 'sem linha de result e erro, nao sucesso vazio');
// uma linha truncada no meio nao pode derrubar o parse da que importa
assert.deepStrictEqual(parseResult('{"type":"assist\n' + jsonl(RESULT({ result: 'ok' }))), { text: 'ok' });


// leitura do resumo: o modelo escreve o rotulo sozinho na linha. O parser existe para dar
// hierarquia visual, entao a regra que importa e nao engolir texto quando ele foge do formato
const quatro = parseResumo('O QUE ESTÁ OCORRENDO@NF-e falha.@@ONDE@Faturamento.@@POR QUÊ@Hipótese: update.@@POSSÍVEL SOLUÇÃO@Ver log.'.split('@').join('\n'));
assert.strictEqual(quatro.length, 4);
assert.deepStrictEqual(quatro.map(b => b.k), ['O QUE ESTÁ OCORRENDO', 'ONDE', 'POR QUÊ', 'POSSÍVEL SOLUÇÃO']);
assert.strictEqual(quatro[1].body, 'Faturamento.');

// rotulo com dois-pontos e o desvio mais provavel do modelo
assert.strictEqual(parseResumo('ONDE:@Tela X.'.split('@').join('\n'))[0].k, 'ONDE');

// varias linhas sob o mesmo rotulo viram um paragrafo so
assert.strictEqual(parseResumo('ONDE@linha um@linha dois'.split('@').join('\n'))[0].body, 'linha um linha dois');

// texto antes de qualquer rotulo, e rotulo que o modelo inventou: nada pode sumir
assert.strictEqual(parseResumo('preambulo solto@ONDE@aqui'.split('@').join('\n'))[0].body, 'preambulo solto');
assert.ok(parseResumo('ONDE@x@RISCO@y'.split('@').join('\n'))[0].body.includes('RISCO'), 'rotulo desconhecido vira texto, nao some');

assert.deepStrictEqual(parseResumo(''), []);
assert.deepStrictEqual(parseResumo(null), []);


// faixa de anexos derivada dos tramites: substituiu a request a /anexos/:id, entao a
// planificacao tem que achar todo anexo e nao inventar nenhum
assert.deepStrictEqual(anexosDe([{ anexos: [{ id: '1' }] }, { id: 'x' }, { anexos: [{ id: '2' }, { id: '3' }] }]).map(a => a.id), ['1', '2', '3']);
assert.deepStrictEqual(anexosDe([{ id: 'x' }]), [], 'tramite sem anexo nao quebra nem entra na faixa');
assert.deepStrictEqual(anexosDe([]), []);
assert.deepStrictEqual(anexosDe(null), []);

// cache do detalhe: a chave e lastUpdate, porque trâmite novo move lastUpdate. Servir
// tramites velhos como se fossem os atuais e pior que refazer a chamada.
const D1 = { tramites: [{ content: 'velho' }], views: [] };
cachePut('937919', '14/09/2026 10:16:35', D1);
assert.strictEqual(cacheGet('937919', '14/09/2026 10:16:35'), D1, 'mesmo lastUpdate reaproveita');
assert.strictEqual(cacheGet('937919', '14/09/2026 11:20:00'), null, 'lastUpdate novo invalida');
assert.strictEqual(cacheGet('939415', '14/09/2026 10:16:35'), null, 'cache e por ticket');
assert.strictEqual(cacheGet('937919', null), null, 'sem lastUpdate nao ha invalidacao possivel');
cachePut('000', null, D1);
assert.strictEqual(cacheGet('000', null), null, 'e ticket sem lastUpdate nao entra no cache');

// modulos: o usuario digita livre ("wtr, wcx") e o mesmo normalizador recebe o array vindo
// do IPC, onde nada e confiavel. Caixa errada gravaria dois modulos para o mesmo codigo.
assert.deepStrictEqual(normModules('wtr, wcx'), ['WTR', 'WCX']);
assert.deepStrictEqual(normModules('WTR  wtr ,wtr;WTR'), ['WTR'], 'dedupe depois de normalizar a caixa');
assert.deepStrictEqual(normModules(''), []);
assert.deepStrictEqual(normModules(null), []);

// vindo do renderer pelo IPC: nao-string e descartado, nunca convertido — String({})
// gravaria "[object Object]" no config.json, que e o mesmo arquivo da chave da API
assert.deepStrictEqual(normModules(['wce', 42, null, {}, ['x'], 'WCE']), ['WCE']);
assert.deepStrictEqual(normModules({}), [], 'objeto solto nao vira lista');

// teto: o config.json guarda a chave da API, entao nada entra sem limite
assert.strictEqual(normModules(Array.from({ length: 200 }, (_, i) => 'M' + i)).length, MAX_MODULES);

// um modulo mora num repositorio so: o primeiro fica com ele. Sem isto, apontar WTR para
// um repo novo deixaria o antigo respondendo pelo mesmo modulo, e nada na tela diria qual
// dos dois vale.
const u = unicos([{ path: 'A', modules: ['wtr', 'wcx'] }, { path: 'B', modules: ['WCX', 'wce'] }]);
assert.deepStrictEqual(u.map(r => r.modules), [['WTR', 'WCX'], ['WCE']]);
assert.deepStrictEqual(unicos([{ path: 'A', modules: ['WTR'] }, { path: 'B', modules: ['WTR'] }])[1].modules, []);
assert.deepStrictEqual(unicos([]), []);
assert.deepStrictEqual(unicos(null), []);
// o caminho nao pode ser perdido no caminho
assert.strictEqual(unicos([{ path: 'A', modules: [] }])[0].path, 'A');

console.log('ok');


// hotfix: slugTicket e a fronteira com a linha de comando, o nome de branch e o nome de
// arquivo. O que importa nao e o formato bonito, e que NADA de shell sobreviva.
assert.strictEqual(slugTicket(' 938963 '), '938963');
assert.strictEqual(slugTicket('TK-938963'), 'TK-938963');
for (const veneno of ['938963 & calc.exe', '"; rm -rf /', '$(whoami)', 'a|b', 'a`b`c', 'a;b', "a'b", 'a\b']) {
  const s = slugTicket(veneno);
  assert.ok(/^[A-Za-z0-9._-]+$/.test(s), `slug de ${veneno} escapou da allowlist: ${s}`);
}
// barra fora + pontos aparados na frente: path traversal morre sem check proprio
assert.strictEqual(slugTicket('../../evil'), 'evil');
assert.ok(!slugTicket('../../evil').includes('/'));
assert.strictEqual(slugTicket(''), null, 'vazio e null, nao string vazia virando branch sem nome');
assert.strictEqual(slugTicket(null), null);
assert.strictEqual(slugTicket('///'), null, 'so caractere proibido tambem e null');
assert.ok(slugTicket('9'.repeat(200)).length <= MAX_SLUG);

// modulo -> repositorio: o portal manda o modulo como quiser, o config guarda o que o
// usuario digitou. Os dois lados passam por normModules, entao caixa nao pode decidir.
const REPOS = [{ path: 'C:\dev\a', modules: ['WTR'] }, { path: 'C:\dev\b', modules: ['WCX', 'WCE'] }];
assert.strictEqual(repoDe(REPOS, 'wtr').path, 'C:\dev\a');
assert.strictEqual(repoDe(REPOS, 'WCE').path, 'C:\dev\b');
assert.strictEqual(repoDe(REPOS, 'WTR - Transporte').path, 'C:\dev\a', 'modulo com sufixo do portal ainda casa');
assert.strictEqual(repoDe(REPOS, 'WMS'), null, 'modulo sem repo apontado e null, nao o primeiro da lista');
assert.strictEqual(repoDe(REPOS, ''), null);
assert.strictEqual(repoDe([], 'WTR'), null);
assert.strictEqual(repoDe(null, null), null);

// briefing: leva o resumo e os metadados, e avisa o Claude de que o texto do ticket e
// material, nao ordem — e o mesmo risco de injecao que o SYSTEM_PROMPT ja trata
const brf = buildBriefing(
  { number: '938963', title: 'Erro na NF-e', client: 'ACME', module: 'WTR' },
  'ONDE\nFaturamento.', '938963');
assert.ok(brf.includes('938963') && brf.includes('ACME') && brf.includes('Faturamento.'));
assert.ok(brf.includes('nunca instrução'), 'o briefing tem que desarmar instrucao vinda do ticket');
assert.ok(brf.includes('hotfix/938963'), 'diz em qual branch o Claude esta');
assert.ok(buildBriefing({}, '', 'x').includes('(sem resumo)'), 'ticket vazio ainda devolve texto util');
assert.ok(buildBriefing().length > 0, 'sem argumento nenhum nao lanca');

// a mensagem do gitflow quando a branch ja esta la. Sao duas formas e a primeira e a que
// acontece de verdade no AVH — sem ela, o segundo clique no mesmo ticket larga o usuario
// na develop em vez de reabrir a hotfix
assert.ok(jaExiste("Fatal: There is an existing hotfix branch '938963'. Finish that one first."));
assert.ok(jaExiste("Branch 'hotfix/938963' already exists. Pick another name."));
assert.ok(!jaExiste('fatal: couldn\'t find remote ref develop'), 'erro de rede nao vira "ja existe"');
assert.ok(!jaExiste(''), 'vazio nao vira "ja existe"');
assert.ok(!jaExiste(null));


// empacotamento: o .exe leva SO o que esta em build.files, e esquecer um arquivo ali nao
// da erro nenhum no `npm start` — so no executavel, e no boot, porque os require ficam no
// topo dos modulos. Foi o que aconteceu com o modulos.js. Nao e logica, mas mora aqui pelo
// mesmo motivo que o resto: quebra em silencio.
const fs = require('fs');
const pkgFiles = JSON.parse(fs.readFileSync('./package.json', 'utf8')).build.files;
const precisa = new Set();

// o que o renderer carrega por <script src>
for (const m of fs.readFileSync('./index.html', 'utf8').matchAll(/src="([^"]+\.js)"/g)) precisa.add(m[1]);

// o que o main e seus modulos requerem e mora na raiz (ipc/ e services/ ja vao por glob)
for (const dir of ['.', './ipc', './services']) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'test.js') continue;
    for (const m of fs.readFileSync(`${dir}/${f}`, 'utf8').matchAll(/require\('\.\.?\/([\w.-]+)'\)/g)) {
      const alvo = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
      if (fs.existsSync('./' + alvo)) precisa.add(alvo);
    }
  }
}

assert.ok(precisa.has('modulos.js'), 'a varredura tem que enxergar o modulos.js');
assert.ok(precisa.has('sanitize.js') && precisa.has('renderer.js'), 'e os outros arquivos de raiz');
for (const f of precisa) {
  assert.ok(pkgFiles.includes(f), `${f} e carregado em runtime mas falta em build.files: o .exe quebraria no boot`);
}


// headers do protocolo anexo://: a invariante e que o resultado NUNCA derrube Headers().
// Copiar os headers do portal derrubava o processo main — um anexo com nome acentuado vem
// com U+FFFD no Content-Disposition, e Headers.set rejeita isso como ByteString.
const FFFD = String.fromCharCode(65533);
const naoDerruba = h => { new Headers(h); return true; };   // lanca se algum valor for invalido

assert.ok(naoDerruba(respHeaders('image/png', 'png')));
assert.ok(naoDerruba(respHeaders('attachment; filename="Notifica' + FFFD + 'ao.png"', 'png')));
assert.ok(naoDerruba(respHeaders(FFFD + FFFD, null)));
assert.ok(naoDerruba(respHeaders(null, null)));

// o portal marca TODO anexo como attachment; sem o inline o Chromium abre "Salvar como"
assert.strictEqual(respHeaders('image/png', 'png')['Content-Disposition'], 'inline');
assert.strictEqual(respHeaders(null, null)['Content-Disposition'], 'inline');

// tipo bom passa; octet-stream e lixo caem no palpite pela extensao
assert.strictEqual(respHeaders('image/png', 'png')['Content-Type'], 'image/png');
assert.strictEqual(respHeaders('application/octet-stream', 'png')['Content-Type'], 'image/png');
assert.strictEqual(respHeaders('', 'pdf')['Content-Type'], 'application/pdf');
assert.strictEqual(respHeaders('image/' + FFFD, 'png')['Content-Type'], 'image/png', 'tipo com byte invalido nao vira header');

// sem tipo e sem extensao conhecida: melhor nao afirmar nada do que afirmar errado
assert.ok(!('Content-Type' in respHeaders('', 'xyz')));
assert.ok(!('Content-Type' in respHeaders(null, null)));

// Content-Length NAO pode ser repassado: o undici descompacta gzip e o valor do portal se
// refere ao corpo compactado — repassar truncaria o arquivo
assert.ok(!('Content-Length' in respHeaders('image/png', 'png')));


// tamanho do anexo vem como string formatada em pt-BR, nunca numero. Sem ler isso nao da
// para respeitar teto antes de baixar os bytes.
assert.strictEqual(parseSize('114,08 KB'), Math.round(114.08 * 1024));
assert.strictEqual(parseSize('16,45 MB'), Math.round(16.45 * 1048576));
assert.strictEqual(parseSize('1.234,5 KB'), Math.round(1234.5 * 1024), 'ponto e separador de milhar, nao decimal');
assert.strictEqual(parseSize('512 B'), 512);
assert.strictEqual(parseSize('7 KB'), 7168, 'sem casa decimal tambem vale');
assert.strictEqual(parseSize(''), null);
assert.strictEqual(parseSize(null), null);
assert.strictEqual(parseSize('grande'), null, 'lixo vira null, nao NaN silencioso');
assert.strictEqual(parseSize('10 PB'), null, 'unidade fora da tabela nao e adivinhada');

// escolha das imagens. So png/jpg/jpeg/gif/webp: a API nao recebe bmp, e svg esta fora
// pelo mesmo motivo do sanitize.js — svg executa script.
const img = (id, ext, size = '100 KB') => ({ id, name: `f.${ext}`, ext, size });
const tr = (content, anexos) => ({ content, anexos });

const so = escolherAnexos([tr('x', [img('1', 'png'), img('2', 'bmp'), img('3', 'svg'), img('4', 'xlsx'), img('5', 'jpeg')])]);
assert.deepStrictEqual(so.anexos.map(a => a.id), ['1', '4', '5'], 'bmp e svg ficam de fora; planilha entra como texto');
assert.deepStrictEqual(so.anexos.map(a => a.lane), ['image', 'sheet', 'image'], 'cada anexo sai com a pista anotada');
assert.strictEqual(so.viaEscalacao, false);

// video e audio ficam de fora por decisao de produto: token demais para um resumo de
// relance. `.doc` antigo fica de fora porque o mammoth le .docx e nada le OLE binario.
for (const ext of ['mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'doc', 'zip', 'rar', 'pfx', 'exe']) {
  assert.deepStrictEqual(escolherAnexos([tr('x', [img('9', ext)])]).anexos, [], `${ext} nao pode entrar`);
}
// e os que o usuario pediu entram, cada um na sua pista
const PISTAS = { csv: 'texto', xlsx: 'sheet', docx: 'doc', pdf: 'pdf', txt: 'texto', xml: 'texto', png: 'image' };
for (const [ext, lane] of Object.entries(PISTAS)) {
  assert.strictEqual(escolherAnexos([tr('x', [img('9', ext)])]).anexos[0].lane, lane, `${ext} -> ${lane}`);
}

// (a deteccao da escalacao e testada mais abaixo, com o formulario real do portal)

// sem casar, o fallback e o ticket inteiro em ordem cronologica — a API manda do mais
// recente para o mais antigo, e a imagem que explica o problema costuma ser a primeira
const semEsc = escolherAnexos([tr('novo', [img('3', 'png')]), tr('meio', [img('2', 'png')]), tr('velho', [img('1', 'png')])]);
assert.deepStrictEqual(semEsc.anexos.map(a => a.id), ['1', '2', '3'], 'do mais antigo para o mais recente');
assert.strictEqual(semEsc.viaEscalacao, false);

// tetos: quantidade e soma. Um print gigante nao pode comer o orcamento inteiro
const muitas = escolherAnexos([tr('x', [1, 2, 3, 4, 5, 6].map(n => img(String(n), 'png')))]);
assert.strictEqual(muitas.anexos.length, MAX_IMAGENS, 'teto de quantidade');
assert.deepStrictEqual(escolherAnexos([tr('x', [img('1', 'png', '9,5 MB'), img('2', 'png')])]).anexos.map(a => a.id),
  ['2'], 'imagem acima do teto individual sai, as outras continuam');
assert.deepStrictEqual(escolherAnexos([tr('x', [img('1', 'png', '3 MB'), img('2', 'png', '3 MB'), img('3', 'png', '3 MB')])]).anexos.length,
  2, 'teto de soma corta antes da terceira');
assert.deepStrictEqual(escolherAnexos([tr('x', [img('1', 'png', 'ilegivel')])]).anexos.map(a => a.id),
  ['1'], 'tamanho ilegivel nao descarta: o teto de verdade e conferido nos bytes');

// nada disso pode lancar com entrada torta
assert.deepStrictEqual(escolherAnexos([]).anexos, []);
assert.deepStrictEqual(escolherAnexos(null).anexos, []);
assert.deepStrictEqual(escolherAnexos([{}, { anexos: null }, null]).anexos, []);

// blocos de conteudo: imagem ANTES do texto, e o texto diz o que as imagens sao
const blocos = buildContent({ number: '1', title: 'T' }, [{ content: 'c' }],
  [{ name: 'erro.png', mime: 'image/png', b64: 'QUJD' }]);
assert.strictEqual(blocos.length, 2);
assert.strictEqual(blocos[0].type, 'image', 'imagem vem antes do texto que fala dela');
assert.deepStrictEqual(blocos[0].source, { type: 'base64', media_type: 'image/png', data: 'QUJD' });
assert.strictEqual(blocos[1].type, 'text');
assert.ok(blocos[1].text.includes('erro.png'), 'o texto nomeia o anexo');
assert.ok(blocos[1].text.includes('ARQUIVOS ANEXADOS (1)'));

// PDF vai como bloco `document`, nao `image` — sao shapes diferentes na API
const comPdf = buildContent({ number: '1' }, [{ content: 'c' }],
  [{ name: 'danfe.pdf', mime: 'application/pdf', b64: 'QUJD' }]);
assert.strictEqual(comPdf[0].type, 'document');
assert.strictEqual(comPdf[0].source.media_type, 'application/pdf');

// planilha, docx e texto NAO viram bloco: entram convertidos dentro do proprio prompt
const comTexto = buildContent({ number: '1' }, [{ content: 'c' }],
  [{ name: 'notas.csv', texto: 'nota;valor\n123;10,00' }]);
assert.strictEqual(comTexto.length, 1, 'anexo de texto nao cria bloco proprio');
assert.ok(comTexto[0].text.includes('CONTEÚDO DOS ANEXOS'));
assert.ok(comTexto[0].text.includes('notas.csv') && comTexto[0].text.includes('123;10,00'));

// o conteudo do anexo vem DEPOIS dos tramites: a historia do ticket e o que da sentido
// ao arquivo, e nao o contrario
assert.ok(comTexto[0].text.indexOf('TRÂMITES') < comTexto[0].text.indexOf('CONTEÚDO DOS ANEXOS'));

// teto por anexo: uma planilha gigante nao pode empurrar os tramites para fora
const gorda = buildContent({ number: '1' }, [{ content: 'c' }],
  [{ name: 'g.csv', texto: 'x'.repeat(500000) }]);
assert.ok(gorda[0].text.length < 200000, 'anexo gigante e truncado');
assert.ok(gorda[0].text.includes('anexo truncado'), 'e avisa que cortou, em vez de mentir por omissao');

// teto do total, somando varios anexos de texto
const varios = buildContent({ number: '1' }, [{ content: 'c' }],
  Array.from({ length: 6 }, (_, i) => ({ name: `a${i}.txt`, texto: 'y'.repeat(20000) })));
const soAnexos = varios[0].text.slice(varios[0].text.indexOf('CONTEÚDO DOS ANEXOS'));
assert.ok(soAnexos.length <= MAX_TEXTO_TOTAL + 2000, 'o total dos anexos respeita o teto');

// mistura: imagem e PDF viram bloco, o resto vai no texto — e a legenda conta os dois
const mix = buildContent({ number: '1' }, [{ content: 'c' }], [
  { name: 'p.png', mime: 'image/png', b64: 'QQ==' },
  { name: 'd.pdf', mime: 'application/pdf', b64: 'QQ==' },
  { name: 'n.csv', texto: 'a;b' }
]);
assert.deepStrictEqual(mix.map(b => b.type), ['image', 'document', 'text']);
assert.ok(mix[2].text.includes('ARQUIVOS ANEXADOS (2)'), 'a legenda conta so os que viraram bloco');
assert.ok(mix[2].text.includes('1 anexo(s) de texto'), 'e avisa que ha texto mais abaixo');

// sem anexo, o conteudo volta a ser um bloco de texto so — e sem legenda mentindo
const semImg = buildContent({ number: '1' }, [{ content: 'c' }], []);
assert.strictEqual(semImg.length, 1);
assert.strictEqual(semImg[0].type, 'text');
assert.ok(!semImg[0].text.includes('ARQUIVOS ANEXADOS'));
assert.ok(!semImg[0].text.includes('CONTEÚDO DOS ANEXOS'));
assert.strictEqual(buildContent({ number: '1' }, []).length, 1, 'sem argumento de imagem nao quebra');

// imagem pela metade (sem mime ou sem bytes) e descartada em vez de virar bloco invalido
assert.strictEqual(buildContent({}, [], [{ name: 'x.png' }, { mime: 'image/png' }, null]).length, 1);


// deteccao da escalacao. O tramite que passa o ticket para o desenvolvimento e um
// formulario, e estes dois sao texto real do portal — incluindo "Servidor:srv00" sem
// espaco e o "Periodo de Teste:" em branco.
const FORM_A = `Versão de Teste:  2.3.8.2
Caminho: Faturamento > Enviar email
Período de Teste:
Base de Teste: AWS_SAOLUIZEXPRESS
Servidor:srv00
Problema: O erro relatado anteriormente voltou a ocorrer no sistema, poderia verificar por gentileza?`;

const FORM_B = `Versão de Teste: 2.3.7.4
Caminho: Faturas > Enviar email
Período de Teste:
Base de Teste: aws_saoluizexpress
Servidor: srv00
Usuário: sa
Senha: info
Problema: Ao enviar uma fatura por email o sistema retorna erro. Ao verificar as configurações de internet do cliente está tudo normal`;

const ESC_IMG = [{ id: '50', name: 'erro.png', ext: 'png', size: '120 KB' }];

// os dois formatos reais casam, com e sem os campos opcionais Usuario/Senha
assert.deepStrictEqual(escolherAnexos([{ content: FORM_A, anexos: ESC_IMG }]).viaEscalacao, true);
assert.deepStrictEqual(escolherAnexos([{ content: FORM_B, anexos: ESC_IMG }]).viaEscalacao, true);
// sem acento e em caixa alta continua casando: e contagem de rotulo, nao frase exata
assert.strictEqual(escolherAnexos([{ content: FORM_A.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(), anexos: ESC_IMG }]).viaEscalacao, true);

// prosa comum NAO pode virar escalacao, nem quando cita um rotulo solto
for (const texto of [
  'Bom dia, segue em anexo o print do erro.',
  'Sobre o caminho: Faturamento > Enviar email, o cliente confirmou.',
  'Problema: resolvido, pode fechar o ticket.',
  '', null
]) {
  assert.strictEqual(escolherAnexos([{ content: texto, anexos: ESC_IMG }]).viaEscalacao, false,
    `nao era escalacao: ${String(texto).slice(0, 40)}`);
}

// o ticket reescala quando o erro volta numa versao nova (2.3.7.4 -> 2.3.8.2). A lista vem
// do mais recente para o mais antigo, e a escalacao ATUAL e a que o dev tem em maos.
const reescalado = escolherAnexos([
  { content: FORM_A, anexos: [{ id: 'novo', name: 'a.png', ext: 'png', size: '10 KB' }] },
  { content: 'resposta do cliente', anexos: [] },
  { content: FORM_B, anexos: [{ id: 'velho', name: 'b.png', ext: 'png', size: '10 KB' }] }
]);
assert.deepStrictEqual(reescalado.anexos.map(a => a.id), ['novo'], 'pega a escalacao mais recente');
assert.strictEqual(reescalado.viaEscalacao, true);

// escalacao mais recente sem imagem nao encerra a busca: tenta a anterior antes de desistir
const semImgNaNova = escolherAnexos([
  { content: FORM_A, anexos: [] },
  { content: FORM_B, anexos: [{ id: 'velho', name: 'b.png', ext: 'png', size: '10 KB' }] }
]);
assert.deepStrictEqual(semImgNaNova.anexos.map(a => a.id), ['velho']);
assert.strictEqual(semImgNaNova.viaEscalacao, true);

// o formulario nao pode cair no corte: e ele que traz versao, caminho, base e servidor, e
// e dele que vieram as imagens. Sem reservar espaco, num ticket longo ele e o primeiro a
// sumir — e a imagem chega sem o texto que a explica.
const longo = [
  { date: '20/01/2026 10:00', content: 'ultimo tramite' },
  ...Array.from({ length: 30 }, (_, i) => ({ date: `1${i % 10}/01/2026 10:00`, content: 'R'.repeat(5000) + ' ruido' + i })),
  { date: '01/01/2026 09:00', content: FORM_A, anexos: ESC_IMG }   // o mais ANTIGO de todos
];
const cortadoEsc = buildPrompt({ number: '9' }, longo);
assert.ok(cortadoEsc.length <= MAX_PROMPT_CHARS, 'o teto continua valendo');
assert.ok(cortadoEsc.includes('2.3.8.2'), 'a escalacao sobrevive ao corte mesmo sendo a mais antiga');
assert.ok(cortadoEsc.includes('AWS_SAOLUIZEXPRESS'), 'com os campos que o dev precisa');
assert.ok(cortadoEsc.includes('FORMULÁRIO DE ESCALAÇÃO'), 'e marcada para o modelo saber o que e');
assert.ok(cortadoEsc.includes('ultimo tramite'), 'o mais recente continua entrando sempre');
assert.ok(/omitido/.test(cortadoEsc), 'e ainda avisa que cortou');

// a ordem cronologica nao pode quebrar por causa da reserva
const iEsc = cortadoEsc.indexOf('2.3.8.2');
const iUlt = cortadoEsc.indexOf('ultimo tramite');
assert.ok(iEsc < iUlt, 'a escalacao (mais antiga) aparece antes do ultimo tramite');

// ticket sem escalacao nenhuma se comporta como antes
assert.ok(buildPrompt({ number: '9' }, [{ content: 'so isso' }]).includes('so isso'));
assert.ok(!buildPrompt({ number: '9' }, [{ content: 'so isso' }]).includes('FORMULÁRIO DE ESCALAÇÃO'));


// lerDocs: le os .md da RAIZ do repo do modulo, em ordem, com teto. Ler doc nunca pode
// derrubar o resumo — caminho que nao existe, arquivo ilegivel ou repo sem .md devolvem
// string vazia e o resumo sai como sempre saiu.
const tmpRepo = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'tickets-docs-'));
fs.writeFileSync(`${tmpRepo}/CLAUDE.md`, 'hub de saldo: VGCE.pas');
fs.writeFileSync(`${tmpRepo}/CONVENCAO_RESUMO_TASK.md`, 'TASKS-DOC por modulo');
fs.writeFileSync(`${tmpRepo}/README.txt`, 'nao e markdown');
fs.mkdirSync(`${tmpRepo}/Desenvolvimento`);
fs.writeFileSync(`${tmpRepo}/Desenvolvimento/FUNDO.md`, 'md de subpasta');

const docs = lerDocs(tmpRepo);
assert.ok(docs.includes('VGCE.pas') && docs.includes('TASKS-DOC'), 'todo .md da raiz entra');
assert.ok(docs.includes('--- CLAUDE.md ---'), 'cada doc vem nomeada');
assert.ok(!docs.includes('nao e markdown'), 'so .md');
assert.ok(!docs.includes('md de subpasta'), 'so a raiz: o repo inteiro traria milhares de arquivos');
assert.ok(docs.indexOf('VGCE.pas') < docs.indexOf('TASKS-DOC'), 'ordem estavel, nao a do filesystem');

fs.writeFileSync(`${tmpRepo}/GORDA.md`, 'G'.repeat(MAX_DOCS_CHARS * 2));
const cortada = lerDocs(tmpRepo);
assert.ok(cortada.length <= MAX_DOCS_CHARS + 500, 'doc gigante nao estoura o teto');
assert.ok(/truncada/.test(cortada), 'e avisa que cortou');

assert.strictEqual(lerDocs(`${tmpRepo}/nao-existe`), '', 'repo que sumiu do disco nao lanca');
assert.strictEqual(lerDocs(''), '', 'modulo sem repositorio apontado');
assert.strictEqual(lerDocs(null), '', 'nem null');
fs.rmSync(tmpRepo, { recursive: true, force: true });


// update: comparacao de versao. Comparar como string diria que "1.9.0" > "1.10.0" e o app
// pararia de avisar justamente a partir da decima correcao.
assert.strictEqual(maisNova('v1.10.0', '1.9.0'), true, 'compara numero, nao texto');
assert.strictEqual(maisNova('v1.0.1', '1.0.0'), true);
assert.strictEqual(maisNova('1.0.0', '1.0.0'), false, 'mesma versao nao e novidade');
assert.strictEqual(maisNova('0.9.9', '1.0.0'), false, 'release antiga nao faz "atualizar" para tras');
assert.strictEqual(maisNova('1.2', '1.2.0'), false, 'parte que falta e zero, nao novidade');
assert.strictEqual(maisNova('v2', '1.9.9'), true);
// tag fora do padrao nao pode virar atualizacao fantasma pedindo download a cada abertura
assert.strictEqual(maisNova('', '1.0.0'), false);
assert.strictEqual(maisNova(null, '1.0.0'), false);
assert.strictEqual(maisNova('nightly', '1.0.0'), false);

// Notificacao de ticket novo: quem decide e a diferenca entre duas cargas, por numero.
const fila = [{ number: '938963' }, { number: '939001' }];
assert.deepStrictEqual(ticketsNovos(null, fila), [], 'primeira carga nunca notifica a fila inteira');
assert.strictEqual(ticketsNovos(fila, fila).length, 0, 'mesma fila nao gera toast a cada refresh');
assert.deepStrictEqual(ticketsNovos(fila, [...fila, { number: '939100' }]).map(t => t.number), ['939100']);
assert.strictEqual(ticketsNovos(fila, []).length, 0, 'ticket que saiu da fila nao e novidade');
assert.strictEqual(ticketsNovos([], fila).length, 2, 'fila vazia que recebe tickets notifica');


// A faixa .notice e UM no disputado por tres avisos: erro de refresh, erro da atualizacao e
// "existe versao nova". Reusar o no significa herdar o estado de quem passou por ali — o
// "Baixando…" desabilita o botao, e sem zerar isso o "Tentar de novo" seguinte nasce morto.
// O stub de DOM entra depois do require de proposito: renderer.js chama wire() ao carregar
// quando enxerga um document.
const botao = { hidden: false, disabled: false, textContent: '', onclick: null };
const faixa = { dataset: {}, hidden: true, querySelector: sel => sel === 'span' ? { textContent: '' } : botao };
global.document = { getElementById: () => faixa };

showNoticeIn('notice', 'stale', 'ha versao nova', 'Instalar e reabrir', () => {});
botao.disabled = true;                                    // o que o estado "Baixando…" faz
showNoticeIn('notice', 'down', 'falhou', 'Tentar de novo', () => {});
assert.strictEqual(botao.disabled, false, 'faixa repintada devolve o botao clicavel');
assert.strictEqual(botao.textContent, 'Tentar de novo');
assert.strictEqual(faixa.dataset.kind, 'down');

showNoticeIn('notice', 'stale', 'so o fato, sem acao', null, null);
assert.strictEqual(botao.hidden, true, 'faixa sem acao nao deixa o botao anterior na tela');
delete global.document;


// A cor do status pessoal vai para um style inline e o id vira chave da marca: ipc/status.js
// e a fronteira dos dois. Item malformado some sozinho, como em set-repos — uma linha ruim
// nao pode derrubar a lista inteira, que salva sozinha.
const { limpar: limparStatus, DEFAULTS, MAX_DEFS, MAX_NOME } = require('./ipc/status.js');

assert.strictEqual(limparStatus(null), null);
assert.strictEqual(limparStatus('{}'), null, 'string nao e blob');
assert.deepStrictEqual(limparStatus({}), { defs: [], por: {} });
assert.deepStrictEqual(limparStatus({ defs: DEFAULTS, por: {} }).defs, DEFAULTS, 'os padroes passam pela propria fronteira');

const st = limparStatus({
  defs: [
    { id: 'olhando', nome: '  Olhando  ', cor: '#5AA9FF' },
    { id: 'olhando', nome: 'id repetido', cor: '#ffffff' },
    { id: 'id com espaco', nome: 'id fora da allowlist', cor: '#ffffff' },
    { id: 'semcor', nome: 'cor por nome', cor: 'red' },
    { id: 'aspas', nome: 'cor que escapa do style', cor: '#fff" onload="x' },
    { id: 'vazio', nome: '   ', cor: '#ffffff' }
  ],
  por: { 939100: 'olhando', 939101: 'apagado', 939102: 42 }
});
assert.deepStrictEqual(st.defs, [{ id: 'olhando', nome: 'Olhando', cor: '#5aa9ff' }], 'so o primeiro item presta');
assert.deepStrictEqual(st.por, { 939100: 'olhando' }, 'marca para status que nao existe mais nao e gravada');

const muitos = Array.from({ length: 30 }, (_, i) => ({ id: 'id' + i, nome: 'n' + i, cor: '#ffffff' }));
assert.strictEqual(limparStatus({ defs: muitos }).defs.length, MAX_DEFS);
assert.strictEqual(limparStatus({ defs: [{ id: 'a', nome: 'x'.repeat(80), cor: '#ffffff' }] }).defs[0].nome.length, MAX_NOME);
