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
| `--amber` | `#ffb02e` | **só** envelhecimento — e a barra de progresso, que mede espera |
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

## O status que é meu

O portal já diz "Em andamento" ou "Aguardando cliente". Isso é o que **o ticket** está — e a
fila inteira costuma responder a mesma coisa. O que não existe em lugar nenhum é o que **eu**
estou: olhando agora, esperando uma resposta, bloqueado, resolvido do meu lado enquanto o
portal não fecha. Essa marca é do desenvolvedor, vive só nesta máquina e é o que o botão
direito na linha aplica.

**Botão direito, não um controle na linha.** Um seletor visível por linha seria um alvo
permanente numa tela onde a maioria das linhas nunca vai ser marcada, e a linha tem um alvo
só de propósito: ela inteira abre o detalhe. O menu é o `popover` nativo — top layer (o
`.scroll` cortaria qualquer filho posicionado), `Esc` e clique fora resolvidos pelo
light-dismiss, sem uma linha de JS para isso. Abre no cursor e se desloca para dentro da
janela quando não caberia. A tecla de menu do Windows dispara o mesmo evento na linha em
foco, então o caminho existe pelo teclado — por isso o foco vai para o primeiro item.

**A marca vem primeiro e o status do portal apaga.** Os dois continuam na mesma linha,
separados pela barra que a `.meta` já usa, mas só um leva o ponto colorido: dois pontos lado
a lado seriam duas coisas disputando a mesma leitura periférica, numa tela que é lida de
relance do outro monitor. Sem marca, a linha é exatamente a de sempre. Substituir o status do
portal foi descartado: ele alimenta um filtro e o detalhe, e sumir com ele da lista faria a
marca custar informação.

**"Sem status" só aparece quando há o que limpar**, e leva o ponto tracejado — o mesmo
sentido de "lugar vazio" que o tracejado já tem no `.tr-img` e no campo de módulo. O último
item do menu leva às Configurações: sem ele, quem apagasse todos os status ficaria com um
menu vazio e nenhuma pista de onde criar o próximo.

**A cor é escolha livre, e essa é a primeira exceção à disciplina de cor deste mundo.** A
regra de ouro #7 reserva o âmbar ao envelhecimento e o resto da paleta a status e erro; um
`<input type="color">` deixa marcar "Pendente" de âmbar e furar isso. A alternativa avaliada
era uma paleta fechada de cinco swatches tirados dos tokens, e o usuário escolheu o seletor
livre — quem convive com a tela o dia inteiro é quem paga pela escolha ruim, e ele pode
desfazê-la em dois cliques. O que a liberdade **não** alcança é a forma: ponto de 5px, mesmo
tipo, mesmo lugar, tamanho igual ao do status do portal. A cor varia; o vocabulário, não.

**Quatro já vêm prontos** — Olhando (azul), Pendente (violeta), Bloqueado (vermelho),
Resolvido (verde) — porque uma lista vazia na primeira execução obrigaria a inventar um
vocabulário antes de poder marcar o primeiro ticket. Apagar todos é uma escolha respeitada:
os padrões só voltam enquanto o arquivo nunca foi gravado, e um default que ressuscita
sozinho não é default, é teimosia. O teto é 12: uma paleta de doze marcas já não se lê de
relance, que é a única coisa que essa marca precisa fazer.

**Um quarto select na barra**, e não uma busca. Filtrar por "o que eu estou" é um movimento de
um clique — "me mostra só o que está bloqueado" — e digitar o nome da marca seria um caminho
mais longo para a mesma coisa. Ele obedece a mesma regra dos outros três: só entram os status
que estão marcados em algum ticket da fila, porque filtrar por uma marca que ninguém tem só
devolve "nenhum resultado".

