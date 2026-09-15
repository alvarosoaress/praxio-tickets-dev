# Tickets

## O que é

App de desktop (Electron, Windows) que mostra os tickets de suporte **em aberto atribuídos
ao time de desenvolvimento** da Praxio, lê o histórico do ticket e pré-visualiza os anexos
sem baixar nada. Fica aberto num segundo monitor o dia inteiro.

Não fala com o portal da Praxio diretamente — quem tem sessão é a API
`portalapi.188720391.xyz` (repo `C:\dev\portalPraxio\portal-scraper`). Este app é um
cliente dela.

---

## Stack

| Peça          | Escolha                             | Por quê                                                                                 |
| ------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| Shell         | Electron 44                         | Precisa de processo privilegiado para guardar a chave e fazer proxy de bytes            |
| Renderer      | HTML + CSS + JS puro                | Sem bundler, sem framework, sem CDN. O app tem sete arquivos; um build step não se paga |
| Empacotamento | electron-builder, target `portable` | Um devDep, config dentro do `package.json`, `.exe` único                                |
| Runtime deps  | `xlsx` (SheetJS), `mammoth`         | Únicos dois. Convertem planilha e `.docx` para HTML **no processo main**                |
| Testes        | `node test.js` + `assert`           | Sem framework. Cobre só a lógica pura que quebra em silêncio                            |

`xlsx` vem do CDN da SheetJS (`cdn.sheetjs.com`), não do npm — ver regra #10.

---

## Como rodar

```bash
npm install
npm start          # abre o app contra a API de produção
npm test           # checa parser de data, envelhecimento, filtro, sanitizador, XML
npm run dist       # gera dist/Tickets 1.0.0.exe (portátil, ~97 MB)
```

Primeira execução pede a chave da API (104 caracteres), guardada em
`%APPDATA%\tickets\config.json`. A chave está no `.env` do `portal-scraper` como `API_KEY`.

Para desenvolver contra uma API local: `TICKETS_API=http://localhost:3311 npm start`.
Com essa variável ligada, o console do renderer também sai no terminal e em
`%APPDATA%\tickets\dev.log` (`services/devlog.js`) — sem isso, erro de CSP e de protocolo some
em silêncio. Ver [`docs/BUILD-E-TESTE.md`](docs/BUILD-E-TESTE.md).

---

## Estrutura

O processo main é dividido em duas pastas, cada uma com o seu `CLAUDE.md`:
[`services/`](services/CLAUDE.md) são os adaptadores do mundo externo, [`ipc/`](ipc/CLAUDE.md)
é a fronteira com o renderer. O renderer continua plano — enquanto for uma camada de
arquivo único, a doc dela mora em `docs/`.

| Arquivo       | Papel                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `main.js`     | Só o arquivo principal: registra o scheme, liga os módulos de IPC, abre a janela. ~40 linhas                   |
| `services/`   | Um adaptador por sistema externo: `config`, `portalapi`, `anexo`, `claude`, `devlog`                            |
| `ipc/`        | Um `register()` por domínio: `config`, `tickets`, `anexos`, `resumo`                                           |
| `preload.js`  | Ponte `contextBridge`. 10 funções, nada além disso                                                             |
| `renderer.js` | Toda a UI: lista, detalhe, filtros, visualizador de anexo, estados de erro                                     |
| `sanitize.js` | Allowlist de HTML. Fronteira de confiança — ver regra #2                                                       |
| `index.html`  | Markup + biblioteca de ícones SVG inline + CSP                                                                 |
| `style.css`   | Tokens e componentes do mundo visual                                                                           |
| `test.js`     | Checagens em `assert`, sem framework                                                                           |

**Duas fronteiras de processo**, e elas explicam quase todas as decisões do código:

```
renderer  ──IPC──▶  main  ──HTTPS+chave──▶  portalapi  ──sessão──▶  portal Praxio
(sem rede,          (tem a chave,           (tem o login,
 sem chave)          tem as libs)            faz scraping)
                      │
                      └──stdin──▶  claude CLI  ──▶  Anthropic
                                   (login do usuário, não do app)
```

---

## Regras de ouro

