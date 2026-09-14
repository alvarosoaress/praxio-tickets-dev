# Design — Terminal de operação

> **Fica na raiz de propósito:** a skill `impeccable` lê este caminho exato.
> Índice geral em [`CLAUDE.md`](CLAUDE.md); contexto de produto em [`PRODUCT.md`](PRODUCT.md).
> Decisões de implementação por trás destas escolhas: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).
>
> **Antes de alterar qualquer coisa aqui, invoque a skill `impeccable`** — regra de ouro #6
> em [`CLAUDE.md`](CLAUDE.md).


Mundo visual escolhido pelo usuário entre três direções. Superfície quase preta, régua
monoespaçada para todo dado medido, linhas de 1px, âmbar reservado a uma única coisa:
**quanto tempo o ticket está parado**.

## Por que assim

A tela vive num segundo monitor. Leitura periférica: nada se move sem significar alguma
coisa, e a cor só aparece onde há uma decisão a tomar. Se tudo é destaque, nada é.

## Tokens

| Papel | Valor | Nota |
|---|---|---|
| `--bg` | `#08090b` | fundo da janela |
| `--surface` | `#0e1014` | barras, painéis |
| `--surface-2` | `#14171c` | campos, hover |
| `--line` / `--line-2` | `#1c2026` / `#2a3038` | 1px sempre |
| `--text` | `#e8eaee` | 15.8:1 |
| `--text-dim` | `#a2abb8` | 8.6:1 — tingido da superfície, nunca cinza puro |
| `--text-faint` | `#767f8d` | 4.9:1 — piso para placeholder e rótulo |
| `--amber` | `#ffb02e` | **só** envelhecimento |
| `--info` `--ok` `--danger` | `#5aa9ff` `#3ecf8e` `#ff6b6b` | status e erro |

## Tipografia

Uma família de sistema (`Segoe UI Variable`) para prosa e rótulos; uma monoespaçada
(`Cascadia Mono`/`Consolas`) para tudo que é medido — número do ticket, módulo, idade,
horário. Escala fixa em rem, razão ~1.15. `tabular-nums` em toda coluna numérica.

## O mecanismo

Idade em quatro faixas, e só ela carrega cor:

| Faixa | Tratamento |
|---|---|
| < 4h | `--text-dim`, discreto |
| 4h – 24h | `--text`, peso normal |
| 24h – 72h | `--amber`, peso 600 |
| > 72h | `--amber`, peso 600, tinta de fundo na linha, marca `!` |

Ordenação padrão: mais parado no topo. A lista se reordena sozinha conforme envelhece
(recálculo a cada 60s, sem nova chamada à API).

Proibido neste mundo: borda colorida à esquerda das linhas, emoji no lugar de ícone,
gradiente em texto, card dentro de card, spinner no meio do conteúdo.

## Movimento

150–200ms, só em transição de estado. Uma barra fina de progresso indeterminado no topo
durante o fetch — é o único movimento autoral, e existe porque a chamada leva ~3,5s.
`prefers-reduced-motion` desliga.

## Tela de detalhe do ticket

Substitui a lista na janela inteira (sem split e sem drawer: a 1280px qualquer divisão
espremeria os dois lados). Volta com `←` ou `Esc`. `Esc` com busca preenchida limpa a
busca primeiro, e só o segundo volta.

Estrutura: barra com voltar + número + título + "parado há X" + **Abrir no portal**;
faixa de metadados (cliente / módulo / resp / solicitante / status / abertura / última
atualização); filtros (busca livre + origem); trâmites do mais recente para o mais antigo;
e as visualizações num `<details>` **fixo no rodapé**, fora do scroll dos trâmites — não
uma aba, porque "quem leu" é consulta rara e aba é máquina demais para dois painéis. Ao
abrir, a área de trâmites encolhe e a lista ganha scroll próprio (teto de 38vh); fechado,
é uma linha só e continua alcançável sem rolar nada.

