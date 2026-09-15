# Build e teste

> **Público:** quem for rodar, testar ou empacotar. Windows apenas — não há build para
> outras plataformas e nada no código tenta ser portátil.

---

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm install` | Instala Electron, electron-builder, xlsx e mammoth |
| `npm start` | Abre o app contra a API de produção |
| `npm test` | Roda `test.js`. Deve imprimir `ok` e sair com 0 |
| `npm run dist` | Gera `dist/Tickets 1.0.0.exe` (~97 MB, portátil) |

Primeira execução pede a chave da API. Ela fica em `%APPDATA%\tickets\config.json` e
sobrevive a reinstalação — inclusive entre `npm start` e o `.exe`, porque o Windows trata
`tickets` e `Tickets` como a mesma pasta.

---

## `npm test`

Sem framework: `node test.js` com `assert`. Cobre só o que quebra em silêncio.

| Grupo | O que garante |
| --- | --- |
| `parseBR` | `DD/MM/YYYY` não é lido como mês/dia; segundos opcionais; entrada inválida vira `null`; ISO é rejeitado |
| `minutesSince` | Nunca negativo (relógio do portal adiantado vira 0) |
| `ageLabel` / `ageBucket` | As **fronteiras** das faixas (239/240, 1439/1440, 4319/4320) — é o que decide quando o âmbar aparece |
| `statusKey` | Acento e caixa não trocam a cor do status |
| `matches` | Busca livre ignora acento e cruza os campos; filtros se somam |
| `safeHref` | `javascript:`, `data:`, `vbscript:`, `file:` recusados, inclusive com caixa misturada e espaços |
| `KEEP` / `NUKE` | Nada está nas duas listas; `img` não passa direto |
| `kindOf` | Extensão → família, incluindo o caso "sem preview" |
| `prettyXml` | Indentação, folha numa linha só, e **nenhum conteúdo perdido** |

O que **não** tem teste, de propósito: render de DOM, IPC, protocolo e conversão de
arquivo. Esses são verificados abrindo o app — ver abaixo.

`renderer.js` e `sanitize.js` exportam suas funções puras num `module.exports` protegido
por `typeof module !== 'undefined'`, que no browser é falso. Por isso o `test.js` consegue
carregar os dois sem DOM.

---

## Rodar contra uma API local

Necessário sempre que a mudança depende de rota que ainda não está em produção — foi assim
que a feature de anexos inteira foi desenvolvida, antes do deploy da API.

```bash
TICKETS_API=http://localhost:3311 npm start
```

Com a variável ligada (`services/portalapi.js`), além de trocar a base da API:

- o console do renderer sai no terminal **e** em `%APPDATA%\tickets\dev.log`
  (`services/devlog.js`). Isso existe porque o `.exe` empacotado não tem console, e sem isso
  violação de CSP e erro de protocolo somem em silêncio;
- a variável não tem efeito no build: o `.exe` distribuído aponta para produção.

### A API local

A API de verdade (`portal-scraper`) **não sobe nesta máquina**: ela roda migrations contra
um PostgreSQL remoto que está atrás de firewall, e morre no boot com `ETIMEDOUT`.

A saída é um stub que importa os módulos reais da API por caminho absoluto, serve as rotas
novas e repassa o resto para produção:

```js
const { fetchAnexos, fetchAnexosTramite, fetchAnexoBytes } =
  await import('file:///C:/dev/portalPraxio/portal-scraper/anexos.js');
const { fetchTramites } =
  await import('file:///C:/dev/portalPraxio/portal-scraper/tramites.js');
```

Importar por `file://` faz os `import` internos daqueles módulos resolverem a partir da
pasta deles — então `node-html-parser`, `axios` e companhia são encontrados sem instalar
nada no stub.

O stub vive no scratchpad da sessão, não no repositório: é andaime, descartado quando a
rota sobe. Reconstruí-lo custa poucas linhas e vale de novo na próxima rota nova.

### Anexos sintéticos

A fila real raramente tem `.xlsx`, `.docx` ou `.pdf`. Para exercitar esses caminhos, o stub
injeta entradas falsas na listagem e serve arquivos do disco:

