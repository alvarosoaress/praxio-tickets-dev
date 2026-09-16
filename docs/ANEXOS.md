# Anexos

> **Por que um doc só para isso:** o pipeline atravessa quatro camadas (portal → API →
> processo main → renderer) e concentra as quatro armadilhas que mais custaram tempo no
> projeto. Nenhuma delas é óbvia lendo só um dos lados.

**Princípio de produto:** pré-visualizar sem baixar nada. Nenhum byte de anexo toca o
disco, em nenhum momento.

---

## O caminho completo

```
portal                          API                      main                renderer
──────                          ───                      ────                ────────
/Ticket/TicketTramitesAnexos                                       ┌─▶  chips no trâmite
  ?id_tramite=7661055    ──▶  GET /tramites/:id   ──▶  IPC         ─┤
                                 ?anexos=1              'ticket-detail'  └─▶  faixa do topo
                                                                        (anexosDe: flatMap)
/Anexo/CadastroAnexoDownload/1218235
                         ──▶  GET /anexo/:id      ──▶  anexo://portal/:id  ──▶ <img>/<iframe>
                                                   └▶  IPC 'anexo-text'    ──▶ <pre>
                                                   └▶  IPC 'anexo-html'    ──▶ tabela / doc
```

---

## Por que precisa passar pela API

A extensão `praxioscript` consegue pré-visualizar anexos com um `fetch` simples porque roda
**dentro da aba logada do portal** — o cookie de sessão vai junto de graça
(`credentials: "same-origin"`).

Este app não tem sessão do portal. Quem tem é a API. Então os bytes obrigatoriamente fazem
o desvio: portal → API → app. Não existe atalho, e foi por isso que a feature exigiu duas
rotas novas no `portal-scraper`.

---

## Onde aparecem, e por que em dois lugares

Respondem a perguntas diferentes:

| Lugar | Pergunta que responde | Comportamento |
| --- | --- | --- |
| Faixa fixa abaixo dos metadados | "o arquivo existe em algum lugar neste ticket?" | Todos os anexos, rolagem horizontal |
| Dentro do trâmite, depois do texto | "o que veio junto **com esta mensagem**?" | Só os do trâmite, quebra linha |

A faixa do topo é fixa, não acordeão: os anexos são o motivo de muita gente abrir o ticket,
e escondê-los atrás de um clique inverteria a prioridade.

**As duas listas vêm da mesma resposta.** A faixa já foi uma chamada a `GET /anexos/:id`;
hoje é `anexosDe(tramites)`, um `flatMap` sobre o que o `?anexos=1` já trouxe. As duas rotas
devolvem exatamente os mesmos arquivos — conferido nos 4 tickets da fila, zero diferença de
id — e o portal serializa requisições da mesma sessão, então a chamada extra não era grátis:
entrava na fila na frente dos trâmites. A única coisa que se perde é `uploadedAt`, que o
partial por trâmite não traz; ele aparecia no `title` do chip e no meta do visualizador, e
os dois já filtravam valor vazio.

Dentro do trâmite os chips **quebram linha em vez de rolar** — no meio do texto, um arquivo
escondido atrás de scroll horizontal simplesmente desaparece.

---

## As quatro armadilhas

### 1. O id vai no path, nunca no host

O protocolo é registrado como `standard` (`main.js`), o que é necessário para
`supportFetchAPI` e `stream`. Efeito colateral: o parser de URL trata o host como possível
IPv4 em notação decimal.

```
anexo://1218235        →  host = "0.18.150.187"   ❌ o id é destruído
anexo://portal/1218235 →  path = "/1218235"       ✅
```

O sintoma é cruel: a imagem vira ícone quebrado, **sem violação de CSP no console**, porque
a requisição sai e chega num lugar que não existe.

### 2. `Content-Disposition: attachment` vaza do portal

O portal marca **todo** anexo como `attachment`. A rota `/anexo/:id` repassa o header. Se o
app repassar de novo para o Chromium, um PDF em `<iframe>` abre o diálogo "Salvar como" em
vez de renderizar — exatamente o oposto do que a feature existe para fazer.

O handler força `inline` (`ipc/anexos.js`) e, quando o portal responde `application/octet-stream`,
completa o tipo a partir da extensão (`?ext=pdf` → tabela `MIME` em `services/anexo.js`).

Imagens não sofriam com isso — `<img>` ignora `Content-Disposition` —, então o bug só
apareceu ao testar PDF. Lição: testar **um formato de cada família de elemento**
(`<img>`, `<iframe>`, `<video>`), não um formato qualquer.

### 3. `fetch('anexo://…')` do renderer morre em CORS

O protocolo é outra origem. Um `fetch` da página para ele é cross-origin e a resposta não
carrega `Access-Control-Allow-Origin`.

| Tipo | Como chega no renderer | Por quê |
| --- | --- | --- |
| imagem, vídeo, áudio, pdf | URL `anexo://` direto no elemento | Elementos de mídia não passam por CORS |
| texto, xml, sql, csv, json | IPC `anexo-text` | Evita CORS e já resolve encoding |
| xlsx, docx | IPC `anexo-html` | Conversão acontece no main |

### 4. Nome de arquivo acentuado derrubava o processo main

Um anexo chamado `Notificação.png` vinha com
`Content-Disposition: attachment; filename="Notificação.png"`. Com `net.fetch` do Electron,
esse valor chega ao `Headers` com **U+FFFD** no lugar do acento, e `Headers.set` o rejeita
como ByteString (`65533 > 255`). A exceção acontece **dentro do Electron**, antes de
qualquer linha nossa — sem `try/catch` possível — e o app inteiro morre em
"A JavaScript error occurred in the main process".

