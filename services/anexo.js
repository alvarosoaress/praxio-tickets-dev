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

module.exports = { MAX_CONVERT_BYTES, MIME, toText, toHtml };