Trâmite não é card: é uma entrada de log, separada por 1px como as linhas da lista.
Badge de origem colorido (operador azul, cliente verde, privado violeta), data em mono,
autor, e o status daquele momento à direita.

**Fronteira de confiança:** `contentHtml` vem cru do portal, escrito por clientes e
operadores. `sanitize.js` aplica allowlist fail-closed — tag fora da lista perde a tag e
mantém o texto, `script`/`style`/`iframe`/`svg`/`form` somem com conteúdo e tudo, nenhum
atributo sobrevive exceto `href` em `<a>` (só http/https/mailto, relativo resolvido contra
o portal, `target=_blank rel=noreferrer`). `<img>` vira marcador textual: a CSP bloqueia
origem remota e a imagem do portal exige sessão.

O portal envia blocos inteiros dentro de `<b>`. Negrito renderiza em 500, não 700 — assim
uma ênfase parcial ainda aparece e um trâmite todo em negrito volta a ler como texto.

## Anexos

Em dois lugares, porque respondem a perguntas diferentes.

**Faixa horizontal fixa abaixo dos metadados** — todos os anexos do ticket, para quando
a pergunta é "o arquivo existe em algum lugar aqui?". Não é aba nem acordeão: os anexos
são o motivo de muita gente abrir o ticket, e escondê-los atrás de um clique inverteria
a prioridade.

**Dentro do próprio trâmite**, depois do texto — para quando a pergunta é "o que veio
*junto com esta mensagem*?". Rótulo discreto (`3 ANEXOS`) seguido dos mesmos chips, que
aqui quebram linha em vez de rolar: no meio do texto, um arquivo escondido atrás de
scroll horizontal desaparece. Vem de `GET /tramites/:id?anexos=1` — opt-in na API, para
não cobrar o request extra de quem só quer o texto. Cada arquivo é um chip com ícone do tipo, nome e tamanho;
a faixa rola na horizontal quando não cabe. Chip com borda tracejada = sem
pré-visualização (`.zip`, `.pfx`, `.rar`).

O clique abre um visualizador em `<dialog>` de tela quase cheia, com Esc nativo:

| Tipo | Como abre |
|---|---|
| imagem | `<img>` com zoom na roda e arrasto; duplo clique reseta |
| pdf | `<iframe>` no visualizador nativo do Chromium |
| vídeo / áudio | `<video>` / `<audio>` com controles |
| xlsx / xls / ods | SheetJS no main → tabela; abas quando há mais de uma planilha |
| docx | mammoth no main → HTML |
| xml | indentado por `prettyXml` (a NF-e chega numa linha só) |
| txt, sql, csv, json, log… | `<pre>` monoespaçado |
| resto | mensagem honesta + botão para o portal |

**Nada toca o disco.** Os bytes chegam pelo protocolo `anexo://portal/<id>?ext=…`
registrado no main, que faz proxy autenticado na API e devolve em stream. Três
armadilhas que custaram tempo e estão amarradas por comentário no código:

1. O id vai no **path**, nunca no host — com scheme `standard`, um host só de dígitos
   é lido como IPv4 decimal (`1218235` vira `0.18.150.187`).
2. O portal marca todo anexo como `Content-Disposition: attachment`. Repassar isso faz
   o Chromium abrir "Salvar como" em vez de renderizar; o handler força `inline`.
3. `fetch('anexo://…')` do renderer morre em CORS (outra origem). Texto, planilha e
   docx vão por IPC; só `<img>`/`<video>/<iframe>` usam a URL direto.

Conversão de planilha e docx acontece no **main**, não no renderer: as bibliotecas
ficam fora da página e o HTML gerado ainda passa por `sanitize.js` antes do DOM.
Figuras de .docx sobrevivem porque o sanitizador aceita `<img>` com `data:image/…`
(menos SVG, que carrega script).
