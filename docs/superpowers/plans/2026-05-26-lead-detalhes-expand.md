# Painel de detalhes do lead (expand inline) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um botão "Ver detalhes" em cada lead da tela `/leads` que expande um painel abaixo do card mostrando nome, número, email, CEP e resumo de interesse completo.

**Architecture:** Mudança contida em dois arquivos — `src/actions/leads.ts` (estender `LeadRow` e `getLeads()` para ler `email` e `cep` da tabela `leads`) e `src/components/leads/LeadsView.tsx` (novo estado `expandedId`, botão por linha, painel renderizado condicionalmente). Sem nova migration (campos já existem no schema), sem libs novas, sem componente novo.

**Tech Stack:** Next.js 16 (App Router, React Server Components no entry e Client Component no `LeadsView`), TypeScript, Tailwind, Supabase JS client. Spec: `docs/superpowers/specs/2026-05-26-lead-detalhes-expand-design.md`.

---

## File Structure

- **Modify:** `src/actions/leads.ts` — adicionar `email` e `cep` à interface `LeadRow` e ao `.select(...)` do `getLeads()`.
- **Modify:** `src/components/leads/LeadsView.tsx` — adicionar estado `expandedId`, botão "Ver detalhes"/"Ocultar" por linha, e o painel expandido com grid 2-colunas.

Nenhum arquivo novo, nenhuma migration.

---

### Task 1: Estender `LeadRow` e `getLeads()` com email e CEP

**Files:**
- Modify: `src/actions/leads.ts`

- [ ] **Step 1: Adicionar `email` e `cep` à interface `LeadRow`**

Edit `src/actions/leads.ts` — substituir o bloco da interface:

```ts
export interface LeadRow {
  id: string
  name: string
  whatsapp: string
  interestSummary: string
  createdAt: string
  contactedAt: string | null
  contactedByName: string | null
  email: string | null
  cep: string | null
}
```

- [ ] **Step 2: Incluir `email` e `cep` no `.select(...)` do `getLeads()`**

Substituir a string do `.select(...)`:

```ts
.select(
  'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name, email, cep',
)
```

- [ ] **Step 3: Mapear os novos campos no retorno do `getLeads()`**

No `data.map(...)`, adicionar:

```ts
return data.map((l) => ({
  id: l.id,
  name: l.name ?? 'Sem nome',
  whatsapp: l.whatsapp ?? '',
  interestSummary: l.interest_summary ?? '',
  createdAt: l.created_at,
  contactedAt: l.contacted_at,
  contactedByName: l.contacted_by_name,
  email: l.email ?? null,
  cep: l.cep ?? null,
}))
```

- [ ] **Step 4: Rodar type-check**

Run: `npx tsc --noEmit`
Expected: zero erros relacionados a `LeadRow`, `getLeads`, ou `LeadsView`.

> Nota: `LeadsView.tsx` consome `LeadRow` mas ainda não usa os campos novos
> nesta task — então o type-check passa porque os campos são opcionais de
> uso (não acessamos ainda). Os dois campos já estão no tipo: ok.

- [ ] **Step 5: Commit**

```bash
git add src/actions/leads.ts
git commit -m "feat(leads): expor email e cep no LeadRow"
```

---

### Task 2: Adicionar estado `expandedId` no `LeadsView`

**Files:**
- Modify: `src/components/leads/LeadsView.tsx`

- [ ] **Step 1: Adicionar o `useState` para o id expandido**

No topo do componente `LeadsView`, junto com os outros `useState`:

```tsx
const [expandedId, setExpandedId] = useState<string | null>(null)
```

Local exato: dentro da função `LeadsView`, logo após `const [copiedId, setCopiedId] = useState<string | null>(null)`.

- [ ] **Step 2: Adicionar o handler de toggle**

Logo abaixo da função `handleCopy`, antes do `return`:

```tsx
function toggleExpanded(id: string) {
  setExpandedId((current) => (current === id ? null : id))
}
```

