# Tickets — contexto de produto

> **Fica na raiz de propósito:** a skill `impeccable` lê este caminho exato.
> Índice geral em [`CLAUDE.md`](CLAUDE.md); mundo visual em [`DESIGN.md`](DESIGN.md).


**O que é.** App de desktop (Electron, Windows) que mostra os tickets de suporte em aberto
atribuídos ao time de desenvolvimento da Praxio.

**Quem usa.** Desenvolvedores do time. Fica aberto num segundo monitor o dia inteiro.

**A tarefa.** Responder "o que precisa de mim agora?" sem abrir o portal. O sinal primário
é **há quanto tempo o ticket está parado** (`lastUpdate`) — não o status, não o cliente.

**Verdades do produto.**
- Fonte única: `GET https://portalapi.188720391.xyz/scrape-custom/27662` (busca salva do
  portal Praxio). Header `Authorization` com chave crua de 104 chars, sem `Bearer`.
- A chamada leva ~3,5s e não tem cache; devolve o conjunto inteiro, sem paginação.
- Campos exibíveis já chegam como string pronta. Datas em `DD/MM/YYYY HH:mm:ss`.
- `responsible` é o desenvolvedor; `person` é quem abriu do lado do cliente.
- A API também responde 401 `"Falha no login"` quando o **servidor** falha ao logar no
  portal — não é problema da chave do usuário, e a UI não pode culpá-lo por isso.

**Modo:** Operate. A ferramenta some dentro da tarefa.

**Fora de escopo v1:** SLA/VOC, notas de ticket, trâmites, notificações.

_Escrito a partir do brief explícito do usuário + leitura da API. Sem entrevista longa._