1. **Rede só no main.** O renderer nunca faz `fetch` para fora. A chave da API não entra
   na memória do renderer nem no devtools. Toda leitura passa por `get()`
   ou `anexoBytes()` (`services/portalapi.js`).

2. **Todo HTML vindo do portal passa por `sanitizeHtml()`.** Isso inclui a saída do
   SheetJS e do mammoth — não é "conteúdo nosso", é um arquivo que um cliente enviou.
   O `sla-dashboard` injeta esse mesmo HTML com `dangerouslySetInnerHTML`; aqui isso seria
   RCE. Ver [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

3. **Handler de IPC nunca lança.** Retorna `{ ...dados }` ou `{ error }`. O renderer tem
   um branch só e nenhum try/catch. Quebrar isso espalha try/catch por toda a UI.

4. **Um refresh que falha nunca esvazia a tela.** Se já havia lista, mostra o aviso e
   mantém as linhas antigas com o timestamp antigo (`onError` em `renderer.js:781`). Lista
   visivelmente velha é melhor que tela vazia.

5. **Erro da API é renderizado verbatim.** `/scrape-custom` devolve `401 "Falha no login"`
   quando o **servidor** falha ao logar no portal — nada a ver com a chave do usuário.
   Traduzir status HTTP para mensagem própria faz o app culpar o usuário por um problema
   que não é dele.

6. **Toda alteração de UI passa pela skill `impeccable`.** Antes de editar `index.html`,
   `style.css` ou as funções de render do `renderer.js`, invoque a skill. O mundo visual
   não foi escolhido no improviso: o usuário optou por "Terminal de operação" entre três
   direções apresentadas, e [`DESIGN.md`](DESIGN.md) é o contrato dessa escolha — com as
   proibições dela. Edição avulsa faz o mundo derivar um pixel por vez até virar outra
   coisa. A skill carrega o piso de qualidade, a profundidade de modo Operate, e é onde a
   decisão volta documentada para o `DESIGN.md`.

   **Exceção:** correção que só restaura o comportamento já documentado (seletor quebrado,
   contraste que regrediu, estado que parou de aparecer) é conserto, não design — faça
   direto e cite a linha do `DESIGN.md` que estava sendo violada.

7. **Âmbar é só envelhecimento.** `--amber` não aparece em nenhum outro papel. Status usa
   azul/verde/violeta, erro usa vermelho. Se tudo vira destaque, nada é destaque.

8. **Nada se move sem significar estado.** A tela vive num segundo monitor. O único
   movimento autoral é a barra de progresso durante o fetch, que existe porque a chamada
   leva ~3,5 s. `prefers-reduced-motion` desliga tudo.

9. **Id de anexo e de ticket são sempre validados como numéricos**, nos dois lados. A URL
   do portal é montada no servidor, nunca vem do cliente.

10. **Nunca instalar `xlsx` do npm.** O npm está parado na 0.18.5 com prototype pollution e
    ReDoS sem correção, e isso processa arquivo enviado por cliente. A versão corrigida vem
    de `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, já fixada no `package.json`.

11. **Lógica não-trivial deixa uma checagem em `test.js`.** Parser, faixa de decisão,
    fronteira de segurança. Sem framework e sem teste de one-liner.

12. **Data do portal não é parseável por `new Date()`.** Vem `DD/MM/YYYY HH:mm:ss`, que o
    JS lê como mês/dia. Sempre `parseBR()` (`renderer.js:33`).

13. **Conteúdo de ticket só sai da máquina com aceite explícito.** O resumo entrega
    título, cliente e o texto dos trâmites ao `claude` do PATH. Sem `claudeOk` no
    `config.json`, `ipc/resumo.js` devolve `NO_CONSENT` e **nada é enviado**. O aceite é
    pedido uma vez, com o que sai escrito por extenso — não numa nota de rodapé.

14. **Dependência nova precisa de justificativa escrita.** Hoje são duas, ambas porque
    converter `.xlsx`/`.docx` à mão não é viável. Spinner, toast, date-lib e afins não
    entram.

---

## Guia de diagnóstico por sintoma

| Sintoma                                         | Onde investigar                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tela pede a chave toda vez que abre             | `config.json` não gravou. `services/config.js`, pasta `%APPDATA%\tickets`                                                |
| "Chave rejeitada pela API" com chave certa      | A API compara só os primeiros 104 chars. Espaço colado junto passa; chave curta não                                                     |
| "A API não conseguiu buscar os tickets"         | Erro do servidor, não seu. O login da própria API no portal falhou — ver `PORTAL_LOGIN`/`PORTAL_PASSWORD` no `.env` do `portal-scraper` |
| Lista carrega mas a faixa de anexos não aparece | A faixa sai do `anexos` de cada trâmite (`anexosDe`), não de rota própria. Se os trâmites vieram sem `anexos`, faltou o `?anexos=1` |
| Anexos não aparecem dentro dos trâmites         | Falta o `?anexos=1` na chamada (`ipc/tickets.js`), ou a API apontada é anterior a essa rota |
| Trâmite editado no portal não aparece ao reabrir | Cache por `lastUpdate` (`renderer.js`). Se o portal não mexeu no `lastUpdate`, o app serve o que tinha. `F5` no detalhe ignora o cache |
| PDF abre "Salvar como" em vez de renderizar     | `Content-Disposition: attachment` vazando do portal. O handler força `inline` (`ipc/anexos.js`)                                           |
| Imagem do anexo vira ícone quebrado             | Id foi para o _host_ do `anexo://` em vez do path — host numérico vira IPv4 decimal                                                     |
| `fetch('anexo://…')` falha no renderer          | CORS. Texto/planilha/docx vão por IPC; só `<img>`/`<video>`/`<iframe>` usam a URL                                                       |
| Estilo aplicado por JS não pega                 | CSP `style-src`. O zoom da imagem escreve `transform` inline                                                                            |
| Acento vira losango em `.sql`/`.txt`            | Arquivo em cp1252. `anexo-text` detecta `U+FFFD` e refaz em latin1 (`services/anexo.js`) |
| Ticket abre sem trâmites, com "Ticket sem id"   | O `link` do portal veio sem `/TicketPrincipal/<id>`; `ticketId()` (`renderer.js:105`)                                                   |
| "Claude CLI não encontrado"                     | O `claude` não está no PATH **do processo Electron**. O `.exe` não embute o CLI — cada máquina precisa do Claude Code instalado |
| Resumir devolve "Not logged in"                 | O CLI está instalado mas sem login. `claude /login` no terminal. Nunca é a chave da API do app |
| Botão Resumir fica desabilitado                 | Ele só libera quando os trâmites chegam — é o que ele manda para o Claude (`openDetail`) |
| Resumo não atualiza depois de um trâmite novo   | Esperado: o cache não se refaz sozinho. A faixa âmbar avisa e "Refazer" atualiza |
| Resumo some ao reabrir o app                    | `%APPDATA%	ickets
esumos.json` não gravou. Apagar o arquivo é seguro — só perde cache |

---

## O que NUNCA fazer sem aprovação humana

- **Commitar ou deployar o `portal-scraper`.** É outro repositório, com outro ciclo de
  vida. Alterar o working tree dele é aceitável mediante pedido; commitar e subir, não.
- **Afrouxar a CSP** além do que está em `index.html`. Cada permissão ali tem um motivo
  escrito em [`docs/SEGURANCA.md`](docs/SEGURANCA.md).
- **Aceitar mais tags ou atributos no `sanitize.js`.** A allowlist é fail-closed de
  propósito. `<img>` com `data:image/` já é a exceção, e exclui SVG porque SVG executa
  script.
- **Gravar anexo em disco.** Todo o pipeline é em memória/stream por decisão de produto:
  "pré-visualização sem precisar baixar nada".
- **Hardcodar a chave da API** em qualquer arquivo versionado.
- **Mandar conteúdo de ticket para qualquer serviço externo sem o gate de consentimento.**
  Hoje o único destino é o `claude` CLI, e ele passa por `claudeOk`.
- **Subir a versão ou publicar o `.exe`** para outras máquinas.

---

## Navegação de docs

| Preciso de...                                                            | Consultar                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| Como as peças se conversam, o que roda em qual processo                  | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)     |
| Rotas da `portalapi`, shapes de resposta, armadilhas do portal           | [`docs/API.md`](docs/API.md)                     |
| Pipeline de anexos ponta a ponta e as três armadilhas do protocolo       | [`docs/ANEXOS.md`](docs/ANEXOS.md)               |
| Fronteiras de confiança: sanitizador, CSP, chave, validação de id        | [`docs/SEGURANCA.md`](docs/SEGURANCA.md)         |
| Rodar, testar contra API local, empacotar, o que o `.exe` leva dentro    | [`docs/BUILD-E-TESTE.md`](docs/BUILD-E-TESTE.md) |
| Contexto de produto: quem usa, qual a tarefa, o que é verdade do domínio | [`PRODUCT.md`](PRODUCT.md)                       |
| Mundo visual: tokens, tipografia, o mecanismo de envelhecimento, estados | [`DESIGN.md`](DESIGN.md)                         |