- [ ] **Step 3: Rodar type-check**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): estado expandedId para painel de detalhes"
```

---

### Task 3: Adicionar botão "Ver detalhes"/"Ocultar" na fileira de ações

**Files:**
- Modify: `src/components/leads/LeadsView.tsx`

- [ ] **Step 1: Inserir o botão à esquerda de "Copiar nº"**

No bloco `<div className="flex items-center gap-2 shrink-0">` (a fileira de
ações de cada lead), inserir o botão `Ver detalhes` como **primeiro** filho,
antes do botão "Copiar nº":

```tsx
<div className="flex items-center gap-2 shrink-0">
  <button
    type="button"
    onClick={() => toggleExpanded(l.id)}
    aria-expanded={expandedId === l.id}
    aria-controls={`lead-details-${l.id}`}
    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
  >
    {expandedId === l.id ? 'Ocultar' : 'Ver detalhes'}
  </button>
  <button
    type="button"
    onClick={() => handleCopy(l.id, l.whatsapp)}
    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
  >
    {copiedId === l.id ? 'Copiado!' : 'Copiar nº'}
  </button>
  {!l.contactedAt && (
    <button
      type="button"
      onClick={() => handleContacted(l.id)}
      disabled={pending}
      className="text-[12.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
    >
      Marcar contatado
    </button>
  )}
</div>
```

- [ ] **Step 2: Rodar type-check**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): botao Ver detalhes/Ocultar por linha"
```

---

### Task 4: Renderizar o painel expandido (estrutura sem dados ainda)

**Files:**
- Modify: `src/components/leads/LeadsView.tsx`

A linha atual de cada lead usa `flex items-center gap-4`. Para o painel
expandido caber embaixo da linha sem quebrar o layout horizontal do header,
o container raiz de cada lead vira `flex flex-col` com a linha atual virando
um sub-`flex` interno.

- [ ] **Step 1: Reestruturar o `<div>` raiz do lead para coluna**

Substituir todo o bloco `<div key={l.id} className="px-5 py-4 flex items-center gap-4">...</div>` por:

```tsx
<div key={l.id} className="px-5 py-4 flex flex-col gap-4">
  <div className="flex items-center gap-4">
    <div className="min-w-0 flex-1">
      <div className="text-[14px] font-semibold text-ink-900 truncate">
        {l.name}
      </div>
      <div className="text-[12.5px] text-ink-500 truncate">
        {l.interestSummary || 'Sem resumo de interesse'}
      </div>
      {l.contactedAt && (
        <div className="eyebrow text-ink-400 mt-1">
          CONTATADO
          {l.contactedByName ? ` POR ${l.contactedByName}` : ''} ·{' '}
          {formatLeadDate(l.contactedAt)}
        </div>
      )}
    </div>
    <div className="text-[12.5px] font-mono text-ink-600 shrink-0">
      {l.whatsapp}
    </div>
    <div className="text-[11.5px] text-ink-400 tabular shrink-0">
      {formatLeadDate(l.createdAt)}
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => toggleExpanded(l.id)}
        aria-expanded={expandedId === l.id}
        aria-controls={`lead-details-${l.id}`}
        className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
      >
        {expandedId === l.id ? 'Ocultar' : 'Ver detalhes'}
      </button>
      <button
        type="button"
        onClick={() => handleCopy(l.id, l.whatsapp)}
        className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
      >
        {copiedId === l.id ? 'Copiado!' : 'Copiar nº'}
      </button>
      {!l.contactedAt && (
        <button
          type="button"
          onClick={() => handleContacted(l.id)}
          disabled={pending}
          className="text-[12.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
        >
          Marcar contatado
        </button>
      )}
    </div>
  </div>

  {expandedId === l.id && (
    <div
      id={`lead-details-${l.id}`}
      role="region"
      className="border-t border-ink-100 pt-4"
    >
      {/* painel sera preenchido na Task 5 */}
      <div className="text-[12.5px] text-ink-500">Detalhes...</div>
    </div>
  )}
</div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: Validar visualmente o toggle**

Run: `npm run dev` (em background)
Abrir `http://localhost:3000/leads` no navegador.

