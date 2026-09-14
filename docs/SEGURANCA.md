# Segurança

> **Por que existe:** este app renderiza HTML escrito por clientes e operadores, e abre
> arquivos que eles enviaram. Num renderer Electron, "é só um ticket de suporte" não é
> argumento — é uma superfície de execução.

---

## As quatro fronteiras

| Fronteira | O que atravessa | Onde é defendida |
| --- | --- | --- |
| Portal → app | `contentHtml` dos trâmites, arquivos de anexo | `sanitize.js`, CSP |
| Renderer → mundo | Qualquer requisição de rede | CSP + rede só no main |
| Cliente → API | `ticketId`, `anexoId` | Validação numérica nos dois lados |
| Disco | A chave de 104 caracteres | `config.json` no `userData` |

---

## 1. HTML do portal

### O problema

`contentHtml` vem de `contentEl.innerHTML` raspado direto da resposta do portal
(`portal-scraper/tramites.js`). É HTML arbitrário escrito por quem abriu o ticket. Numa
varredura de 26 trâmites reais apareceram `a`, `b`, `br`, `div`, `li`, `p`, `strong`, `ul`,
com atributos `class`, `href`, `rel`, `style`, `target`, `title` — e nada garante que a
próxima mensagem não traga `<script>` ou `onerror=`.

O `sla-dashboard` injeta esse mesmo HTML com `dangerouslySetInnerHTML`, sem sanitizar.
Numa aba de browser isso já é XSS; num renderer Electron seria bem pior.

### A política: fail-closed

`sanitize.js` usa `DOMParser` e reconstrói a árvore do zero. Nada é copiado por padrão.

| Categoria | Comportamento |
| --- | --- |
| Tag na allowlist (`KEEP`, `sanitize.js:11`) | Elemento recriado, **sem nenhum atributo** |
| Tag na denylist (`NUKE`, `sanitize.js:17`) | Elemento **e conteúdo** descartados |
| Tag desconhecida | Tag some, texto interno sobrevive |
| Comentário, `<!DOCTYPE>`, nó estranho | Descartado |
| `<img>` | Caso especial, abaixo |

`NUKE` cobre `script`, `style`, `iframe`, `object`, `embed`, `noscript`, `template`, `svg`,
`math`, `link`, `meta`, `base`, `form`, `input`, `button`, `select`, `textarea`, `audio`,
`video`, `source`.

**Nenhum atributo passa**, com uma exceção: `href` em `<a>`.

### `href`

`safeHref()` (`sanitize.js:25`) resolve o valor contra a base do portal e só aceita
`http:`, `https:` e `mailto:`. `javascript:`, `data:`, `vbscript:` e `file:` viram `null`, e
o link vira texto comum. Links aprovados ganham `target="_blank" rel="noreferrer"`.

O `test.js` cobre caixa misturada e espaços em volta (`  JaVaScRiPt:alert(1)  `), que é
como esse tipo de bypass costuma aparecer.

### `<img>`

Imagem remota não renderizaria de qualquer jeito (a CSP bloqueia, e o portal exige sessão),
então vira um marcador textual `[imagem — ver no portal]`.

A exceção é `data:image/…;base64` (`SAFE_IMG`, `sanitize.js:37`), que é como o mammoth
entrega as figuras de um `.docx`. Data-URI de imagem não executa — **mas SVG sim**, e por
isso `svg+xml` está fora do regex.

### Vale também para o que nós geramos

A saída do SheetJS e do mammoth passa pelo mesmo sanitizador antes de entrar no DOM. As
bibliotecas são confiáveis; o arquivo que elas leram não é.

---

## 2. CSP

Declarada em `index.html`:

```
default-src 'none';
style-src   'self' 'unsafe-inline';
script-src  'self';
img-src     'self' data: anexo:;
media-src   anexo:;
frame-src   anexo:;
```

