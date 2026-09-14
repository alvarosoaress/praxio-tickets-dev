# Arquitetura

> **Público:** quem for mexer no código deste app. O contrato com a API está em
> [`API.md`](API.md); o pipeline de anexos, que atravessa todas as camadas, em
> [`ANEXOS.md`](ANEXOS.md).

---

## As duas fronteiras

Quase toda decisão estranha do código sai daqui:

```
┌─ renderer ────────────┐   ┌─ main ──────────────┐   ┌─ portalapi ────────┐
│ renderer.js           │   │ main.js             │   │ portal-scraper     │
│ sanitize.js           │   │ preload.js (ponte)  │   │                    │
│ index.html, style.css │   │ xlsx, mammoth       │   │ sessão do portal   │
│                       │   │ config.json         │   │ (cookie jar)       │
│ SEM rede              │◀─▶│ TEM a chave         │◀─▶│ TEM o login        │
│ SEM chave             │IPC│ TEM as libs         │TLS│ faz o scraping     │
└───────────────────────┘   └─────────────────────┘   └────────────────────┘
                                                                │
                                                   portaldocliente.praxio.com.br
```

**Por que rede só no main.** A chave mora em `config.json` dentro do `userData`, que só o
main lê — então IPC é necessário de qualquer jeito. `ipcMain.handle('tickets')` fazendo
leitura da chave *e* fetch tem o mesmo número de handlers que expor a chave ao renderer, e
nunca coloca o segredo na memória da página nem no devtools. De quebra, CORS e CSP deixam
de existir para os dados.

**Por que `preload.js` e não `nodeIntegration: true`.** Desligar os padrões do Electron
para economizar um arquivo de 11 linhas não é troca que se faça. `contextIsolation` fica
ligado.

---

## Contrato do IPC

Sete canais, todos definidos em `preload.js` e implementados em `main.js`.

| Canal | Entrada | Saída | Onde |
| --- | --- | --- | --- |
| `has-key` | — | `boolean` | `main.js:32` |
| `set-key` | `string` | `{ ok }` ou `{ error }` | `main.js:34` |
| `tickets` | — | `{ tickets }` ou `{ error }` | `main.js:58` |
| `ticket-detail` | `ticketId` | `{ tramites, views }` ou `{ error }` | `main.js:63` |
| `anexos` | `ticketId` | `{ anexos }` ou `{ error }` | `main.js:74` |
| `anexo-text` | `anexoId` | `{ text }` ou `{ error }` | `main.js:99` |
| `anexo-html` | `{ id, kind }` | `{ sheets }` ou `{ error }` | `main.js:112` |

### Regra única: nunca lançar através do IPC

Todo handler retorna `{ ...dados }` ou `{ error }`. Nunca `throw`. Isso é o que permite ao
renderer ter um branch só:

```js
const res = await window.api.loadTickets();
if (res.error) return onError(res.error, res.status);
```

Se um handler lançasse, cada chamada na UI precisaria de `try/catch` próprio, e um erro
esquecido viraria uma promise rejeitada silenciosa no meio do render.

`get()` (`main.js:42`) concentra o padrão: converte timeout, falha de rede e status HTTP
não-ok todos para a mesma forma `{ error, status }`.

### Timeouts

`fetch` não tem timeout por padrão. Todos os canais passam `AbortSignal.timeout`:
120 s para a lista (o scraping é sequencial no servidor), 90 s para o detalhe com anexos,
180 s para bytes de anexo (existe `.zip` de 16 MB na base).

---

## Fluxo da lista

1. `load()` (`renderer.js:610`) → canal `tickets` → `GET /scrape-custom/27662`.
2. Sucesso: guarda em `tickets`, popula os selects a partir dos valores presentes
   (`syncSelects`, `renderer.js:95`), renderiza.
3. `render()` (`renderer.js:187`) filtra em memória e **ordena por tempo parado
   decrescente** — o mais esquecido no topo.
4. `setInterval(load, 5 min)` e um segundo `setInterval` de 60 s que só re-renderiza para
   as idades avançarem sem bater na API.

