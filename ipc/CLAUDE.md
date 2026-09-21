# ipc/

A fronteira com o renderer. Um arquivo por domínio, cada um exportando `register()`, que
`main.js` chama no topo — antes do `whenReady`, porque `ipcMain.handle` não depende dele.

| Arquivo      | Canais                                          |
| ------------ | ----------------------------------------------- |
| `config.js`  | `has-key`, `set-key`, `claude-ok`, `claude-allow`, `get-repos`, `set-repos`, `pick-dir` |
| `tickets.js` | `tickets`, `ticket-detail`, `ticket-views`       |
| `anexos.js`  | `anexo-text`, `anexo-html` + `registerProtocol()` |
| `resumo.js`  | `resumo`                                         |
| `hotfix.js`  | `hotfix-probe`, `hotfix-start`                    |
| `update.js`  | `update-check`, `update-apply`                   |
| `status.js`  | `status-get`, `status-set`                        |

`registerProtocol()` é a exceção: precisa rodar **dentro** do `whenReady`. O
`registerSchemesAsPrivileged` que ele exige fica em `main.js`, no escopo de módulo, porque
tem que acontecer **antes** do ready. Separar os dois não é estilo, é ordem obrigatória.

## As três regras

1. **Nunca lança.** `{ ...dados }` ou `{ error: string }`. O renderer tem um branch só e
   nenhum try/catch — quebrar isso espalha try/catch por toda a UI.

2. **Validação mora aqui.** Id de ticket e de anexo são checados com `/^\d+$/` na entrada
   do handler, antes de qualquer chamada. O `services/` confia em quem chama.

   `set-repos` descarta linha sem caminho **antes** de gravar, e não depois: a ordem da
   lista é o contrato com `hotfix.js` e `resumo.js`, que recebem do renderer o índice de
   uma linha dela.

3. **Erro da API sai verbatim.** `/scrape-custom` devolve `401 "Falha no login"` quando o
   **servidor** falha ao logar no portal. Traduzir status HTTP para mensagem própria faz o
   app culpar o usuário por um problema que não é dele.

## `status.js`

O status pessoal é escrito pelo usuário e volta para a tela como **cor num `style` inline** e
**id de uma marca**. Nenhum dos dois pode ser string livre: `limpar()` exige `#rrggbb` e um id
da allowlist `[a-z0-9]{1,16}`, corta o nome em 24 e a lista em 12. Item malformado é
descartado em silêncio, como em `set-repos` — a lista salva sozinha, e uma linha ruim não pode
derrubar as boas.

Marca que aponta para um status inexistente **não é gravada**: é assim que apagar um status
limpa as marcas dele sem uma segunda passada, e é o que impede o arquivo de guardar referência
solta.

Os quatro status padrão saem daqui, e só enquanto o arquivo **nunca foi gravado** — a checagem
é "existe a chave `defs`", não "a lista tem item". Apagar todos é escolha do usuário; um
default que ressuscita sozinho não é default.

## `hotfix.js`

Dois canais porque há uma pergunta no meio: `hotfix-probe` só lê (gitflow instalado? repo
inicializado? workspace sujo?), a tela decide, e `hotfix-start` executa. O `start` **reroda
os mesmos checks** — o renderer não é confiável, e o usuário tem esse repositório aberto
noutra janela o dia inteiro.

O renderer manda `{ id, ticket, repoIdx }` e **nunca um caminho**: `repoIdx` é o índice de
uma linha de `config.repos`, e quem lê o caminho é este lado. O usuário aponta qual das
opções que já viu; o main decide o que ela significa. Mesmo espírito da regra de ouro #9.

`NO_DEEPLINK` vem **antes** do probe, de propósito: sem o handler `claude-cli://` registrado
a hotfix não teria como abrir nada no fim, e descobrir isso depois deixaria o usuário numa
branch nova sem entender o que aconteceu.

Cada impedimento tem código próprio (`NO_REPO`, `NO_DEEPLINK`, `NO_GITFLOW`,
`NO_GITFLOW_INIT`, `NO_DIR`, `NO_GIT`, `NO_RESUMO`, `NO_SLUG`) porque o conserto de cada um
é diferente. Erro do git no meio da sequência não vira código: sai verbatim, com o `step` e o nome do stash junto.

## `resumo.js`

Dois motivos para ele existir separado de `services/claude.js`:

- **Os anexos.** `escolherAnexos()` decide quais vão junto e com que pista (`image`,
  `pdf`, ou convertido para texto), `anexoBytes()` busca os bytes e `toPlain()` converte.
  Falha de um anexo **não** derruba o resumo: perder uma planilha é muito menos ruim que
  não entregar resumo nenhum — e todo `continue` do `carregarAnexos` é isso. O renderer
  nunca escolhe qual arquivo sai: só entra anexo que veio dos próprios trâmites.
- **O gate de consentimento.** Sem `claudeOk` no `config.json`, devolve `{ error:
  'NO_CONSENT' }` e não chama nada. O conteúdo do ticket sai da máquina; o usuário
  autoriza uma vez — e o aceite é versionado, porque ele descreve **o que** sai
  (`CONSENT_V`, hoje 3).
- **O repositório.** Mesmo `repoIdx` da hotfix: o renderer aponta uma linha de
  `config.repos`, nunca um caminho. `services/claude.js` só recebe o caminho pronto e lê
  dali os `.md` da raiz, que entram no prompt como contexto do sistema.

  A pergunta vem **depois do cache**, e é por isso que ela é um `{ error: 'NEED_REPO' }` em
  vez de um argumento obrigatório: o caso comum é reabrir um resumo que já existe, e ali um
  dialog seria um clique que não decide nada. `repoIdx: -1` é "seguir sem repositório" e
  resume como sempre resumiu — a doc é precisão a mais, não pré-requisito.
- **O cache.** Fica em disco, em `%APPDATA%	ickets
esumos.json`
  ([`services/resumos.js`](../services/CLAUDE.md)), e **sobrevive ao restart** — reabrir o
  mesmo ticket amanhã não paga de novo.

  Resumo anterior ao último trâmite **não é refeito sozinho**: volta com `stale: true` e a
  UI mostra uma faixa de aviso. Refazer custa dezenas de segundos e dinheiro, então quem
  decide pagar é o usuário, clicando em "Refazer" — que é o único caminho que passa por
  cima do cache.