**No dialog, status é linha, não card** — o mesmo registro do repositório: o seletor de cor à
esquerda, o nome no meio, remover à direita, separadas por 1px. Salvam sozinhas a cada
mudança, como os repositórios, e pelo mesmo motivo: ninguém espera apertar Salvar numa lista.
Apagar um status apaga as marcas dele na hora — deixar a linha da lista apontando para uma
marca que já não existe seria mostrar um dado fantasma, e renomear não solta nada, porque o
que a marca guarda é um id interno, não o nome.

## Abas

**Esta seção reverte uma recusa que estava escrita aqui.** Duas vezes este documento
dispensou aba — nas visualizações ("aba é máquina demais para dois painéis") e nos anexos
("não é aba nem acordeão"). As duas recusas continuam de pé: elas falam de **painéis dentro
de um ticket**, onde aba é maquinaria para esconder o que cabia na tela. O que entrou aqui é
outra coisa — aba **entre tickets**, que é navegação, e navegação é justamente o que faltava
memória: sem ela, voltar a um ticket que você já leu custa uma viagem à lista, toda vez.

Uma faixa de 34px acima das duas views, sempre visível. A primeira aba é a **Fila** e é
fixa: não fecha, não arrasta, e é para onde `←` e o segundo `Esc` levam. Cada ticket aberto
vira uma aba à direita dela, arrastável, com `✕` próprio.

A aba ativa usa `--surface`, o mesmo fundo da `.bar` logo abaixo, e se funde com a barra do
ticket. **É a fusão que diz onde você está, não um realce** — a faixa fica na tela o dia
inteiro num segundo monitor, e uma cor de destaque permanente ali viraria mobília.

Rótulo: número em mono tabular, que **nunca cede espaço**, e cliente em sans que encolhe com
reticências. Com muitas abas sobra só o número — é ele a identidade do ticket. Título vai no
`title`, não na faixa.

**Um sinal só, e é a marca do usuário**: o ponto de cor do status pessoal, o mesmo
`.ctx-dot` do menu de contexto. Envelhecimento **não** sobe para a aba. Âmbar continua
significando só uma coisa, e uma barra permanente com quatro números âmbares seria a regra
morrendo de uso.

Nada de novo foi desenhado: a faixa é a forma da `.anexos-strip`, a aba é o botão da
`.viewer-tabs` das planilhas, o `✕` é o `.mchip-x` dos módulos, o ponto é o `.ctx-dot`.

Sem teto de abas e sem botão "+": as abas encolhem até um piso e a faixa rola, e abrir um
ticket é sempre pela lista — um "+" que não sabe qual ticket abrir é um botão que abre outro
menu. Abrir da lista um ticket que já tem aba **foca a aba existente**, nunca duplica.

Teclado: `Ctrl+W` fecha a ativa, `Ctrl+Tab` / `Ctrl+Shift+Tab` circulam, `Ctrl+1..9` saltam
(`Ctrl+1` é a Fila). `Esc` volta para a Fila **sem fechar a aba** — voltar e fechar são
coisas diferentes, e só o `✕` e o `Ctrl+W` fecham.

As abas sobrevivem ao fechar o app. O que é guardado são os **números** dos tickets, e na
volta eles só viram aba se casarem com a fila carregada: ticket que saiu da fila não volta,
porque o app só mostra o que está em aberto.

## Tela de detalhe do ticket

Ocupa a janela inteira abaixo da faixa de abas (sem split e sem drawer: a 1280px qualquer
divisão espremeria os dois lados). Volta para a Fila com `←` ou `Esc`, sem fechar a aba.
`Esc` com busca preenchida limpa a busca primeiro, e só o segundo volta.

Busca, filtro de origem e posição de rolagem são **por aba**: sair de um ticket e voltar
devolve a tela como ela estava. Os trâmites vêm do cache por `lastUpdate` que já existia,
então trocar de aba não bate na rede.

Estrutura: barra com voltar + número + título + "parado há X" + **Resumir** + **Abrir no
portal** — a ação que acontece dentro do app vem antes da que leva para fora;
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
registrado no main, que faz proxy autenticado na API e devolve em stream. Quatro
armadilhas que custaram tempo e estão amarradas por comentário no código:

