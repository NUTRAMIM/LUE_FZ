# Painel de detalhes do lead (expand inline)

## Contexto

Hoje a tela `/leads` (renderizada por `src/components/leads/LeadsView.tsx`) mostra,
por lead, apenas: nome, resumo de interesse (truncado), whatsapp e timestamp.

A tabela `leads` tem mais campos preenchidos pelo workflow do n8n —
`email`, `cep` — que ficam invisíveis para o vendedor. O usuário pediu um
botão "Ver detalhes" em cada lead que expanda essas informações abaixo do
próprio card, sem abrir modal ou drawer.

## Objetivo

Permitir que o vendedor consulte rapidamente todos os dados que a IA capturou
sobre um lead — sem sair da lista, sem overlay.

## Escopo

**Campos exibidos no painel expandido:**

1. Nome
2. Número (WhatsApp)
3. Email
4. CEP
5. Resumo de interesse (completo, sem truncamento)

**Fora de escopo:**

- Histórico/transcrição da conversa (campo `conversation_id` existe mas não é
  consultado nesta entrega).
- Metadados (`first_seen_at`, `last_seen_at`, `metadata`).
- Campo `source` — hoje é sempre `'chat'`, não agrega valor enquanto não houver
  outras origens.
- Edição inline desses campos. O painel é read-only.

## Arquitetura

### Componente

Tudo dentro de `src/components/leads/LeadsView.tsx`. Sem novo componente —
o painel é renderizado dentro do mesmo `<div>` que já agrupa cada lead.

### Estado

Um único `useState<string | null>` no `LeadsView` chamado `expandedId`.

- Clicar em "Ver detalhes" de um lead → `setExpandedId(id)`.
- Clicar de novo no mesmo lead, ou em outro botão "Ver detalhes" → toggle:
  se `expandedId === id` vira `null`; senão vira o novo id.
- Resultado: **apenas um lead expandido por vez**.

Trocar de aba (`novos`/`contatados`) não precisa fechar o painel
explicitamente — `expandedId` simplesmente não vai bater com nenhum lead
visível, então nada é renderizado.

### Dados

`src/actions/leads.ts` precisa ler dois campos extras da tabela `leads`:

- `email` (TEXT, já existe na migration 003)
- `cep` (TEXT, já existe na migration 013)

Mudanças:

```ts
export interface LeadRow {
  // ... campos atuais
  email: string | null
  cep: string | null
}
```

E no `.select(...)` do `getLeads()`: adicionar `email, cep`, com mapeamento
correspondente. Nenhuma migration nova.

### UI

**Botão por linha.** Na fileira de ações de cada lead, à esquerda do
`Copiar nº`, um botão `Ver detalhes`. Quando o lead está expandido, o
mesmo botão mostra `Ocultar`. Estilo segue o padrão dos botões irmãos
(`text-[12.5px] font-semibold ... px-2.5 py-1.5 rounded-lg ring-1
ring-ink-200`).

**Layout do card quando expandido.** O `<div>` raiz de cada lead (hoje
`flex items-center gap-4`) passa a ser `flex flex-col`, com a linha atual
(info + ações) virando o "header" e o painel expandido renderizado
condicionalmente embaixo. Em telas largas a linha de cima continua
horizontal — só o painel expandido empurra a altura.

**Painel expandido (estrutura):**

```
┌────────────────────────────────────────────────┐
│ Nome              │ Número                     │
│ João Silva        │ (11) 99999-9999            │
├───────────────────┼────────────────────────────┤
│ Email             │ CEP                        │
│ joao@email.com    │ Não informado              │
├────────────────────────────────────────────────┤
│ Resumo de interesse                            │
│ Cliente busca tênis preto número 42 para …     │
└────────────────────────────────────────────────┘
```

Grid CSS de 2 colunas (`grid grid-cols-2 gap-x-6 gap-y-3`) para os 4
campos curtos, e o resumo de interesse em `col-span-2` embaixo. Cada
campo tem um eyebrow (label minúsculo em `text-ink-500`) e o valor em
`text-ink-900`.

**Campos vazios.** Helper inline simples:

```tsx
{lead.email ? (
  <span className="text-ink-900">{lead.email}</span>
) : (
  <span className="text-ink-400">Não informado</span>
)}
```

Aplicado a `email`, `cep` e `interestSummary` (este último já tem
fallback `'Sem resumo de interesse'` na linha principal, mas no painel
expandido usamos o texto cinza padrão para consistência).

### Acessibilidade

- Botão `Ver detalhes` recebe `aria-expanded={expandedId === l.id}` e
  `aria-controls={`lead-details-${l.id}`}`.
- O painel expandido recebe `id={`lead-details-${l.id}`}` e `role="region"`.

## Casos de erro

Nenhum caminho de erro novo:

- Campos vazios são tratados com placeholder.
- Não há fetch novo no clique — todos os dados já vêm de `getLeads()`.
- Se `getLeads()` falhar, a tela já trata isso hoje (página fica vazia).

## Testes

Não há testes para `LeadsView` hoje (`src/components/leads/` não tem
`__tests__/`). Esta entrega é puramente visual/UX num componente
client-only — validação será manual:

1. Abrir `/leads` com leads existentes.
2. Clicar `Ver detalhes` em um lead → painel aparece embaixo, botão vira
   `Ocultar`.
3. Clicar `Ver detalhes` em outro lead → primeiro fecha, segundo abre.
4. Clicar `Ocultar` no lead expandido → fecha.
5. Trocar entre abas `Novos` / `Contatados` → painel some junto com o lead.
6. Lead sem email/CEP → mostra `Não informado` em cinza.
7. Lead com resumo de interesse longo → texto quebra linha dentro do painel
   sem estourar o card.

## Riscos / não-objetivos

- **Performance:** com `limit(200)` na query e o estado de expansão sendo
  um único id, não há risco de re-render em massa.
- **Mobile:** o grid 2-colunas pode ficar apertado em telas estreitas; se
  necessário, vira `grid-cols-1` em `<md`. Decidir durante a implementação
  visual.
- **Edição:** explicitamente fora de escopo. Qualquer edit-in-place virá
  numa entrega separada.
