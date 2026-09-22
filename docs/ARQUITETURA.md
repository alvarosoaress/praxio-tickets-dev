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

Dezenove canais, todos definidos em `preload.js` e implementados em [`ipc/`](../ipc/CLAUDE.md).

| Canal | Entrada | Saída | Onde |
| --- | --- | --- | --- |
| `has-key` | — | `boolean` | `ipc/config.js` |
| `set-key` | `string` | `{ ok }` ou `{ error }` | `ipc/config.js` |
| `claude-ok` | — | `boolean` | `ipc/config.js` |
| `claude-allow` | — | `{ ok }` | `ipc/config.js` |
| `get-repos` | — | `{ repos }` | `ipc/config.js` |
| `set-repos` | `[{ path, modules }]` | `{ ok, repos }` ou `{ error }` | `ipc/config.js` |
| `pick-dir` | — | `{ path }` ou `{}` | `ipc/config.js` |
| `tickets` | — | `{ tickets }` ou `{ error }` | `ipc/tickets.js` |
| `ticket-detail` | `ticketId` | `{ tramites }` ou `{ error }` | `ipc/tickets.js` |
| `ticket-views` | `ticketId` | `{ views }` ou `{ error }` | `ipc/tickets.js` |
| `anexo-text` | `anexoId` | `{ text }` ou `{ error }` | `ipc/anexos.js` |
| `anexo-html` | `{ id, kind }` | `{ sheets }` ou `{ error }` | `ipc/anexos.js` |
| `resumo` | `{ id, ticket, tramites, refazer }` | `{ text, cached? }` ou `{ error }` | `ipc/resumo.js` |
| `hotfix-probe` | `{ id, ticket }` | `{ ok, … }` ou `{ error }` | `ipc/hotfix.js` |
| `hotfix-start` | `{ id, ticket }` | `{ ok, branch, stash? }` ou `{ error }` | `ipc/hotfix.js` |
| `update-check` | — | `{ atual }` ou `{ versao, url }` | `ipc/update.js` |
| `update-apply` | `url` | `{ ok }` ou `{ error }` | `ipc/update.js` |
| `status-get` | — | `{ defs, por }` | `ipc/status.js` |
| `status-set` | `{ defs, por }` | `{ ok, defs, por }` ou `{ error }` | `ipc/status.js` |

### Como o processo main é dividido

`main.js` é só o arquivo principal: registra o scheme `anexo`, chama o `register()` de cada
módulo de IPC e abre a janela. Abaixo dele, duas camadas com direção de dependência única —
`ipc/` importa `services/`, nunca o contrário:

```
main.js
  ├─ ipc/        fronteira com o renderer: valida entrada, monta { dados } | { error }
  └─ services/   adaptadores do mundo externo: config, portalapi, anexo, claude, devlog, git, update, status
```

Duas ordens são obrigatórias e não são estilo: `registerSchemesAsPrivileged` fica em
`main.js` no escopo de módulo (tem que rodar **antes** do `whenReady`), enquanto
`registerProtocol()` de `ipc/anexos.js` roda **dentro** dele. E nenhum módulo pode chamar
`app.getPath` na carga — ele lança antes do ready, e `main.js` requer todos no topo.

### Regra única: nunca lançar através do IPC

Todo handler retorna `{ ...dados }` ou `{ error }`. Nunca `throw`. Isso é o que permite ao
renderer ter um branch só:

```js
const res = await window.api.loadTickets();
if (res.error) return onError(res.error, res.status);
```

Se um handler lançasse, cada chamada na UI precisaria de `try/catch` próprio, e um erro
esquecido viraria uma promise rejeitada silenciosa no meio do render.

`get()` (`services/portalapi.js`) concentra o padrão: converte timeout, falha de rede e status HTTP
não-ok todos para a mesma forma `{ error, status }`.

### Timeouts

`fetch` não tem timeout por padrão. Todos os canais passam `AbortSignal.timeout`:
120 s para a lista (o scraping é sequencial no servidor), 90 s para o detalhe com anexos,
180 s para bytes de anexo (existe `.zip` de 16 MB na base).