| Diretiva | Por que está assim |
| --- | --- |
| `default-src 'none'` | Nada é permitido sem estar escrito abaixo. Não há `connect-src`: **o renderer não faz rede** |
| `script-src 'self'` | Só os arquivos locais. Sem `unsafe-inline`, sem `unsafe-eval`, sem CDN |
| `style-src 'unsafe-inline'` | Concessão consciente: o zoom da imagem escreve `transform` inline. Estilo inline não executa código, e o sanitizador remove `style` de todo HTML não confiável — então conteúdo do portal não alcança essa permissão |
| `img-src data:` | Figuras de `.docx` e o chevron dos selects |
| `anexo:` em img/media/frame | O protocolo local. Nunca `https:` genérico |

O que **não** está lá é tão importante: nenhuma origem externa, em nenhuma diretiva. O app
não carrega uma fonte, um script ou uma imagem da internet.

---

## 3. Superfície do processo

- `contextIsolation` fica no padrão (ligado); `nodeIntegration` fica desligado.
- `preload.js` expõe 7 funções nomeadas. O renderer não tem acesso a `ipcRenderer`, a
  `require`, nem ao `fs`.
- `setWindowOpenHandler` (`main.js:170`) nega toda abertura de janela e manda a URL para o
  browser do sistema. Link de ticket ou de trâmite nunca abre uma janela Electron.
- `Menu.setApplicationMenu(null)` remove o menu padrão, e com ele os atalhos de devtools e
  de recarregar em produção.

---

## 4. Validação de id

`ticketId` e `anexoId` são checados com `/^\d+$/` no app (`main.js:75`, `main.js:84`, e no
handler do protocolo) **e de novo** na API (`portal-scraper/index.js:459` e `:476`).

A validação do lado da API é a que importa de verdade: a URL do portal é montada lá a
partir de um id numérico. Se o id viesse do cliente como string livre, `/anexo/..%2F..%2F`
viraria um proxy autenticado para qualquer caminho do portal — a API tem sessão de operador.

Redundante de propósito. O app valida para dar erro cedo; a API valida porque é ela que
tem o poder.

---

## 5. A chave

- Digitada pelo usuário na primeira execução, salva em `%APPDATA%\tickets\config.json`.
- **Nunca** em arquivo versionado, variável de build ou log.
- Não chega ao renderer: o main lê do disco a cada uso.
- Validada como exatamente 104 caracteres ao salvar. Como a API compara só os 104 primeiros
  bytes, uma chave com lixo no fim passaria na API e falharia aqui — de propósito.
- `config.json` é lido com `catch` vazio: arquivo ausente e arquivo corrompido significam a
  mesma coisa, "ainda não configurado", que é o caminho de primeira execução.

⚠️ O arquivo é texto puro. Quem tiver acesso ao perfil do Windows lê a chave. Trocar por
`safeStorage` do Electron é uma melhoria pendente — e mudaria o modelo de ameaça de
"qualquer processo do usuário" para "qualquer processo do usuário com a DPAPI dele", o que
não é enorme, mas é melhor.

---

## Dependências

Duas, ambas rodando no main sobre arquivo não confiável. Por isso `npm audit` importa aqui
mais que o normal.

| Pacote | Origem | Nota |
| --- | --- | --- |
| `xlsx` | `cdn.sheetjs.com/xlsx-0.20.3` | **Não usar o do npm.** A 0.18.5 publicada lá tem prototype pollution (GHSA-4r6h-8v6p-xvw6) e ReDoS (GHSA-5pgg-2g8v-p4x9), sem correção. A SheetJS publica as versões corrigidas só no CDN próprio |
| `mammoth` | npm | Sem alerta conhecido |

`npm audit` deve sair limpo. Se aparecer alerta em algo que toca arquivo de cliente, isso é
bloqueio, não aviso.

---

## Fora de escopo

- **Assinatura de código do `.exe`.** Sem certificado, o SmartScreen avisa na primeira
  execução em cada máquina.
- **Rotação da chave.** Trocar é apagar `config.json` ou usar "Trocar chave" na UI; não há
  expiração nem revogação por cliente — a API tem uma chave só para todo mundo.
- **Verificação de integridade do que a API devolve.** O app confia na API; a API confia no
  portal. A cadeia inteira é TLS e nada além disso.
