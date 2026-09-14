'use strict';

// O conteudo dos tramites vem cru do portal da Praxio (HTML escrito por clientes e
// operadores). O sla-dashboard injeta isso com dangerouslySetInnerHTML; num renderer
// Electron isso nao passa. Aqui a politica e fail-closed: so o que esta na allowlist
// sobrevive, e nenhum atributo passa exceto href em <a>.

const PORTAL_BASE = 'https://portaldocliente.praxio.com.br';

// Tags mantidas com a propria caixa semantica.
const KEEP = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Tags cujo conteudo inteiro e descartado (nao so a tag).
const NUKE = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript',
  'template', 'svg', 'math', 'link', 'meta', 'base', 'form', 'input',
  'button', 'select', 'textarea', 'audio', 'video', 'source']);

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// Resolve href relativo contra o portal e recusa tudo que nao for http/https/mailto
// (javascript:, data:, vbscript:, file: ...). Retorna null quando o link nao presta.
function safeHref(raw, URLImpl) {
  const U = URLImpl || (typeof URL !== 'undefined' ? URL : null);
  if (!U || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  let u;
  try { u = new U(v, PORTAL_BASE); } catch { return null; }
  return SAFE_PROTOCOLS.has(u.protocol) ? u.href : null;
}

// Imagens embutidas em data: URI sao seguras (nao executam) e sao como o mammoth
// entrega as figuras de um .docx. SVG fica de fora: SVG carrega script.
const SAFE_IMG = /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i;

function safeImage(src, doc) {
  if (typeof src === 'string' && SAFE_IMG.test(src.trim())) {
    const img = doc.createElement('img');
    img.setAttribute('src', src.trim());
    return img;
  }
  // Caso geral: a CSP bloqueia origem remota e o portal exige sessao, entao um
  // <img> apontando para la so renderizaria um icone quebrado.
  const s = doc.createElement('span');
  s.className = 'tr-img';
  s.textContent = '[imagem — ver no portal]';
  return s;
}

function clean(node, doc, out) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {                       // texto
      out.appendChild(doc.createTextNode(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue;               // comentario e afins: fora
    const tag = child.tagName.toLowerCase();
    if (NUKE.has(tag)) continue;
    if (tag === 'img') { out.appendChild(safeImage(child.getAttribute('src'), doc)); continue; }

    if (!KEEP.has(tag)) {                             // fail-closed: perde a tag, mantem o texto
      clean(child, doc, out);
      continue;
    }

    const safe = doc.createElement(tag);
    if (tag === 'a') {
      const href = safeHref(child.getAttribute('href'));
      if (href) {
        safe.setAttribute('href', href);
        safe.setAttribute('target', '_blank');
        safe.setAttribute('rel', 'noreferrer');
      }
    }
    clean(child, doc, safe);
    out.appendChild(safe);
  }
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const frag = document.createDocumentFragment();
  clean(doc.body, document, frag);
  return frag;
}

if (typeof module !== 'undefined') module.exports = { safeHref, KEEP, NUKE, PORTAL_BASE, SAFE_IMG };