---

## Fluxo da lista

1. `load()` (`renderer.js:763`) → canal `tickets` → `GET /scrape-custom/27662`.
2. Sucesso: guarda em `tickets`, popula os selects a partir dos valores presentes
   (`syncSelects`, `renderer.js:95`), renderiza. O "parado há" aparece como `—` (ou com a
   data do refresh anterior): a do grid atrasa dias.
3. Com a lista já na tela, pede numa chamada só a data do último trâmite de todos (canal
   `tickets-last` → `GET /ultimos-tramites?ids=`, que a API busca em paralelo). A barra de
   progresso só apaga quando elas chegam. API anterior a essa rota (`404`): cai para um
   `GET /tramites/:id` por ticket, em série.
4. `render()` (`renderer.js:191`) filtra em memória e **ordena por tempo parado
   decrescente** — o mais esquecido no topo.
5. `setInterval(load, 5 min)` e um segundo `setInterval` de 60 s que só re-renderiza para
   as idades avançarem sem bater na API.

O estado é um módulo com nove variáveis no topo do `renderer.js` (`tickets`, `loadedAt`,
`loading`, `timer`, `current`, `detail`, mais `abas`, `ativa` e `arrastando`, das abas).
Não há store, não há observabilidade: `render()` é chamado explicitamente por quem muda
algo. Com uma tela e ~4 linhas, qualquer coisa além disso seria cerimônia.

`current` e `detail` continuam sendo **o ticket na tela** — a aba ativa. As abas não são um
segundo container de detalhe: são a lista de tickets abertos mais a UI de cada um (busca,
origem, rolagem), e trocar de aba é rodar o mesmo `openDetail`, que acerta o cache por
`lastUpdate` e não bate na rede. Por isso resumo, hotfix e visualizador não souberam da
mudança.

**A única exceção à regra "estado persistido passa por IPC"** são as abas abertas, que vão
para o `localStorage` do renderer (`tickets.abas`) em vez de um arquivo no `userData`. O
dado é uma lista de números de ticket, e a restauração casa cada número contra a fila
recém-carregada — o que não casa é descartado, então não há validação de fronteira a fazer
e não há o que o main precise ler. Qualquer outra coisa persistida continua indo por
`services/` + `ipc/` com `limpar()` fail-closed.

---

## Fluxo do detalhe

`openDetail(t, refazer, ui)` troca a `view` inteira — não é split nem drawer. A 1280 px,
dividir espremeria os dois lados. O terceiro parâmetro é a UI guardada da aba: em vez de
zerar busca, origem e rolagem, semeia os três com o que aquela aba tinha.

```
openDetail(ticket)
   ├─ ticketId(ticket)                 extrai o id numérico do link do portal
   ├─ renderDetailHeader()             imediato, com o que a lista já tinha
   ├─ cacheGet(id, lastUpdate)         acerto → renderiza e para aqui, sem rede
   ├─ api.loadDetail(id)               GET /tramites/:id?anexos=1 — sozinho na linha
   ├─ renderTramites() + renderAnexos(anexosDe(tramites))
   └─ api.loadViews(id)                só depois, com a tela já preenchida
```

**Uma chamada de cada vez, em série.** Parece contraintuitivo, mas o portal é ASP.NET e
serializa requisições que dividem a mesma sessão — e a API tem um cookie jar global. Duas
chamadas em paralelo não se sobrepõem: fazem fila, e a que a tela espera fica atrás.
Medido em produção no ticket 938963: `/tramites?anexos=1` leva **2,2 s** sozinho e **4,1 s**
com `/visualizacoes` e `/anexos` disparados junto.

**A faixa de anexos sai dos próprios trâmites** (`anexosDe`), não de uma rota. `/anexos/:id`
devolve exatamente os mesmos arquivos — conferido nos 4 tickets da fila, zero diferença de
id — e custava uma posição na fila do portal. Perde-se `uploadedAt`, que o partial por
trâmite não traz e que só aparecia no `title` do chip.