Manual:
- Clicar "Ver detalhes" em um lead → "Detalhes..." aparece abaixo.
- Clicar "Ver detalhes" em outro lead → primeiro fecha, segundo abre.
- Clicar "Ocultar" no lead expandido → fecha.
- Trocar entre abas "Novos" / "Contatados" → painel some.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): estrutura do painel expandido (toggle funcional)"
```

---

### Task 5: Preencher o painel expandido com os campos do lead

**Files:**
- Modify: `src/components/leads/LeadsView.tsx`

- [ ] **Step 1: Substituir o placeholder pelo grid de campos**

Substituir o `<div className="text-[12.5px] text-ink-500">Detalhes...</div>`
dentro do bloco `expandedId === l.id` por:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
  <div>
    <div className="eyebrow text-ink-500">NOME</div>
    <div className="text-[13px] text-ink-900 mt-0.5">{l.name}</div>
  </div>
  <div>
    <div className="eyebrow text-ink-500">NÚMERO</div>
    <div className="text-[13px] text-ink-900 mt-0.5 font-mono">
      {l.whatsapp || (
        <span className="text-ink-400 font-sans">Não informado</span>
      )}
    </div>
  </div>
  <div>
    <div className="eyebrow text-ink-500">EMAIL</div>
    <div className="text-[13px] mt-0.5">
      {l.email ? (
        <span className="text-ink-900">{l.email}</span>
      ) : (
        <span className="text-ink-400">Não informado</span>
      )}
    </div>
  </div>
  <div>
    <div className="eyebrow text-ink-500">CEP</div>
    <div className="text-[13px] mt-0.5">
      {l.cep ? (
        <span className="text-ink-900">{l.cep}</span>
      ) : (
        <span className="text-ink-400">Não informado</span>
      )}
    </div>
  </div>
  <div className="md:col-span-2">
    <div className="eyebrow text-ink-500">RESUMO DE INTERESSE</div>
    <div className="text-[13px] mt-0.5">
      {l.interestSummary ? (
        <span className="text-ink-900 whitespace-pre-wrap">
          {l.interestSummary}
        </span>
      ) : (
        <span className="text-ink-400">Não informado</span>
      )}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: Validação visual**

Com `npm run dev` rodando, abrir `/leads`:

- Expandir um lead **com email e CEP preenchidos** → todos os 5 campos
  mostram o valor em `text-ink-900`.
- Expandir um lead **sem email e/ou sem CEP** → mostra "Não informado" em
  cinza claro (`text-ink-400`) nos campos vazios.
- Resumo de interesse longo → quebra linha, não estoura o card.
- Em viewport estreita (DevTools < 768px) → grid vira 1 coluna.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): preencher painel expandido com email, CEP e resumo"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Botão "Ver detalhes" por linha | Task 3, Task 4 |
| Toggle (um por vez) via `expandedId` | Task 2, Task 4 |
| Trocar de aba não precisa fechar painel | Task 4 (Step 3 valida) |
| Estender `LeadRow` com `email` e `cep` | Task 1 |
| `getLeads()` selecionar email e cep | Task 1 |
| Layout grid 2-colunas no painel | Task 5 |
| Resumo de interesse full-width | Task 5 (`md:col-span-2`) |
| Placeholder "Não informado" em cinza | Task 5 |
| `aria-expanded` / `aria-controls` / `role="region"` | Task 3, Task 4 |
| Sem migration nova | Confirmado — nenhuma task toca `supabase/` |
| Sem componente novo | Confirmado — só dois arquivos modificados |

**Placeholder scan:** O `"Detalhes..."` da Task 4 é um placeholder
**intencional e temporário**, substituído imediatamente na Task 5. Cada
task é commitável independentemente e a Task 4 deixa o toggle funcional
mesmo antes do conteúdo final.

**Type consistency:** `expandedId`, `setExpandedId`, `toggleExpanded`,
`lead-details-${l.id}` aparecem com nomes idênticos nas Tasks 2, 3, 4 e 5.
`LeadRow.email` e `LeadRow.cep` definidos na Task 1 e usados na Task 5.
