// node test.js — checa o parser de data BR e o mecanismo de envelhecimento,
// que e o sinal principal da tela. Sem framework de proposito.
const assert = require('assert');
const { parseBR, minutesSince, ageLabel, ageBucket, statusKey, matches, prettyXml, kindOf } = require('./renderer.js');
const { safeHref, KEEP, NUKE, PORTAL_BASE } = require('./sanitize.js');

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

console.log('ok');
