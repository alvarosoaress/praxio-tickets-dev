// Converte bytes de anexo em algo que o renderer consiga mostrar. Sem rede e sem disco:
// recebe o Buffer e devolve texto ou HTML. As bibliotecas pesadas ficam fora do renderer,
// e o HTML daqui ainda passa por sanitize.js antes de entrar no DOM — nao e "conteudo
// nosso", e um arquivo que um cliente enviou.
const MAX_CONVERT_BYTES = 25 * 1024 * 1024; // xlsx/docx convertem em memoria; zip de 16MB existe na base

// So os tipos que o visualizador abre; usado quando o portal responde octet-stream.
const MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogg: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4'
};

// Allowlist dos headers que o protocolo anexo:// devolve. Fail-closed como o sanitize.js:
// monta do zero em vez de copiar o que o portal mandou e corrigir depois.
//
// Copiar derrubava o processo main. Um anexo com nome acentuado vem como
// `Content-Disposition: attachment; filename="Notificação.png"`, o valor chega com U+FFFD
// e Headers.set o rejeita como ByteString (65533 > 255). E o header nem era usado: o
// portal marca TODO anexo como attachment e nos sobrescrevemos para inline de qualquer jeito.
//
// Content-Length fica de fora de proposito: o undici descompacta gzip sozinho, e o valor
// do portal se refere ao corpo compactado — repassa-lo truncaria o arquivo.
function respHeaders(contentType, ext) {
  const ct = String(contentType || '');
  // Tipo MIME e ASCII imprimivel. Valor fora disso e lixo, e vira o palpite pela extensao.
  const limpo = /^[\x20-\x7e]+$/.test(ct) && !ct.startsWith('application/octet-stream') ? ct : '';
  const h = { 'Content-Disposition': 'inline' };
  const bom = limpo || MIME[ext] || '';
  if (bom) h['Content-Type'] = bom;
  return h;
}

function toText(buffer) {
  const text = buffer.toString('utf8');
  // Muito .sql/.txt da base vem em cp1252; o U+FFFD denuncia o decode errado.
  return text.includes('�') ? buffer.toString('latin1') : text;
}

// Devolve { sheets: [{ name, html }] } ou { error }. Uma aba por planilha; o .docx
// vira uma "aba" so, para o visualizador ter um caminho unico.
async function toHtml(buffer, kind) {
  try {
    if (kind === 'sheet') {
      // require dentro da funcao: o topo do processo main fica leve.
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      return {
        sheets: wb.SheetNames.map(name => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { id: 'sheet' })
        }))
      };
    }
    const { convertToHtml } = require('mammoth');
    const out = await convertToHtml({ buffer });
    return { sheets: [{ name: 'documento', html: out.value }] };
  } catch (e) {
    return { error: 'Não foi possível ler este arquivo: ' + e.message };
  }
}

// Versao TEXTO dos mesmos conversores. O visualizador usa toHtml porque a tela precisa de
// tabela; aqui o destino e um modelo, e markup e so token a mais dizendo a mesma coisa —
// uma planilha em CSV custa uma fracao do mesmo dado em <table>. Mesmas duas bibliotecas,
// nenhuma dependencia nova.
//
// Nunca lanca: { text } ou { error }.
async function toPlain(buffer, kind) {
  try {
    if (kind === 'sheet') {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      // O nome da aba entra: numa planilha de varias abas ele costuma ser o unico rotulo
      // que diz do que aquele bloco de numeros e.
      return { text: wb.SheetNames.map(n => `--- ${n} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n') };
    }
    if (kind === 'doc') {
      const { extractRawText } = require('mammoth');
      return { text: (await extractRawText({ buffer })).value };
    }
    return { text: toText(buffer) };
  } catch (e) {
    return { error: 'Não foi possível ler este arquivo: ' + e.message };
  }
}

// Quantas paginas o PDF tem, quando da para saber sem biblioteca.
//
// ponytail: contagem por regex no cru. PDF 1.5+ pode guardar os objetos de pagina dentro de
// object streams comprimidos, e ai nao aparece nada e isto devolve null. E um teto
// oportunista: quando da para contar, corta cedo; quando nao da, quem segura e o teto de
// bytes. Upgrade seria uma dependencia de parser de PDF, que a regra #15 nao paga por isto.
function paginasPdf(buffer) {
  try {
    const m = buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    return m ? m.length : null;
  } catch { return null; }
}

module.exports = { MAX_CONVERT_BYTES, MIME, respHeaders, toText, toHtml, toPlain, paginasPdf };