1. O id vai no **path**, nunca no host — com scheme `standard`, um host só de dígitos
   é lido como IPv4 decimal (`1218235` vira `0.18.150.187`).
2. O portal marca todo anexo como `Content-Disposition: attachment`. Repassar isso faz
   o Chromium abrir "Salvar como" em vez de renderizar; o handler força `inline`.
3. `fetch('anexo://…')` do renderer morre em CORS (outra origem). Texto, planilha e
   docx vão por IPC; só `<img>`/`<video>/<iframe>` usam a URL direto.
4. **Nenhum header do portal é copiado para a resposta.** Um anexo com nome acentuado traz
   U+FFFD no `Content-Disposition`, e `Headers.set` rejeita isso como ByteString — dentro
   do Electron, antes do nosso código, derrubando o processo main. `respHeaders()` monta do
   zero o que o visualizador precisa.

Conversão de planilha e docx acontece no **main**, não no renderer: as bibliotecas
ficam fora da página e o HTML gerado ainda passa por `sanitize.js` antes do DOM.
Figuras de .docx sobrevivem porque o sanitizador aceita `<img>` com `data:image/…`
(menos SVG, que carrega script).

## Configurações

Um dialog só, com três seções: **a chave da API**, **os repositórios locais** e **os meus
status**. O botão da
barra deixou de ser uma chave e virou faders — ele abre Configurações, das quais a chave é
uma seção; manter o ícone antigo faria o botão mentir sobre o próprio conteúdo. Engrenagem
foi descartada por medida, não por gosto: os ícones da barra renderizam a 14px, e os dentes
de uma engrenagem viram mancha nesse tamanho. Traço reto casa com o `#i-thread` e o
`#i-resumo` da mesma folha. O `#i-key` **fica** — os estados de "sem chave" e "chave
rejeitada" continuam sendo sobre a chave especificamente.

**Dois dialogs seriam dois botões na barra** — e três, quando a seção seguinte chegasse. As
seções se separam por filete de 1px e pelo rótulo mono/caixa-alta — o mesmo
registro do `.rs-k` do resumo e da faixa de metadados. Caixa em volta seria card dentro de
card, proibido neste mundo.

**A largura continua 470px.** Um caminho como `C:\dev\praxio\Autumn.SIGAi` ocupa ~190px em
mono 12px; alargar o dialog para caber um caso que já cabe deixaria calha morta, que é
exatamente o defeito que a regra da medida existe para evitar. A altura é que deixou de ser
previsível — N repositórios, N status — então o dialog virou coluna com corpo rolável, herdando o
padrão do `#resumo`, teto em 640px.

**Repositório é linha, não card:** separada por 1px, como os trâmites e as linhas da lista.
Caminho em mono (é dado medido, não prosa), "Procurar…" e remover à direita. **A linha é só
o caminho** — nada de etiquetar cada repositório com os módulos do portal que ele atende.
Esse mapa existiu, e o que ele fazia era o app escolher o repositório sozinho e errar em
silêncio quando a etiqueta estava errada ou faltando. Perguntar na hora custa um clique e
não tem como errar calado: a lista dos repositórios apontados está à vista no momento da
decisão.

