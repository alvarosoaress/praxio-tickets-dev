# services/

Adaptadores do mundo externo. Cada arquivo conhece **um** sistema de fora e nada sobre o
resto do app: não importam `ipcMain`, não sabem que existe renderer, não montam resposta
de IPC. Quem faz a ponte é [`../ipc/`](../ipc/CLAUDE.md).

| Arquivo        | Fala com                    | Nunca                                                    |
| -------------- | --------------------------- | -------------------------------------------------------- |
| `config.js`    | `%APPDATA%\tickets\config.json` | valida o que grava — quem valida é `ipc/`                                                    |
| `portalapi.js` | `portalapi.188720391.xyz`   | conhece anexo/ticket como conceito — só rotas e bytes    |
| `anexo.js`     | `xlsx` e `mammoth`          | toca a rede ou o disco; recebe `Buffer`, devolve texto/HTML |

> `anexo.js` tem **dois** conversores de propósito: `toHtml()` para a tela, que precisa de
> tabela, e `toPlain()` para o modelo, que não. Mesmas bibliotecas, saída diferente — uma
> planilha em CSV custa uma fração do mesmo dado em `<table>`.
| `claude.js`    | o binário `claude` do PATH  | conhece `config.js` — ver abaixo                         |
| `resumos.js`   | `resumos.json` no `userData` | mistura com `config.json` — ver abaixo                   |
| `devlog.js`    | `dev.log` + console         | roda fora de `TICKETS_API`                               |
| `git.js`       | o binário `git` do PATH     | importa `electron` — ver abaixo                          |

## As três regras

1. **`app.getPath` só dentro de função.** Ele lança se chamado antes do `whenReady`, e
   `main.js` requer estes módulos no topo. Nenhum deles pode ler config na carga.

2. **Nunca lança.** Mesma regra dos handlers de IPC: `{ ...dados }` ou `{ error }`. Um
   `throw` daqui atravessaria a fronteira e cairia no renderer, que não tem try/catch.

3. **`claude.js` não conhece `config.js`, de propósito.** Ele é um adaptador puro do CLI;
   quem checa o consentimento do usuário é `ipc/resumo.js`. É isso que deixa `buildPrompt`
   e `parseResult` testáveis em `node test.js`, sem subir Electron.

## Por que `git.js` não importa `electron`

É o único. `slugTicket` — a allowlist que separa o portal da linha de comando — e
`buildBriefing` são puros, e o `test.js` precisa importá-los sem subir Electron. Mesma
relação que o `modulos.js` tem com a raiz.

A abertura do terminal ficou em `claude.js`, e não aqui: o sistema externo continua sendo o
CLI `claude`, só que interativo em vez de `-p`. Lá o `cwd` aponta **para** o repo, ao
contrário do `resumir()` — é justamente o caso em que descobrir o `CLAUDE.md` e ler o
código é o objetivo.

O `wt` **não** entra nessa abertura, e isso foi medido na marra: ele reanalisa a linha de
comando com o parser dele e desloca as aspas da frase do prompt, tentando executar a frase
inteira como nome de programa (`[erro 0x80070002 ao iniciar ""cmd /k claude … Leia" …]`). O
`start` do `cmd` entrega os argumentos intactos nas quatro combinações que importam (cwd do
repo e do app, `claude` do PATH e caminho absoluto) — e no Windows 11 a janela abre no
Windows Terminal de qualquer jeito, porque ele é o terminal padrão.

Três coisas medidas, não supostas: `git flow version` responde 0 até **fora** de um
repositório, então ele só diz que o gitflow está instalado — quem diz que o repo foi
inicializado é `gitflow.branch.develop`, e sem esse check o `hotfix start` para num prompt
interativo e trava o main. E o gitflow AVH **não** diz "already exists" quando já há uma
hotfix aberta: diz "There is an existing hotfix branch" (`jaExiste()`). E o `hotfix start`
exige a branch de **produção** igual à origin, não só a develop — por isso, depois do
`pull` da develop, vem um `git fetch origin <master>:<master>`, que adianta a produção sem
trocar de branch e sem forçar. Falhar ali não interrompe: quem decide se pode começar
continua sendo o gitflow, que dá a mensagem certa.

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

## Imagem sem tocar o disco

O CLI **aceita imagem pelo stdin** — medido, não suposto. Com `--input-format stream-json`
(que exige `--output-format stream-json`, e este `--verbose`), o stdin vira uma mensagem no
shape da Messages API, com blocos `{type:'image', source:{type:'base64',…}}`.

Isso é o que permite mandar o print do ticket **sem gravar o anexo em disco** (proibido sem
aprovação) e **sem liberar a ferramenta `Read`** (que continua em `--disallowed-tools`). A
doc do CLI só descreve o caminho por caminho-de-arquivo + `Read`; o caminho por stdin
existe e foi verificado ponta a ponta.

O custo disso é que `parseResult` deixou de ler um JSON e passou a ler **JSONL**: uma linha
por evento, e só a última `type:"result"` interessa.

O prompt vai por **stdin**, nunca por argv: um ticket com dezenas de trâmites estoura o
limite de linha de comando do Windows. O `cwd` aponta para `userData` para o CLI não
descobrir o `CLAUDE.md` deste repo.

## A doc do repositório dentro do prompt

`lerDocs(repo)` lê os `.md` da **raiz** do repositório mapeado para o módulo do ticket e
`buildPrompt` os coloca antes do cabeçalho, sob o rótulo `CONTEXTO DO SISTEMA`. É o que faz
o bloco ONDE dizer `VGCE.pas` / `CalculaSaldo` em vez de "módulo de estoque": o trâmite traz
o sintoma, a doc traz o nome próprio.

Quem resolve módulo → repositório é `ipc/resumo.js` — a regra 3 continua valendo, `claude.js`
recebe um caminho e não conhece `config.js`.

Três decisões que parecem detalhe e não são:

- **Todo `.md` da raiz, e não uma lista de nomes.** Um `.md` novo na raiz entra sozinho.
  Raiz só: varrer o repo traria o `TASKS-DOC/` inteiro junto.
- **Teto próprio (`MAX_DOCS_CHARS`), fora do orçamento dos trâmites.** Descontar a doc do
  `MAX_PROMPT_CHARS` faria ela comer justamente a história que existe para esclarecer.
- **`utf8` direto, sem o fallback cp1252 do `anexo.js`.** Medido: o `CLAUDE.md` do SIGA já
  tem `U+FFFD` gravado no arquivo, e o heurístico "achou `U+FFFD`, releia em latin1"
  redecodificaria o arquivo inteiro por causa de sete caracteres.

O `CLAUDE.md` de um repositório é escrito **para um agente** ("nunca use Edit em `.pas`",
"rode `/resumo-task`"). Por isso ele entra emoldurado como referência, e não como ordem —
`blocoDocs()`. Mesma postura do trâmite: material, nunca instrução.

`result` carrega texto mesmo quando `is_error` é `true` — nesse caso o texto **é** o erro.
Checar `is_error` antes de mostrar.
