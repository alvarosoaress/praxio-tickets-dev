# API — portalapi

> **Escopo:** o contrato entre este app e `https://portalapi.188720391.xyz`.
> Código-fonte da API em `C:\dev\portalPraxio\portal-scraper` (Express 5, ESM).
> Shapes conferidos contra o portal real em 14/09/2026.

---

## Autenticação

Uma chave estática de **exatamente 104 caracteres** no header `Authorization`, **sem
prefixo `Bearer`** (`portal-scraper/index.js:40`):

```
Authorization: yaS2Ksa…            ← a chave crua, nada antes dela
```

| Situação | Resposta |
| --- | --- |
| Header ausente | `401 { error: "Header Authorization ausente" }` |
| Header diferente da chave | `403 { error: "Chave de autenticacao invalida" }` |

A comparação é `authHeader.slice(0, 104) !== API_KEY` — **uma chave com lixo no fim passa**,
desde que os 104 primeiros caracteres batam. Por isso o app valida o tamanho no momento de
salvar (`ipc/config.js`): transforma um 403 misterioso futuro numa mensagem imediata.

A chave vive em `%APPDATA%\tickets\config.json` e não aparece em nenhum arquivo versionado.

---

## Rotas usadas por este app

| Método | Rota | Uso | Tempo típico |
| --- | --- | --- | --- |
| `GET` | `/scrape-custom/27662` | a fila inteira | ~3,5 s |
| `GET` | `/tramites/:ticketId?anexos=1` | histórico do ticket + anexos por trâmite | ~0,5–2,2 s |
| `GET` | `/visualizacoes/:ticketId` | quem leu o ticket | ~0,5 s |
| `GET` | `/anexos/:ticketId` | todos os anexos do ticket | ~0,6 s — **o app não usa mais** |
| `GET` | `/anexo/:anexoId` | os **bytes** do arquivo | varia com o tamanho |

A API tem outras rotas (`/sla`, `/ticketsbi`, `/ticket/:ticket`, `/alltickets`) que este app
não usa. Estão documentadas no `CONTEXT.md` do `portal-scraper`.

### O portal serializa por sessão — chamada paralela não é grátis

O `portal-scraper` mantém **um cookie jar global** (`index.js:19-20`) para todas as rotas e
para os jobs de background do SLA/BI. O portal é ASP.NET, e ASP.NET serializa requisições
concorrentes que dividem o mesmo `ASP.NET_SessionId`. Resultado: os tempos **somam** em vez
de se sobrepor. Medido em produção, ticket 938963:

```
/tramites/938963?anexos=1 sozinho ............ 2365 2133 2221 ms
   ... com /visualizacoes em paralelo ........ 3292 ms
   ... com /visualizacoes e /anexos .......... 3704 / 4349 ms
```

O mesmo vale dentro do `?anexos=1`: o código usa `Promise.all` (`index.js:426-438`), mas o
delta cresce linear com o número de trâmites-com-anexo — ~250 a 350 ms cada. Por isso este
app faz **uma chamada de cada vez** no detalhe (`ipc/tickets.js`) e derivou a faixa de
anexos dos trâmites em vez de pedir `/anexos/:id`.

Todas em produção. `/anexos`, `/anexo/:id` e o `?anexos=1` foram as últimas a subir e são
as únicas que o `CONTEXT.md` do `portal-scraper` ainda não documenta.

---

## `GET /scrape-custom/:customSearchMenuId`

Faz o scraping completo da busca salva do portal. **Sem cache e sem paginação**: percorre o
grid DevExpress página a página, com 500 ms de espera entre elas, e devolve tudo de uma vez.

```json
{
  "message": "Scraping concluído para customSearchMenu=27662",
  "customSearchMenuId": "27662",
  "ticketCount": 4,
  "tickets": [
    {
      "number": "0926-000931",
      "link": "https://portaldocliente.praxio.com.br/Ticket/TicketPrincipal/937919",
      "title": "Excesso de bagagem não gera calculo de comissão",
      "opening": "04/09/2026 10:04:00",
      "lastUpdate": "14/09/2026 10:16:35",
      "team": "(N4)",
      "client": "SAO LUIZ - GO",
      "module": "WCX",
      "person": "Divino Alves Soares",
      "responsible": "PAUL.CARVALHO",
      "status": "Em andamento",
      "avaliacao": null,
      "ia": false
    }
  ]
}
```

### Armadilhas

- **Não existe campo `id`.** O id numérico do portal só aparece dentro de `link`. O app
  extrai com `/\/TicketPrincipal\/(\d+)/` (`renderer.js:105`) — a mesma regex que a API usa
  internamente. Sem id não dá para abrir o detalhe, e a UI diz isso explicitamente.
- **`lastUpdate` não é o último trâmite.** A coluna do grid (`scraper.js`, `childNodes[6]`)
  atrasa — medido em 16/09/2026, ticket `0926-001321` com trâmite às 09:30 do dia e
  `lastUpdate: "11/09/2026 16:44:42"`. O app descarta esse valor e usa a data do trâmite
  mais recente de `/tramites/:id` via `GET /ultimos-tramites?ids=` (canal `tickets-last`, pedido pelo `load()`
  depois que a lista já está na tela).
- **Datas em `DD/MM/YYYY HH:mm:ss`.** `new Date()` lê isso como mês/dia. Sempre `parseBR()`.
- **`team` vem com parênteses**: `"(N4)"`.
- **`responsible` é o desenvolvedor**; `person` é quem abriu do lado do cliente.
- **Sem filtro, ordenação ou paginação server-side.** Tudo isso é client-side.
- **`group` não existe aqui** (existe em `/sla` e `/ticketsbi`).