O sintoma enganava: `.png` e `.pdf` quebravam, `.txt` e `.xlsx` não. Não era o tipo do
arquivo — era o caminho. Mídia usa `anexoStream` (`net.fetch`); texto e planilha usam
`anexoBytes`, que sempre usou o `fetch` global (undici), e o undici decodifica header em
latin1, que **nunca** produz U+FFFD.

Dois consertos, porque um só não bastava:

1. **`anexoStream` usa o `fetch` global**, não o `net.fetch`. É o único que impede a
   exceção, já que ela nasce dentro do Electron.
2. **Nenhum header do portal é copiado.** `respHeaders()` (`services/anexo.js`) monta a
   resposta do zero — `Content-Disposition: inline` e, quando dá para afirmar,
   `Content-Type`. Fail-closed, como o `sanitize.js`. O header que derrubava o app nem era
   usado: o portal marca **todo** anexo como `attachment` e nós sobrescrevemos sempre.

`Content-Length` ficou de fora de propósito: o undici descompacta gzip sozinho, e o valor
do portal se refere ao corpo compactado — repassá-lo truncaria o arquivo.

E o handler do protocolo ganhou `try/catch`. Diferente de um `ipcMain.handle`, ele não tem
rede embaixo: qualquer exceção ali derruba o processo, então falha agora vira `502`.

---

## Conversão de planilha e `.docx`

Acontece no **processo main** (`ipc/anexos.js`), não no renderer. Três motivos:

1. As bibliotecas ficam fora da página — nada a acrescentar à CSP, nada a servir local.
2. O renderer não precisa dos bytes, só do HTML pronto.
3. O HTML gerado ainda passa por `sanitizeHtml()` antes de entrar no DOM. SheetJS e mammoth
   são confiáveis; **o arquivo que eles leram não é**.

Teto de 25 MB (`MAX_CONVERT_BYTES`, `services/anexo.js`): a conversão é em memória e existe `.zip`
de 16 MB na base. Acima disso, a UI diz que o arquivo é grande demais em vez de travar.

Figuras de `.docx` sobrevivem porque o mammoth as entrega como `data:image/…` e o
sanitizador aceita esse caso específico — menos SVG, que carrega script.

---

## Formatos

| Família | Extensões | Como abre |
| --- | --- | --- |
| imagem | png, jpg, jpeg, gif, webp, bmp, svg | `<img>` com zoom na roda e arrasto; duplo clique reseta |
| vídeo | mp4, webm, mov, ogg, ogv, mkv | `<video controls>` |
| áudio | mp3, wav, m4a, aac, oga | `<audio controls>` |
| pdf | pdf | `<iframe>` no visualizador nativo do Chromium |
| planilha | xlsx, xlsm, xls, ods | SheetJS → tabela; abas quando há mais de uma planilha |
| documento | docx | mammoth → HTML |
| xml | xml, xsd, xsl, html, svgz | `prettyXml()` → `<pre>` |
| texto | txt, log, sql, csv, tsv, json, md, ini, conf, cfg, yml, yaml, bat, ps1, cs, js, ts, css | `<pre>` monoespaçado |
| arquivo | zip, rar, 7z, gz, tar | **sem preview** — mensagem + botão do portal |
| resto | pfx, exe, … | idem |

A classificação sai da extensão (`KINDS`, `renderer.js:243`) porque a listagem do portal não
manda mime. Chip de tipo sem preview leva borda tracejada — o usuário sabe antes de clicar.

### `prettyXml`

XML de NF-e chega numa linha só de dezenas de milhares de caracteres. `prettyXml()`
(`renderer.js:331`) indenta e mantém elemento de folha numa linha só (`<cUF>14</cUF>`).
É um parser, então tem checagem em `test.js` — inclusive para garantir que nenhum conteúdo
se perde na formatação.

### Encoding de texto

Decodifica como UTF-8; se aparecer `U+FFFD`, refaz em latin1 (`services/anexo.js`). Muito `.sql` e
`.txt` da base vem em cp1252, e sem isso todo acento vira losango.

---

## Carga preguiçosa

Os bytes só são buscados **quando o usuário clica no chip**. A extensão `praxioscript` faz
o oposto — baixa todos os anexos de todos os trâmites no load da página, sem limite de
tamanho nem de concorrência. Num ticket como o 938963, isso são 45 MB de `.zip` baixados
antes de qualquer clique.

---

## Como testar sem ter o formato na fila

A fila real raramente tem `.xlsx` ou `.docx`. O procedimento está em
[`BUILD-E-TESTE.md`](BUILD-E-TESTE.md#anexos-sintéticos): a API local de teste injeta
anexos falsos na listagem e serve arquivos do disco, exercitando o caminho inteiro —
chip → IPC → conversor → sanitizador → DOM.

---

## Fora de escopo

- **Baixar para o disco.** Contraria o princípio da feature. Quem precisar do arquivo usa
  "Abrir no portal".
- **Anexar arquivo pelo app.** Só leitura; o portal tem Dropzone para envio.
- **Preview de `.zip`/`.rar`** (listar o conteúdo sem extrair). Possível, mas ninguém pediu.
- **Cache de bytes.** Reabrir o mesmo anexo refaz o download. Com os tamanhos atuais, não
  incomoda.