`PRODUCT.md` e `DESIGN.md` ficam **na raiz**, não em `docs/`: a skill `impeccable` lê esses
dois caminhos exatos para recuperar o contexto do projeto. Movê-los quebra a skill em
silêncio.

---

## Glossário rápido

### Domínio

| Termo                | Significado                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **customSearchMenu** | Busca salva criada à mão na GUI do portal; o id sai da requisição do browser. `27662` = fila do time de desenvolvimento |
| **trâmite**          | Uma mensagem no histórico do ticket. Tem origem (operador/cliente/privado), autor, data e o status daquele momento      |
| **visualização**     | Registro de quem abriu o ticket no portal e quando                                                                      |
| **parado há X**      | Tempo corrido desde `lastUpdate`. É o sinal primário da tela, não o status                                              |
| **anexo**            | Arquivo enviado no ticket. Vive no portal, exige sessão, e só a API consegue buscar                                     |

### Nomes que mentem

| Aparência                                | Realidade                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `responsible`                            | O **desenvolvedor** responsável. Quem abriu do lado do cliente é `person`                     |
| `team`                                   | Vem com parênteses do portal: `"(N4)"`, não `"N4"`                                            |
| `/anexos/:ticketId` vs `/anexo/:anexoId` | Plural lista (JSON), singular devolve **bytes**. Um caractere de diferença                    |
| `id` no trâmite                          | Só existe quando o trâmite **tem anexo** — o portal só renderiza o clipe nesse caso           |
| `DESIGN.md`                              | Não é guia de estilo genérico: é o contrato do mundo visual escolhido, com as proibições dele |

