# ipc/

A fronteira com o renderer. Um arquivo por domínio, cada um exportando `register()`, que
`main.js` chama no topo — antes do `whenReady`, porque `ipcMain.handle` não depende dele.

| Arquivo      | Canais                                          |
| ------------ | ----------------------------------------------- |
| `config.js`  | `has-key`, `set-key`, `claude-ok`, `claude-allow`, `get-repos`, `set-repos`, `pick-dir` |
| `tickets.js` | `tickets`, `ticket-detail`, `ticket-views`       |
| `anexos.js`  | `anexo-text`, `anexo-html` + `registerProtocol()` |
| `resumo.js`  | `resumo`                                         |

`registerProtocol()` é a exceção: precisa rodar **dentro** do `whenReady`. O
`registerSchemesAsPrivileged` que ele exige fica em `main.js`, no escopo de módulo, porque
tem que acontecer **antes** do ready. Separar os dois não é estilo, é ordem obrigatória.

## As três regras

1. **Nunca lança.** `{ ...dados }` ou `{ error: string }`. O renderer tem um branch só e
   nenhum try/catch — quebrar isso espalha try/catch por toda a UI.

2. **Validação mora aqui.** Id de ticket e de anexo são checados com `/^\d+$/` na entrada
   do handler, antes de qualquer chamada. O `services/` confia em quem chama.

   `set-repos` usa `normModules()` do [`../modulos.js`](../modulos.js) e **isso não é
   exceção à regra**: a *decisão* de rejeitar continua aqui, o arquivo só guarda a
   expressão — mesma relação que o `sanitize.js` tem com o renderer. Ele mora na raiz, e
   não em `services/`, porque o `test.js` precisa importá-lo sem subir o Electron.

3. **Erro da API sai verbatim.** `/scrape-custom` devolve `401 "Falha no login"` quando o
   **servidor** falha ao logar no portal. Traduzir status HTTP para mensagem própria faz o
   app culpar o usuário por um problema que não é dele.

## `resumo.js`

Dois motivos para ele existir separado de `services/claude.js`:

- **O gate de consentimento.** Sem `claudeOk` no `config.json`, devolve `{ error:
  'NO_CONSENT' }` e não chama nada. O conteúdo do ticket sai da máquina; o usuário
  autoriza uma vez.
- **O cache.** Fica em disco, em `%APPDATA%	ickets
esumos.json`
  ([`services/resumos.js`](../services/CLAUDE.md)), e **sobrevive ao restart** — reabrir o
  mesmo ticket amanhã não paga de novo.

  Resumo anterior ao último trâmite **não é refeito sozinho**: volta com `stale: true` e a
  UI mostra uma faixa de aviso. Refazer custa dezenas de segundos e dinheiro, então quem
  decide pagar é o usuário, clicando em "Refazer" — que é o único caminho que passa por
  cima do cache.
