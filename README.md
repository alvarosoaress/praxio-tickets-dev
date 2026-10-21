# Tickets

App de desktop para Windows que mostra os tickets de suporte **em aberto atribuídos ao time
de desenvolvimento** da Praxio. Responde "o que precisa de mim agora?" sem abrir o portal, e
foi feito para ficar aberto num segundo monitor o dia inteiro.

O sinal principal da tela é **há quanto tempo o ticket está parado** — o tempo desde o
trâmite mais recente. Quanto mais velho, mais âmbar.

---

## O que ele faz

- **Fila de tickets** com filtros por status, responsável, cliente e status próprios.
- **Histórico do ticket** (trâmites) com abas, uma por ticket aberto.
- **Pré-visualização de anexos sem baixar nada**: imagem, PDF, vídeo, texto, planilha e `.docx`.
- **Status próprios**: marque tickets com nome e cor seus, pelo botão direito na linha.
- **Notificação** do Windows, com som, quando entra ticket novo na fila.
- **Resumo com Claude**: resume o ticket e os anexos pelo `claude` CLI da própria máquina.
  Pede aceite explícito antes de enviar qualquer coisa.
- **Análise**: abre o Claude Code no repositório do módulo com o resumo já preenchido.
- **Criar Bug no Azure DevOps** a partir do ticket, com os anexos, usando o seu token pessoal.
- **Atualização automática**: avisa quando sai versão nova no GitHub e instala com um clique.

---

## Como funciona

O app não fala com o portal da Praxio. Quem tem sessão no portal é a API
`portalapi.188720391.xyz` (repositório `portal-scraper`). O app é um cliente dela.

```
tela (renderer)  ──IPC──▶  processo main  ──HTTPS + chave──▶  portalapi  ──sessão──▶  portal Praxio
sem rede, sem chave        tem a chave e                       faz o login
                           as libs de conversão                e o scraping
                                │
                                └──▶  claude CLI  ──▶  Anthropic   (login do usuário, não do app)
```

Pontos que explicam quase todo o código:

- **Rede só no processo main.** A tela nunca faz requisição externa e nunca vê a chave da API.
- **Todo HTML do portal é sanitizado** por uma allowlist (`sanitize.js`) antes de aparecer,
  inclusive planilhas e `.docx` convertidos. É conteúdo enviado por cliente.
- **Anexos nunca vão para o disco.** Tudo é stream ou memória.
- **Um refresh que falha não esvazia a tela.** A lista antiga fica, com o aviso do erro.
- **Erro da API aparece como veio.** `401 "Falha no login"` quase sempre é o servidor falhando
  no portal, não a sua chave.
- **Nada sai da máquina sem aceite.** O Claude só recebe conteúdo depois do aceite
  versionado; o Azure só com o token que você colou e a confirmação de cada Bug.

---

## Instalação (uso)

1. Baixe o `Tickets Setup x.y.z.exe` da [última release](https://github.com/alvarosoaress/praxio-tickets-dev/releases/latest).
2. Rode o instalador. Ele instala só para o seu usuário, sem pedir admin.
   - O SmartScreen vai avisar, porque o app não é assinado: **Mais informações → Executar assim mesmo**.
3. Na primeira abertura, cole a **chave da API** (104 caracteres). Peça a um dev do time —
   ela está no `.env` do `portal-scraper` como `API_KEY`.

Configurações e cache ficam em `%APPDATA%\tickets`. Reinstalar não apaga nada disso.

### Opcional

| Recurso        | O que precisa                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Resumir        | [Claude Code](https://claude.com/claude-code) instalado e logado (`claude /login`)                  |
| Análise        | O de cima, ter rodado `claude` interativo e enviado um prompt uma vez, e o Windows Terminal        |
| Repositórios   | Pastas **locais** dos módulos em Configurações → Repositórios. Caminho de rede não funciona         |
| Criar Bug      | PAT do Azure DevOps com escopo *Work Items Read & write* em Configurações → Azure DevOps             |

---

## Desenvolvimento

Requer Node.js e Windows.

```powershell
npm install
```

| Comando        | O que faz                                                                  |
| -------------- | -------------------------------------------------------------------------- |
| `npm start`    | Abre o app contra a API de produção                                        |
| `npm test`     | Roda as checagens de lógica (`test.js`, sem framework)                     |
| `npm run fake` | Sobe uma fila falsa com painel no navegador e abre o app apontado para ela |
| `npm run dist` | Gera o instalador em `dist/`                                               |

Contra uma API local:

```powershell
$env:TICKETS_API = 'http://localhost:3311'; npm start
```

Com essa variável, o app usa outro perfil (`%APPDATA%\tickets-dev`) e grava o console da tela
em `%APPDATA%\tickets-dev\dev.log`.

**Nunca instale `xlsx` pelo npm.** A versão do npm tem falhas sem correção. A versão segura
vem do CDN da SheetJS e já está fixada no `package.json`.

---

## Estrutura

| Caminho        | Papel                                                         |
| -------------- | ------------------------------------------------------------- |
| `main.js`      | Abre a janela e liga os módulos                               |
| `services/`    | Um adaptador por sistema externo: API, anexos, Claude, Azure… |
| `ipc/`         | A fronteira entre a tela e o processo main                    |
| `preload.js`   | A ponte que expõe as funções do main para a tela              |
| `renderer.js`  | Toda a interface                                              |
| `sanitize.js`  | Allowlist de HTML                                             |
| `index.html`, `style.css` | Markup, ícones, CSP e estilos                      |
| `tools/`       | A API falsa para testes. Não vai para o instalador            |

Stack: Electron, HTML/CSS/JS puro, sem bundler nem framework. Duas dependências de runtime:
`xlsx` e `mammoth`, para converter planilha e `.docx`.

---

## Documentação

| Preciso de...                                       | Ver                                              |
| --------------------------------------------------- | ------------------------------------------------ |
| Regras do projeto e diagnóstico por sintoma         | [`CLAUDE.md`](CLAUDE.md)                         |
| Como as peças se conversam                          | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)     |
| Rotas e respostas da API                            | [`docs/API.md`](docs/API.md)                     |
| Pipeline de anexos                                  | [`docs/ANEXOS.md`](docs/ANEXOS.md)               |
| Sanitizador, CSP, chave e validação                 | [`docs/SEGURANCA.md`](docs/SEGURANCA.md)         |
| Build, teste e o que vai no instalador              | [`docs/BUILD-E-TESTE.md`](docs/BUILD-E-TESTE.md) |
| Contexto de produto                                 | [`PRODUCT.md`](PRODUCT.md)                       |
| Mundo visual e tokens                               | [`DESIGN.md`](DESIGN.md)                         |