O estado é um módulo com seis variáveis no topo do `renderer.js` (`tickets`, `loadedAt`,
`loading`, `timer`, `current`, `detail`). Não há store, não há observabilidade: `render()`
é chamado explicitamente por quem muda algo. Com uma tela e ~4 linhas, qualquer coisa além
disso seria cerimônia.

---

## Fluxo do detalhe

`openDetail(t)` (`renderer.js:548`) troca a `view` inteira — não é split nem drawer.
A 1280 px, dividir espremeria os dois lados.

```
openDetail(ticket)
   ├─ ticketId(ticket)                 extrai o id numérico do link do portal
   ├─ renderDetailHeader()             imediato, com o que a lista já tinha
   ├─ api.loadAnexos(id)      ─┐ paralelo, não segura os trâmites
   └─ api.loadDetail(id)      ─┘ tramites + visualizações em Promise.all no main
```

**Cancelamento por identidade.** Não há `AbortController`: `openDetail` compara
`current !== t` depois do await e descarta o resultado se o usuário já saiu ou abriu outro
ticket. O visualizador de anexo usa a mesma ideia com um token (`openViewer.token`), porque
lá pode haver duas conversões em voo.

**Visualizações são acessórias.** Se `/visualizacoes` falhar, o main devolve `views: []` e
o ticket abre assim mesmo (`main.js:63`). Só os trâmites são obrigatórios.

---

## Estados da UI

Onde o estado aparece depende de já haver conteúdo na tela — é a regra #4 em forma de
código:

| Situação | Sem dados ainda | Com dados na tela |
| --- | --- | --- |
| Sem chave | `showState` ocupando a tela | — |
| Chave rejeitada | `showState` + "Trocar chave" | `showNotice` no topo, linhas antigas ficam |
| Erro do servidor | `showState` com a mensagem verbatim | `showNotice` + "Tentar de novo" |
| Sem rede / timeout | `showState` + "Tentar de novo" | `showNotice`, timestamp antigo preservado |
| Carregando | 6 linhas de esqueleto | botão desabilitado + barra no topo |
| Zero tickets | "Fila limpa" — estado vazio, não erro | — |
| Filtro sem resultado | "Nenhum resultado" + "Limpar filtros" | — |

Os dois últimos precisam ser **visualmente distintos**: confundi-los faz achar que a fila
esvaziou quando na verdade um select ficou preso.

`showStateIn(id, …)` (`renderer.js:145`) é o mesmo componente usado pela lista e pelo
detalhe — a diferença é só o container.

---

## Teclado

| Tecla | Lista | Detalhe | Visualizador |
| --- | --- | --- | --- |
| `F5` / `Ctrl+R` | recarrega a fila | recarrega o ticket | — |
| `Ctrl+F` | foca a busca | foca a busca dos trâmites | — |
| `Esc` | limpa a busca | 1º limpa a busca, 2º volta à lista | fecha (nativo do `<dialog>`) |
| `Enter` | abre a linha focada | — | — |

O handler global (`renderer.js:720`) sai cedo quando um `<dialog>` está aberto: eles cuidam
do próprio `Esc`.

---

## Por que não tem

| Ausente | Motivo |
| --- | --- |
| Bundler / TypeScript | Sete arquivos. Um build step não se paga e atrasa o ciclo |
| Framework de UI | A tela tem uma lista e um detalhe; `render()` explícito é menor que qualquer runtime |
| Store de estado | Seis variáveis de módulo. Um store seria mais código que o estado que ele guarda |
| Roteador | Duas views, alternadas por `hidden` |
| Cache local de tickets | A API já leva 3,5 s e a lista é pequena; cache adicionaria invalidação sem ganho |
| `AbortController` | A comparação de identidade cobre o caso real (trocar de ticket) com 1 linha |
| Ícone, auto-updater, bandeja | Zero valor para a v1; entram quando alguém pedir |

---

## Limites conhecidos

- **Sem ordenação por coluna.** A ordem é sempre "mais parado primeiro". Ordenar por outra
  coluna exigiria comparar datas, e hoje só a idade é convertida.
- **Sem paginação.** A API devolve o conjunto inteiro; a UI renderiza tudo. Com centenas de
  tickets isso vira um DOM grande de uma vez.
- **`customSearchMenu` fixo em `27662`** (`main.js:7`). Trocar de fila é editar o código.