---

## Perguntas em aberto

- ⚠️ **`CONTEXT.md` do `portal-scraper` não documenta as rotas novas.** `/anexos/:ticketId`,
  `/anexo/:anexoId` e o `?anexos=1` já estão em produção, mas a doc de lá não os menciona.
- ⚠️ **Sem ícone próprio e sem assinatura de código.** O SmartScreen pede "Mais informações
  → Executar assim mesmo" na primeira execução em cada máquina.
- ⚠️ **A fila hoje tem um responsável só** (`PAUL.CARVALHO`). Os filtros por responsável e
  cliente nunca foram exercitados com variedade real.
- ⚠️ **`/scrape-custom` não tem cache.** Cada refresh refaz o scraping inteiro no servidor.
  Com a fila atual (4 tickets) custa ~3,5 s; numa fila grande isso vira minutos.
- ⚠️ **O ganho de velocidade que sobrou está no `portal-scraper`, não aqui.** Deste lado já
  se cortou tudo: uma chamada por vez, faixa derivada dos trâmites, cache por `lastUpdate`.
  O que falta é lá e precisa de aprovação (é outro repo): `?anexos=1` usar o
  `fetchAnexos` que já existe (`anexos.js:23-39`, uma request no lugar de N — hoje são
  ~250-350 ms por trâmite-com-anexo); mutex de login em voo, para a sessão expirada não
  virar N logins concorrentes; `timeout` no `axios.create` (`index.js:20`), que hoje não
  tem nenhum; e, o maior de todos, uma sessão por rota interativa em vez do cookie jar
  global — é ele que põe `/tramites` na mesma fila dos jobs de SLA/BI.
