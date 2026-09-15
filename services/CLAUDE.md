# services/

Adaptadores do mundo externo. Cada arquivo conhece **um** sistema de fora e nada sobre o
resto do app: não importam `ipcMain`, não sabem que existe renderer, não montam resposta
de IPC. Quem faz a ponte é [`../ipc/`](../ipc/CLAUDE.md).

| Arquivo        | Fala com                    | Nunca                                                    |
| -------------- | --------------------------- | -------------------------------------------------------- |
| `config.js`    | `%APPDATA%\tickets\config.json` | valida o que grava — quem valida é `ipc/`                                                    |
| `portalapi.js` | `portalapi.188720391.xyz`   | conhece anexo/ticket como conceito — só rotas e bytes    |
| `anexo.js`     | `xlsx` e `mammoth`          | toca a rede ou o disco; recebe `Buffer`, devolve texto/HTML |
| `claude.js`    | o binário `claude` do PATH  | conhece `config.js` — ver abaixo                         |
| `resumos.js`   | `resumos.json` no `userData` | mistura com `config.json` — ver abaixo                   |
| `devlog.js`    | `dev.log` + console         | roda fora de `TICKETS_API`                               |

## As três regras

1. **`app.getPath` só dentro de função.** Ele lança se chamado antes do `whenReady`, e
   `main.js` requer estes módulos no topo. Nenhum deles pode ler config na carga.

2. **Nunca lança.** Mesma regra dos handlers de IPC: `{ ...dados }` ou `{ error }`. Um
   `throw` daqui atravessaria a fronteira e cairia no renderer, que não tem try/catch.

3. **`claude.js` não conhece `config.js`, de propósito.** Ele é um adaptador puro do CLI;
   quem checa o consentimento do usuário é `ipc/resumo.js`. É isso que deixa `buildPrompt`
   e `parseResult` testáveis em `node test.js`, sem subir Electron.

## Por que `resumos.js` não usa o `config.json`

O cache de resumo cresce, é descartável e pode ser apagado a qualquer momento sem
consequência. A chave da API não é nada disso. Somados no mesmo arquivo, cada resumo
reescreveria o arquivo da chave — e `readCfg` trata arquivo corrompido como "ainda não
configurado", o que ali custa a chave do usuário e aqui não custa nada.

## Armadilhas do `claude.js`

Duas flags que parecem certas e não são — ambas medidas, não supostas:

- **`--bare` quebra o login.** Ela pula hooks, plugins e descoberta de `CLAUDE.md`, mas
  força a autenticação a ser `ANTHROPIC_API_KEY` e **nunca lê o login OAuth**. A chamada
  volta `{"is_error":true,"result":"Not logged in · Please run /login"}`.
- **`--restricted` aumenta o contexto** em vez de reduzir: 14.9k tokens contra 9.8k com
  `--disallowed-tools` listando as ferramentas. Use a lista explícita.

O prompt vai por **stdin**, nunca por argv: um ticket com dezenas de trâmites estoura o
limite de linha de comando do Windows. O `cwd` aponta para `userData` para o CLI não
descobrir o `CLAUDE.md` deste repo.

`result` carrega texto mesmo quando `is_error` é `true` — nesse caso o texto **é** o erro.
Checar `is_error` antes de mostrar.