**Chave já gravada aparece como 104 bolinhas**, em `--text-faint`, com o contador trocado
por "chave configurada". Campo vazio numa tela de configuração diz "não há nada aqui", que é
mentira quando o app está lendo tickets — e obrigaria a recolar a chave só para mexer num
repositório. As bolinhas **não são a chave**: ela nunca chega ao renderer (regra de ouro #1),
`hasKey()` devolve só um booleano, e a máscara é gerada na própria tela. Clicar limpa o campo
para colar por cima; sair sem digitar devolve a máscara, para o dialog não passar a mentir no
sentido contrário.

**O rodapé governa só a chave.** Os repositórios salvam a cada mudança, sozinhos, porque
ninguém espera apertar Salvar numa lista. Por isso "Cancelar" virou **"Fechar"** — não há
nada pendente para cancelar. O botão de confirmação muda de nome conforme o que vai mesmo
acontecer: **"Salvar"** enquanto a chave está intocada, **"Salvar e carregar"** quando há uma
chave nova de 104 caracteres, que é o único caso em que a lista recarrega. Ele só nasce
desabilitado na primeira execução, quando não há chave nem repositório para guardar.

Chave intocada — mascarada ou apagada sem querer — **não é regravada e não refaz o fetch**.
Cobrar ~3,5s por uma mudança que não houve seria punir quem entrou para outra coisa, e um
campo limpo por acidente não pode derrubar a chave que já funciona.

**Caminho que não existe não é erro.** O repositório pode estar num drive desconectado ou
ainda não clonado, e reprovar a lista inteira por causa de uma linha faria o autosave perder
as linhas boas. Nada lê esses caminhos ainda — a relação existe para ser usada depois.

## Resumo do ticket

Um botão na barra do detalhe entrega o ticket ao `claude` da máquina e devolve quatro
blocos: **o que está ocorrendo / onde / por quê / possível solução**. Existe porque a
pergunta "esse ticket espera mim ou espera o cliente?" hoje custa ler o log inteiro, do
mais recente para o mais antigo, misturando voz de cliente, de operador e nota privada.

**Em `<dialog>`, não inline.** A tela de detalhe já é densa — metadados, faixa de anexos,
filtros, trâmites, visualizações. Um painel inline empurraria a faixa de anexos para
baixo, e o próprio contrato diz que esconder anexo atrás de rolagem inverte a prioridade.
O resumo é leitura de uma vez: lê, decide, fecha. Esc nativo.

**A largura sai da medida, não o contrário.** 560px, que dá ~73 caracteres por linha. Um
dialog mais largo que a linha de texto deixa uma calha morta à direita — foi exatamente o
defeito da primeira versão, a 680px com a prosa parando em 68ch.

**Rótulo é o mesmo registro da faixa de metadados**: mono, caixa alta, 10px, `--text-faint`.
O ar fica **acima** do rótulo, não abaixo, para o par rótulo+parágrafo ler como um bloco só.
A prosa é `--text` em sans — o resumo é texto para ler, não dado medido.

**A espera é de dezenas de segundos**, muito além dos ~3,5s do fetch. Em vez de tela vazia,
o dialog abre na hora com os quatro rótulos já no lugar e réguas onde o texto vai entrar:
o formato se ensina antes de chegar, e não há salto de layout quando chega. Nada pisca —
o único movimento é a mesma barra de 1px do fetch, aqui no rodapé da barra do dialog. O
botão troca o rótulo para "Resumindo…" e desabilita, como o "Atualizar" da lista.

**Nada de âmbar aqui.** O botão é neutro. Na mesma barra existe um "parado há 3d" em âmbar,
e dois âmbares competindo apagariam justamente o sinal que a tela inteira foi construída
para carregar.

**O texto entra por `textContent`.** Não é markdown, não é HTML, e por isso não encosta no
`sanitize.js`. O parser que separa os quatro blocos é fail-open de propósito: rótulo que o
modelo inventar vira texto do bloco anterior em vez de sumir da tela.

### Quando o resumo envelhece

O resumo é guardado em disco e volta pronto na próxima abertura, inclusive depois de
fechar o app. Quando o ticket recebe trâmite novo, o resumo guardado passa a descrever um
ticket que não existe mais — e aí **ele não se refaz sozinho**. Refazer custa dezenas de
segundos e uma chamada paga; gastar isso sem o usuário pedir seria decidir por ele.

O que aparece é a mesma faixa `.notice` da lista, no variante âmbar — que neste app já
significa "o que você está vendo é velho", e só isso. A faixa não repete o botão: diz o
fato e aponta para o "Refazer" que está 40px acima, na barra do próprio dialog.

O carimbo **"resumido em DD/MM/AAAA HH:mm"** fica na barra, em mono, ao lado do título. Um
resumo que sobrevive a reinícios precisa dizer a idade; sem isso, texto velho e texto novo
são indistinguíveis.

**Refazer que falha não esvaziar a tela** é a mesma regra da lista: o resumo anterior
continua no lugar, com o carimbo dele, e a faixa vira vermelha explicando o que falhou.
Resumo visivelmente velho é melhor que dialog vazio.

### As imagens do ticket vão junto

O consultor que escala o ticket costuma anexar um print do erro, e o código que decide o
diagnóstico mora ali dentro — não no texto. Então o resumo leva **as imagens anexadas**
além do texto: verificado com um print cujo código de erro não aparecia em trâmite nenhum,
e o resumo citou o código.

**A escalação é reconhecida pelo formulário, não por uma frase.** O portal não marca
escalação em campo nenhum — não há flag, `status` nem `origin` que diga isso. O que existe
é um trâmite que o consultor preenche sempre com os mesmos rótulos:

```
Versão de Teste:  2.3.8.2
Caminho: Faturamento > Enviar email
Período de Teste:
Base de Teste: AWS_SAOLUIZEXPRESS
Servidor:srv00
Problema: O erro relatado anteriormente voltou a ocorrer…
```

Contar rótulos (três dos seis) aguenta o que casar uma frase não aguentaria: acento que
some, caixa que varia, dois-pontos sem espaço depois, campo deixado em branco, e o
`Usuário`/`Senha` que só às vezes vem. Três é o piso porque uma resposta que cite um rótulo
solto ("sobre o caminho: …") não pode ser lida como escalação.

**Um ticket escala mais de uma vez** — o formulário volta quando o erro reaparece numa
versão nova. Vale a escalação **mais recente que trouxe imagem**: é a que o desenvolvedor
tem em mãos. Nenhuma casando, cai para as primeiras imagens do ticket em ordem
cronológica — falhar para menos preciso é melhor que falhar para vazio.

**O formulário não entra no corte.** O prompt tem teto e corta os trâmites mais antigos
primeiro, que num ticket longo é exatamente onde a escalação está — e aí a imagem chegaria
sem o texto que a explica. Ele tem orçamento reservado e vai marcado, porque é dele que
saem versão, caminho, base e servidor: os dados que transformam "investigar" em
"reproduzir em `AWS_SAOLUIZEXPRESS`/`srv00`".

**Três pistas, e a diferença entre elas é o custo em token.**

| Anexo | Como vai | Custo |
|---|---|---|
| `png` `jpg` `gif` `webp` | bloco `image` | ~1-2k tokens por print |
| `pdf` | bloco `document` | ~1,5-3k tokens **por página** |
| `xlsx` `xls` `ods` | SheetJS → **CSV** → texto no prompt | barato |
| `docx` | mammoth → **texto puro** → texto no prompt | barato |
| `txt` `csv` `xml` `sql` `json` `log` `md` | texto no prompt | barato |

Planilha e `.docx` reusam as duas bibliotecas que o visualizador já carrega, mas pela saída
de **texto**, não de HTML: a tela precisa de tabela, o modelo não. Uma planilha em CSV custa
uma fração do mesmo dado em `<table>`, e markup é token dizendo a mesma coisa.

**Vídeo e áudio ficam de fora por decisão de produto** — consomem token demais para o que
entregam num resumo que se lê de relance. `bmp` fica de fora porque a API não recebe, `svg`
pelo mesmo motivo do `sanitize.js` (svg executa script), e **`.doc` antigo** porque o
mammoth lê `.docx` e nenhuma das duas bibliotecas abre OLE binário — ler `.doc` exigiria
dependência nova, que a regra #15 não paga por isto.

**As cotas são por pista, não um teto único**, porque os custos não se comparam: 4 imagens,
2 PDFs, 4 arquivos de texto, 8 anexos no total. Um teto só deixaria um PDF gordo comer a
vaga de todos os prints. O conteúdo de texto tem teto próprio — 12 mil chars por anexo,
30 mil somando todos — e vai **depois** dos trâmites: a história do ticket é o que dá
sentido ao arquivo, e não o contrário.

**Página de PDF é o único custo que escala sozinho**, então ele tem teto de 10 páginas. A
contagem é por regex no cru e é oportunista: PDF 1.5+ pode comprimir os objetos de página
e aí não dá para contar — nesse caso quem segura é o teto de 2 MB.

**Nada toca o disco**, como no visualizador de anexos. Os bytes vão em base64 pelo stdin
do CLI, e a ferramenta `Read` continua bloqueada.

### O consentimento

O conteúdo do ticket — nome de cliente, texto dos trâmites e as imagens anexadas — sai da
máquina. Isso é pedido uma vez, num dialog que diz por extenso o que sai e para onde vai,
antes da primeira chamada. Recusar não envia nada. O aceite grava um campo no mesmo
`config.json` da chave da API.

**O aceite é versionado.** Quando o resumo passou a mandar imagem, o que sai mudou de
categoria — um print carrega a tela inteira, às vezes outro sistema ou outro cliente junto.
Um aceite dado para "o texto dos trâmites" não cobre isso, então `CONSENT_V` subiu e o
dialog volta uma vez. Aceite que descreve o que sai só vale enquanto a descrição for
verdade.

O dialog também parou de mentir sobre o cache: ele dizia que o resumo "se refaz sozinho
quando o ticket recebe um trâmite novo", e o contrário é que é verdade — a seção acima diz
que ele **não** se refaz, avisa e espera o "Refazer".

Ênfase no corpo do dialog usa peso 500 e cor `--text`, como o `.tr-body b`. Negrito 700
vira mancha nesse tamanho, e peso maior num texto que continua `--text-dim` só pesa — quem
marca a ênfase é a cor subir.

O botão de confirmação usa `.btn-primary`, que **deixou de ser âmbar** nesta mudança: num
mundo quase preto, um neutro claro já é hierarquia suficiente, e a cor com significado
volta a ter um significado só. O "Salvar e carregar" da chave da API herdou o conserto.

## Hotfix a partir do resumo

Um segundo botão na barra do `#resumo` leva de "entendi o ticket" a "estou na branch, com a
pergunta pronta": pergunta em qual repositório, cria `hotfix/<número>` nele, escreve um
briefing com o resumo dentro da branch e abre um terminal com o `claude` — **com a frase já
digitada na caixa e não enviada**.

**Mora na barra do resumo, não na do detalhe.** A ação só existe quando existe resumo — é
ele que vira o briefing. Na barra do resumo isso é estrutural: o botão está onde a
pré-condição já foi satisfeita, e não precisa de estado próprio para saber se pode
aparecer. Na barra do detalhe ele teria que nascer desabilitado e consultar o cache para
descobrir se libera, o que é mais máquina para dizer a mesma coisa.

**Depois de "Refazer"**, pela mesma regra da barra do detalhe: a ação que acontece dentro do
app vem antes da que sai dele. Refazer mexe no texto que você está lendo; Hotfix abre uma
janela fora do app e escreve em disco.

**O ícone `#i-branch` tem duas bolas, não três.** A versão canônica do símbolo de branch usa
três nós, e os ícones da barra renderizam a 14px — é a mesma medida que descartou a
engrenagem em Configurações. Duas bolas e um arco sobrevivem ao tamanho; o terceiro nó vira
mancha. Traço 1.6, a folha inteira.

**O último passo é do usuário, não do app.** O terminal abre com a pergunta escrita e o
cursor esperando: dá para acrescentar contexto, corrigir o rumo ou desistir antes que
qualquer coisa saia daqui. O app enviava essa frase sozinho, e o que isso tirava não era um
clique — era a única chance de corrigir a pergunta antes de ela custar uma resposta inteira.

**Sucesso não tem faixa.** O terminal abrindo é a confirmação — é uma janela nova na tela,
não há o que anunciar depois disso. Uma faixa de sucesso exigiria um variante verde do
`.notice`, cujo default neste app é âmbar, e âmbar aqui significa envelhecimento e nada
mais. O dialog do resumo fecha e o trabalho continua no terminal.

### A pergunta do repositório

**Um `<select>` no `#hotfixAsk`, não uma tela nova.** O dialog já era o lugar de "antes de
começar, isto" — escolher, confirmar o stash e explicar o que impediu são o mesmo instante,
e três telas para ele seriam três lugares para procurar a mesma resposta. O controle é o
`.sel` dos filtros da lista, só que ocupando a largura do dialog: os 180px de lá cortariam
justamente o fim do caminho, que é o que distingue um repositório do outro.

**Resumir pergunta também, e oferece "Sem repositório".** Lá a doc do repositório é
precisão a mais — sem ela o resumo diz "módulo de estoque" em vez do nome da unit, mas sai.
A hotfix não tem esse caminho: sem repositório não há onde criar a branch. E a pergunta só
aparece quando o resumo vai mesmo ser gerado; reabrir um resumo em cache não pergunta nada,
porque ali o clique não decidiria coisa alguma.

### Dois lugares para dizer que deu errado, e eles não são intercambiáveis

**O que impede de começar vai para o `#hotfixAsk`**: gitflow ausente, repositório sem
`git flow init`, nenhum repositório apontado, caminho que não existe, e o link do Claude
ainda não registrado nesta máquina. São situações em que nada aconteceu ainda e cada uma
tem um conserto diferente — "aponte um repositório" e
"rode `git flow init`" não se parecem. Um dialog dá espaço para nomear o problema e o
caminho de volta; uma faixa de uma linha, não.

**O que quebra no meio vai para a faixa `.notice[data-kind="down"]`** do próprio resumo, a
mesma do "não foi possível refazer". Aí já rodou alguma coisa: pode haver um stash, e o
resumo continua valendo atrás da faixa. Tirar isso da tela para mostrar um dialog seria a
mesma perda que a regra de ouro #4 evita na lista.

**Quando existe stash, a mensagem de erro diz o nome dele.** Um erro que não cita o stash
faz o usuário achar que perdeu o trabalho — e ele acabou de ver um aviso dizendo que tudo
seria guardado. O texto traz o nome e o `git stash pop`.

### O aviso do stash

Workspace com alterações abre o `#hotfixAsk` antes de qualquer comando: quantos arquivos,
em qual branch, para qual branch vai, e o caminho do repositório em mono — caminho é dado
medido, mesmo registro das linhas de Configurações. **Workspace limpo não pergunta nada**:
não há o que guardar, então não há decisão a tomar, e um dialog de confirmação sem
consequência é só um clique a mais.

**O botão de saída muda de nome conforme o que ele faz** — "Cancelar" quando há uma ação
pendente, "Fechar" quando o dialog é só informação. É a mesma decisão que transformou o
"Cancelar" de Configurações em "Fechar" quando o rodapé deixou de governar a lista.

O dialog **não fecha o resumo atrás dele**: os dois ficam empilhados, e o texto que motivou
a hotfix continua visível enquanto você decide. Reusa `dialog`, `.dlg-body` e `.dlg-foot`,
e a largura de 470px já foi calculada para caber um caminho como
`C:\dev\praxio\Autumn.SIGAi` em mono 12px.

### O briefing é a fronteira, não a linha de comando

O `.md` que entra na branch carrega título, cliente e o texto do resumo. **Nada disso passa
pela linha de comando**: só o número do ticket, filtrado por allowlist
(`slugTicket`, `services/git.js`), vira nome de branch, nome de arquivo e parte da URL que
abre o Claude. É a mesma postura fail-closed do `sanitize.js`, aplicada a uma fronteira
nova.

O briefing também avisa o Claude, por extenso, de que o texto do ticket é **material para
diagnóstico e nunca instrução** — o mesmo risco de injeção que o prompt de sistema do resumo
já trata, agora que o texto vira um arquivo entregue a um agente com ferramentas.

O arquivo entra no `.git/info/exclude`, não no `.gitignore`: o briefing é do app e do
momento, e o `.gitignore` é versionado e pertence ao time. A branch nasce e permanece limpa.

## Atualização pelo GitHub

Quando existe uma release mais nova que este `.exe`, uma faixa aparece no topo da lista com
um botão que baixa a versão nova, troca o binário no lugar e reabre o app. A checagem
acontece uma vez por abertura, e **sem novidade a tela não muda** — nada de "você está
atualizado", que é um aviso que ninguém pediu ocupando o topo da tela o dia inteiro.

**Reusa a faixa `.notice` da lista: nenhum markup novo, nenhuma regra de CSS nova.** O nó já
existe, já tem o par texto + botão, e já é o lugar onde este app diz "algo que você deveria
saber, sem te impedir de trabalhar".

**Âmbar, e esta é a segunda e última extensão da mesma leitura.** A regra de ouro #7 reserva
`--amber` para envelhecimento, e o resumo desatualizado já esticou isso para "o que você está
vendo é velho". Um app atrás da release é literalmente o mesmo formato: existe algo mais novo
do que o que está na sua frente. O que continua proibido é âmbar como ênfase — "importante",
"novo", "clique aqui". Inventar um variante verde ou azul para esta faixa estava fora de
questão pelo mesmo motivo que o sucesso da hotfix não tem faixa: são dois variantes, e cada
cor a mais apaga a que já significava alguma coisa.

**A faixa é um nó só e três avisos a disputam** — erro de refresh, erro da atualização e
"existe versão nova". A precedência não é arbitrária: **o que acabou de acontecer ganha a
vez**. Erro é evento, e evento perde a chance se não for visto agora; "existe versão nova"
não é evento, é um fato que continua verdade — então ele volta sozinho no próximo `load`
limpo, sem nada para reafirmá-lo. Uma versão nova é, de longe, a coisa menos urgente que
pode aparecer nesta tela.

**O botão chama "Instalar e reabrir", não "Atualizar".** Duas razões, e as duas são dele:
"Atualizar" já é o nome do botão da barra 40px acima, que recarrega a lista — dois controles
com o mesmo nome e consequências incomparáveis na mesma tela. E o app **se fecha sozinho** no
fim da troca; descobrir isso depois do clique seria susto. O rótulo carrega o aviso, o que é
melhor que uma frase avisando sobre o clique — a faixa continua com uma linha.

**Baixando é rótulo, não barra.** O `.exe` tem ~97 MB e a espera pode passar de um minuto. O
botão troca para "Baixando…" e desabilita, exatamente como o "Atualizando…" da lista e o
"Resumindo…" do resumo — é a palavra que este app já usa para espera longa. Porcentagem
exigiria download em stream com evento de progresso atravessando o IPC, e a `.loadbar` do
topo é governada pelo fetch da lista, que continua rodando a cada 60s por baixo: as duas
disputariam o mesmo nó. Se um dia a troca falhar por rede lenta a ponto de alguém matar o
app achando que travou, é aí que a porcentagem se paga.

**Sucesso não tem faixa**, pela mesma razão do terminal da hotfix: o app fechar e reabrir na
versão nova é a confirmação. A falha vai para o variante vermelho com "Tentar de novo",
porque nada foi trocado no disco e a lista atrás continua válida — a mesma divisão da regra
de ouro #4.

**A faixa diz as duas versões** ("Versão 1.1.0 disponível — esta é a 1.0.0."). É o único
lugar do app que mostra a versão, e de propósito: uma linha "Versão" em Configurações seria
uma terceira seção que se lê uma vez na vida, enquanto aqui o número aparece exatamente no
momento em que ele significa alguma coisa — quando está atrasado.

**Rodando de `npm start` a faixa nunca aparece.** Não há `.exe` para trocar, e quem roda do
repositório atualiza com `git pull`. Um botão que não tem o que fazer é pior que botão
nenhum.
