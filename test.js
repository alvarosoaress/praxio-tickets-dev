// node test.js — checa o parser de data BR e o mecanismo de envelhecimento,
// que e o sinal principal da tela. Sem framework de proposito.
const assert = require('assert');
const { parseBR, minutesSince, ageLabel, ageBucket, statusKey, matches, prettyXml, kindOf, anexosDe, cacheGet, cachePut } = require('./renderer.js');
const { safeHref, KEEP, NUKE, PORTAL_BASE } = require('./sanitize.js');
const { buildPrompt, parseResult, MAX_PROMPT_CHARS } = require('./services/claude.js');
const { parseResumo } = require('./renderer.js');
const { normModules, unicos, MAX_MODULES } = require('./modulos.js');

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

// saida do CLI: is_error traz o motivo dentro de result ("Not logged in"), e e isso que o
// usuario precisa ler — traduzir esconderia a causa
assert.deepStrictEqual(parseResult(JSON.stringify({ result: '  resumo  ' })), { text: 'resumo' });
assert.deepStrictEqual(parseResult(JSON.stringify({ result: 'Not logged in', is_error: true })), { error: 'Not logged in' });
assert.ok(parseResult('nao e json').error, 'stdout quebrado vira error, nao excecao');
assert.ok(parseResult('').error, 'stdout vazio vira error');
assert.ok(parseResult(JSON.stringify({ result: '' })).error, 'resumo vazio e erro, nao sucesso silencioso');


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