```js
const FAKE = {
  '900001': { file: 'teste.xlsx',  name: 'Resumo de horas.xlsx',  ext: 'xlsx' },
  '900002': { file: 'teste.docx',  name: 'Especificacao.docx',    ext: 'docx' },
  '900003': { file: 'teste.pdf',   name: 'Laudo tecnico.pdf',     ext: 'pdf'  },
};
```

Isso cobre o caminho inteiro — chip → IPC → conversor → sanitizador → DOM. O `.xlsx` dá
para gerar com o próprio SheetJS; o `.pdf` mínimo dá para escrever à mão em ~15 linhas.

---

## Empacotamento

Config dentro do `package.json`, sem arquivo separado:

```json
"build": {
  "appId": "com.alvaro.tickets",
  "productName": "Tickets",
  "files": ["main.js", "preload.js", "index.html", "renderer.js",
            "sanitize.js", "style.css", "node_modules/**/*"],
  "win": { "target": "portable" }
}
```

⚠️ **`node_modules/**/*` precisa estar na lista.** Quando `files` é declarado, ele
substitui o padrão — e sem essa entrada o `xlsx` e o `mammoth` não entram no asar. O
sintoma é preview de planilha e de `.docx` falhando **só no `.exe`**, nunca em `npm start`.

Conferir depois de buildar:

```bash
npx asar list "dist/win-unpacked/resources/app.asar" > /tmp/asar.txt
grep -E "node_modules.(xlsx|mammoth).package[.]json$" /tmp/asar.txt
```

Esperado: ~950 entradas, incluindo `\node_modules\xlsx\xlsx.js`. O `asar list` imprime com
barra invertida no Windows — grep com `/` não casa nada e dá falso negativo.

`target: "portable"` gera um `.exe` autoextraível, sem instalador e sem entrada no menu
iniciar. Trocar para `"nsis"` só se alguém quiser instalação de verdade.

O primeiro `npm run dist` baixa o binário do Electron e o cache do `winCodeSign`
(algumas centenas de MB, uma vez só).

---

## Verificação manual

O que os testes não cobrem, e que vale repassar antes de distribuir um `.exe`:

- [ ] Primeira execução pede a chave; chave de tamanho errado dá erro inline **sem** fazer request.
- [ ] Chave válida → lista carrega em ~4 s, ordenada do mais parado para o menos.
- [ ] Fechar e reabrir não pede a chave de novo.
- [ ] Desconectar a rede e clicar Atualizar → aviso no topo, **linhas antigas continuam na tela**.
- [ ] Busca e selects reduzem a contagem; filtro sem resultado mostra mensagem distinta do estado "fila limpa".
- [ ] Clicar no número do ticket abre o browser do sistema, não uma janela Electron.
- [ ] Abrir um ticket: trâmites do mais recente para o mais antigo, badge de origem colorido.
- [ ] Rodapé "Visto por" visível sem rolar; expande e tem scroll próprio.
- [ ] Um anexo de cada família: imagem (zoom/arrasto), PDF (renderiza, **não** baixa), planilha (abas), docx, xml (indentado), sql (acentos corretos), zip (mensagem de sem preview).
- [ ] Rodar o `.exe` numa pasta limpa e repetir os três últimos itens — é onde `node_modules` faltando aparece.

---

## Automação de UI

Não há Playwright nem Spectron. A verificação visual durante o desenvolvimento foi feita
com PowerShell + `user32.dll` (`FindWindow`, `SetWindowPos`, `mouse_event`, `CopyFromScreen`)
para posicionar a janela em 1280×800, clicar em coordenadas e capturar PNG.

Serve, mas é frágil: clique em coordenada erra quando o layout muda, e a janela precisa
estar em primeiro plano. Se a verificação visual virar rotina, vale trocar por um driver de
verdade — hoje não vale o peso.

---

## Fora de escopo

- Build para macOS/Linux. O app é Windows-only por decisão.
- CI. Não há pipeline; `npm test` roda na mão.
- Auto-update. O `.exe` é copiado à mão para quem precisar.