**Cache em memória por `lastUpdate`.** Reabrir um ticket cujo `lastUpdate` não mudou desde
a última leitura renderiza na hora, sem rede (`cacheGet`/`cachePut`). É a única invalidação
possível: a API não tem cache nem ETag. `F5` dentro do detalhe passa por cima.

**Cancelamento por identidade.** Não há `AbortController`: `openDetail` compara
`current !== t` depois do await e descarta o resultado se o usuário já saiu ou abriu outro
ticket. O visualizador de anexo usa a mesma ideia com um token (`openViewer.token`), porque
lá pode haver duas conversões em voo.

**Visualizações são acessórias.** Chegam num canal próprio, pedido só depois que os
trâmites estão na tela. Se falharem, `views` fica `[]` e o ticket não muda. Elas caem no
objeto cacheado mesmo que o usuário já tenha voltado para a lista.

---

## Fluxo da hotfix

Sai do `#resumo` e termina num terminal fora do app. Duas chamadas, porque há uma pergunta
no meio.

1. `pedirHotfix()` (`renderer.js`) pergunta em qual repositório salvo trabalhar e manda o
   **índice** da escolha no canal `hotfix-probe`, junto de `{ id, ticket }`.
2. `ipc/hotfix.js` lê o caminho em `config.repos[repoIdx]`. **O renderer nunca manda
   caminho** — mesmo espírito da regra de ouro #9. Antes de qualquer leitura de disco,
   `temDeepLink()` confere que o handler `claude-cli://` existe nesta máquina: sem ele o
   passo 6 não abriria nada, e a branch já teria sido criada.
3. `git.probe()` roda quatro comandos de leitura, nesta ordem:
   `git flow version` (instalado?) → `git rev-parse --absolute-git-dir` (é repo?) →
   `git config --get gitflow.branch.develop` (inicializado?) → `git status --porcelain`.
4. Impedimento volta como código (`NO_GITFLOW`, `NO_REPO`, `NO_DEEPLINK`, …) e abre o
   `#hotfixAsk` — o mesmo dialog que acabou de fazer a pergunta do repositório.
   Workspace sujo volta como `dirty: N` e abre o mesmo dialog, agora com confirmação.
   Workspace limpo pula o dialog e vai direto para o passo 5.
5. Canal `hotfix-start`, que **reroda os mesmos checks** e então executa:
   `git add -A` + `git stash push -m …` (se sujo) → `git checkout <develop>` →
   `git pull --ff-only` → `git flow hotfix start <slug>`.
6. Escreve `TICKET-<slug>.md` no repo, acrescenta o nome ao `.git/info/exclude`, e chama
   `abrirNoTerminal()` (`services/claude.js`): um `shell.openExternal` na URL
   `claude-cli://open?cwd=…&q=…` que `deepLink()` (`services/git.js`) montou. O Windows
   abre o terminal, e o Claude sobe **com a frase na caixa e não enviada** — quem aperta
   Enter é o usuário.

### As três decisões que custaram medição

- **`git flow version` responde 0 fora de um repositório.** Ele só prova instalação. O que
  prova inicialização é `gitflow.branch.develop` — e sem esse check o `hotfix start` para
  num prompt interativo que, sem TTY, trava o processo main até o timeout de 60s.
- **O stash vem antes do `checkout`.** Checkout com tree sujo ou falha, ou carrega as
  mudanças para a develop. Por isso todo erro a partir daí devolve o nome do stash: depois
  que ele existe, um erro que não o cita faz o usuário achar que perdeu o trabalho.
- **O gitflow AVH não diz "already exists"** quando já há uma hotfix aberta, e sim "There is
  an existing hotfix branch" — ele só admite uma por vez. `jaExiste()` cobre as duas formas;
  sem isso, o segundo clique no mesmo ticket falha e larga o usuário na develop.

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

O handler global (`renderer.js:884`) sai cedo quando um `<dialog>` está aberto: eles cuidam
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
- **`customSearchMenu` fixo em `27662`** (`services/portalapi.js`). Trocar de fila é editar o código.