---

## `GET /tramites/:ticketId`

Query params: `origin` (`operador` | `cliente` | `privado`), `search`, `anexos`.

Este app **não usa** `origin`/`search` — filtra em memória, porque os trâmites já estão
todos na tela e refiltrar sem round-trip é instantâneo.

```json
{
  "ticketId": "938963",
  "total": 11,
  "tramites": [
    {
      "index": 0,
      "id": "7661055",
      "date": "14/09/2026 09:47",
      "author": "PEDRO.MACIEL",
      "origin": "privado",
      "status": "Em andamento",
      "content": "texto puro, usado só na busca",
      "contentHtml": "<div>…</div>",
      "anexos": [ { "id": "1218237", "name": "…xml", "ext": "xml", "size": "7,26 KB", "uploadedAt": null } ]
    }
  ]
}
```

### `?anexos=1` é opt-in de propósito

Sem o parâmetro, a rota não muda em nada. Com ele, a API dispara um request extra **por
trâmite que tenha anexo** e preenche `anexos`. Ficou opcional porque o `sla-dashboard` e o
cálculo de SLA chamam essa mesma rota só pelo texto — não devem pagar pelo custo extra.

Se a busca de anexos de um trâmite falhar, ele fica com `anexos: []` e o ticket carrega
mesmo assim.

### Armadilhas

- **`id` só existe quando o trâmite tem anexo.** O portal só renderiza o clipe
  `.anexosTramite[data-idtramite]` nesse caso (`portal-scraper/tramites.js:103`). Nos
  demais, `id` é `null`. Não é bug: é a única fonte desse id no HTML.
- **Ordem é do mais recente para o mais antigo**, como vem do portal. O app não reordena.
- **`contentHtml` vem cru do portal** — escrito por clientes e operadores. Ver
  [`SEGURANCA.md`](SEGURANCA.md).
- **`date`, `author` e `status` podem ser `null`** quando o elemento falta no HTML.
- `content` é o texto puro do mesmo conteúdo; serve para busca, nunca para render.

---

## `GET /visualizacoes/:ticketId`

```json
{ "ticketId": "937919", "total": 13,
  "visualizacoes": [ { "usuario": "ALVARO.SOARES", "data": "14/09/2026 18:11:14" } ] }
```

Mais recente primeiro. `usuario` pode ser um login (`FELIPE.DIAS`) ou um e-mail de cliente
(`divino@expressosaoluiz.com.br`).

---

## `GET /anexos/:ticketId`

```json
{ "ticketId": "938963", "total": 11,
  "anexos": [
    { "id": "1218235", "name": "Erro AMATUR.png", "ext": "png",
      "size": "114,08 KB", "uploadedAt": "14/09/2026 09:47:30" }
  ] }
```

`size` é string formatada pelo portal (`"114,08 KB"`, `"16,45 MB"`) — não é número e não dá
para somar. `ext` sai do nome do arquivo; o portal não manda mime na listagem.

A lista por **trâmite** (via `?anexos=1`) tem o mesmo shape, exceto `uploadedAt: null`: o
partial por trâmite é uma grade de cards e não traz a coluna de data.

---

## `GET /anexo/:anexoId`

Devolve os bytes, não JSON.

```
200 OK
Content-Type: image/png
Content-Disposition: attachment;filename="Erro AMATUR.png"
Content-Length: 116819
```

⚠️ **`Content-Disposition: attachment` vem do portal e é repassado.** Quem consome precisa
neutralizar isso, senão o Chromium abre "Salvar como" em vez de renderizar. O app troca por
`inline` no handler do protocolo (`ipc/anexos.js`). Ver [`ANEXOS.md`](ANEXOS.md).

---

## Erros

Todas as rotas usam a mesma forma:

```json
{ "error": "mensagem curta", "message": "detalhe técnico opcional" }
```

| Origem | Exemplo | O que significa |
| --- | --- | --- |
| Middleware de auth | `401 Header Authorization ausente` / `403 Chave de autenticacao invalida` | Problema da chave do cliente |
| Validação de rota | `400 ticketId deve ser um número válido` | Id não numérico |
| **Login do servidor** | `401 { error: "Falha no login" }` | **Não é a chave do usuário.** A própria API não conseguiu logar no portal |
| Scraping | `500 Erro ao buscar trâmites` | O portal mudou, caiu, ou a sessão morreu duas vezes seguidas |

O caso do meio é o motivo da regra #5: o app renderiza `body.error` verbatim em vez de
traduzir o status HTTP. Traduzir faria o app dizer "sua chave está errada" quando o
problema é a senha do robô.

---

## Sessão do portal (contexto, não contrato)

A API mantém um cookie jar global e refaz login quando detecta que a sessão caiu. A
detecção é por sniff de string no HTML de resposta — **que não funciona em download
binário**, onde `res.data` é um Buffer. Por isso `fetchAnexoBytes`
(`portal-scraper/anexos.js:126`) detecta expiração pelo `content-type`: um `text/html` onde
deveria vir um arquivo é a página de login.

---

## Fora de escopo

SLA/VOC (`POST /sla`), notas internas (`GET|POST /ticket`) e tickets BI (`/ticketsbi`)
existem na API e não são usados aqui. Se entrarem no app um dia, o shape está no
`CONTEXT.md` do `portal-scraper`.
