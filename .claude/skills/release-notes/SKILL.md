---
name: release-notes
description: Gera o texto das notas da release do Tickets a partir de tudo que mudou desde a última tag (commits e working tree). Use quando o usuário pedir release notes, notas da versão, novidades da release ou o texto para colar no GitHub.
---

# Notas da release

O texto vai no corpo da release do GitHub (`alvarosoaress/praxio-tickets-dev`) e aparece
dentro do app, no popup "Versão nova disponível" (`notasBlocos`, `renderer.js`). Quem lê
é o dev que usa o app, não quem mexe no código.

## 1. Juntar o que mudou

```bash
TAG=$(git describe --tags --abbrev=0)
git log --format='%h %s' "$TAG"..HEAD
git diff --stat "$TAG"
```

`git diff "$TAG"` (sem `..HEAD`) inclui o que ainda não foi commitado — entra também.
Para cada commit ou arquivo de UI, leia o diff de `renderer.js`, `index.html` e
`services/` o bastante para saber **o que o usuário vê ou faz de diferente**. O título do
commit sozinho não basta: ele costuma ser vago (`feat: open bug in azure`).

## 2. Filtrar

Entra só o que muda a experiência de quem usa o `.exe`:

- tela, botão, atalho, aviso ou fluxo novo;
- comportamento que mudou;
- bug corrigido que o usuário percebia;
- algo que o usuário precisa fazer (colar um token, aceitar de novo, reinstalar).

Fica de fora: testes, `tools/` (fake API), docs, `CLAUDE.md`, refactor, log de dev.
Se uma mudança interna mudou algo visível (ex.: ficou mais rápido), entra pelo efeito.

## 3. Escrever

Formato que o popup entende — **só isto**, o resto vira texto cru:

- `## Título` para cada grupo;
- `- item` para cada novidade;
- parágrafo solto em uma linha.

Negrito, código e link perdem a marcação no popup. Não use tabela, imagem nem lista
aninhada.

Regras do texto:

- Português, frases curtas, uma novidade por item.
- Diga o que a pessoa faz ou vê, com o nome do botão como aparece na tela.
- Um `## Título` por funcionalidade, com o nome que a pessoa reconhece na tela
  (ex.: `## Botão Criar Bug`, `## Aviso de versão nova`). Embaixo, uma linha dizendo o que
  ela é e, depois, os itens com o que ela faz.
- Mudança pequena que não forma uma funcionalidade vai no fim, em `## Melhorias` ou
  `## Correções`. Grupo vazio sai.
- Se o usuário precisa agir para usar algo, diga onde, como o último item da própria
  funcionalidade (ex.: Configurações → Azure DevOps).
- Nada de nome de arquivo, função, IPC ou commit.
- Sem introdução nem fechamento.

## 4. Entregar

Responda com o texto dentro de um único bloco ```` ```markdown ```` para copiar, e em uma
linha a faixa usada (`<tag>..HEAD`, com ou sem alterações não commitadas).

Não suba a versão, não crie tag e não publique release — isso exige aprovação
(`CLAUDE.md`, "O que NUNCA fazer"). Se pedirem a versão, sugira uma pelo semver
(novidade → minor, só correção → patch) sem mexer no `package.json`.
