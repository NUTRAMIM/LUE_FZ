# Redesign da página `/estoque` — Design

**Data:** 2026-05-12
**Branch sugerida:** `feat/estoque-redesign`
**Status:** spec aprovada, pronta para plano (Leva 1)

## Objetivo

Substituir a tabela básica atual de `/estoque` por uma página rica de controle de estoque, alinhada ao screenshot de referência fornecido pelo usuário e ao design system violet (`brand-redesign-violet`, leva 2). A entrega cobre cinco KPIs, busca + filtros, tabela com chips de variantes, status de estoque, drawer "Ver Detalhes", e (na leva 2) CRUD completo de produtos com chip input para cores/tamanhos.

**Não-objetivos desta entrega (qualquer leva):**
- Upload de arquivos de imagem (só URLs por enquanto).
- Estoque por variante real (cor × tamanho com quantidade individual) — adiado pra projeto futuro.
- Histórico/log de movimentações de estoque — não vai existir tabela `stock_movements`.
- Paginação server-side (lista cliente-side; vira tarefa se passar de algumas centenas de produtos).
- Integração nova com API FacilZap — o botão "Importar JSON" atual fica como está (mesma funcionalidade da rota `/estoque/import`).

## Decisões já tomadas (brainstorming)

| Pergunta | Decisão |
|---|---|
| Escopo | Tudo do screenshot |
| `stock_min` | Por produto, com default global em `store_settings` |
| Botão "Importar" | Mantém atual "Importar JSON" (mesma rota); não renomeia para FacilZap |
| Adicionar/Editar | Modal/Dialog na mesma página |
| Ações inline | ⬆️⬇️ ajustam estoque em ±1 sem confirmação; ✏️ abre modal; 🗑️ pede confirmação |
| Ver Detalhes | Drawer lateral (slide da direita) |
| Aba "Estoque Detalhado" | Placeholder "Em breve" (modelagem de variantes adiada) |
| Entrega | 3 levas incrementais (B) |
| Design system | Reusar primitives de `src/components/ui/` (StatCard, Button, Card, Badge, Input). Criar `Drawer` novo (não existe). |

## Migrations (Leva 1)

```sql
ALTER TABLE products
  ADD COLUMN stock_min int NOT NULL DEFAULT 0;

ALTER TABLE store_settings
  ADD COLUMN default_stock_min int NOT NULL DEFAULT 5;
```

`stock_min = 0` significa "usar default da loja". Atualizar `src/types/database.ts` para refletir.

## Cálculo de status (helpers)

`src/lib/stock-status.ts`:

```ts
export function getEffectiveStockMin(product, defaultMin: number): number {
  return product.stock_min > 0 ? product.stock_min : defaultMin
}

export type StockStatus = 'ok' | 'baixo' | 'sem'

export function getStockStatus(stockQty: number, effectiveMin: number): StockStatus {
  if (stockQty === 0) return 'sem'
  if (effectiveMin > 0 && stockQty <= effectiveMin) return 'baixo'
  return 'ok'
}
```

## Arquitetura

### Componentes novos

- `src/app/estoque/page.tsx` — server component. Busca `products` + `store_settings.default_stock_min` do usuário.
- `src/app/estoque/EstoqueClient.tsx` — client. Estado: `searchQuery`, `statusFilter`, `view` ('produtos' | 'detalhado'), `selectedProductId` (drawer), `editingProduct` (modal leva 2).
- `src/components/estoque/KpiSection.tsx` — 5 `StatCard`s.
- `src/components/estoque/FilterBar.tsx` — busca + filtros + botões "Importar JSON" e "Adicionar Produto".
- `src/components/estoque/ProductTable.tsx` — tabela.
- `src/components/estoque/ProductRow.tsx` — linha (chips de variantes, status badge, ações).
- `src/components/estoque/ProductDetailsDrawer.tsx` — drawer com infos completas.
- `src/components/ui/Drawer.tsx` — **novo primitive** (overlay + side panel + backdrop).
- `src/lib/stock-status.ts` — helpers de status.

### Leva 2 (preview)

- `src/actions/products.ts` — `createProduct`, `updateProduct`, `deleteProduct`, `adjustStock(productId, delta)`. Todas com `revalidatePath('/estoque')`.
- `src/components/estoque/ProductFormDialog.tsx` — modal compartilhado adicionar/editar.
- `src/components/estoque/DeleteConfirmDialog.tsx`.
- `src/components/ui/Dialog.tsx` — **novo primitive** (overlay + centered modal).

### Leva 3 (preview)

- Aba "Estoque Detalhado" mostra `<EmptyState>` "Em breve".
- Ajustes de responsividade e refinamentos visuais.

## KPIs (Leva 1)

| Card | Cálculo | Tone |
|---|---|---|
| Total de Produtos | `products.length` | brand |
| Total em Estoque | `Σ stock_quantity` (label "unidades") | info |
| Estoque Baixo | count(`status==='baixo'`) (label "produtos") | warning |
| Sem Estoque | count(`status==='sem'`) (label "produtos") | danger |
| Valor Total | `Σ stock_quantity × price` formatado em R$ (label "em estoque") | success |

Todos usando o primitive `StatCard` com `emphasis="value"`.

## Busca + filtros (Leva 1)

- Busca: case-insensitive, normaliza acentos via `String.normalize('NFD')`, casa em `name`, `category` e `sku`.
- Filtros mutuamente exclusivos: `Todos` | `Estoque Baixo` | `Sem Estoque`.
- Busca e filtros combinam por AND.
- Tudo client-side (paginação fica fora de escopo).
- Estado controlado em `EstoqueClient`.

## Tabela (Leva 1)

Colunas conforme screenshot, da esquerda pra direita:

| # | Coluna | Conteúdo |
|---|---|---|
| 1 | PRODUTO | thumbnail (40×40) + nome + descrição truncada (1 linha) + SKU embaixo |
| 2 | CATEGORIA | texto ou "—" |
| 3 | VARIANTES | chips de `tamanhos` (Badge tone="neutral") + chips de `cores` (Badge tone="neutral") |
| 4 | ESTOQUE | número grande (font-display, bold) |
| 5 | MÍN. | número `effectiveMin` |
| 6 | STATUS | Badge `success`/`warning`/`danger` |
| 7 | PREÇO | `R$ X.XX` |
| 8 | VALOR TOTAL | `R$ X.XX` (stock × price), tone success |
| 9 | DETALHES | botão "Ver Detalhes" (variant outline) abre drawer |
| 10 | AÇÕES | 4 IconButtons: ⬆️ ⬇️ ✏️ 🗑️ — **desabilitados na leva 1** |

Mobile: container `overflow-x-auto` (igual comportamento atual).

## Drawer "Ver Detalhes" (Leva 1)

Primitive novo `Drawer`:
- Backdrop semitransparente (`bg-slate-900/40`) cobre tela inteira.
- Painel lateral fixo à direita, `max-w-md` (sm: `max-w-lg`), `h-full`.
- Animação slide-in (Tailwind `transition-transform`).
- Fecha ao clicar backdrop, no botão X, ou tecla Escape.
- `aria-modal="true"`, foca primeiro elemento ao abrir.

Conteúdo do drawer de produto:
- Header: nome + botão fechar.
- Carrossel simples (lista vertical) de `image_urls`. Sem upload.
- Bloco de infos: SKU, categoria, descrição completa, preço, compare_at_price (se != preço).
- Bloco de estoque: valor atual, MÍN. efetivo, badge de status.
- Bloco de variantes: lista de cores e tamanhos (chips Badge).

## Leva 2 — Mutations (preview)

Server actions em `src/actions/products.ts`. Todas validam ownership via `user_id` antes de mutar.

### `ProductFormDialog`

Campos:
- Nome * (text)
- SKU * (text)
- Descrição (textarea, 500 chars)
- Categoria (combobox: opções de `availableCategories` derivadas dos produtos atuais, com fallback de digitar novo)
- Preço * (number, 2 casas)
- Compare-at price (number, 2 casas)
- Stock quantity * (number, integer)
- Stock min (number, integer; 0 = usar default da loja)
- **Cores (ChipInput)** — reutiliza o componente que está em `src/app/loja/LojaForm.tsx`. Antes da leva 2, **extrair** `ChipInput` para `src/components/ui/ChipInput.tsx`.
- **Tamanhos (ChipInput)**
- Image URLs (lista editável, "adicionar URL")

Validação cliente: nome e SKU não vazios, preço > 0, stock_quantity ≥ 0, stock_min ≥ 0.

### Ações inline

- ⬆️⬇️: `adjustStock(id, +1)` / `adjustStock(id, -1)`. Floor em 0 (não permite negativo).
- ✏️: abre `ProductFormDialog` em modo edit.
- 🗑️: abre `DeleteConfirmDialog`; confirmando, chama `deleteProduct(id)`.

## Leva 3 — Polimento (preview)

- Aba "Estoque Detalhado" exibe `<EmptyState>` "Visualização por variante chegará em breve".
- Responsividade: KPIs em grid 2 colunas no mobile (em vez de 5).
- Ajustes finais conforme uso real.

## Bordas e edge cases

- **Produto sem imagem**: thumbnail mostra ícone genérico (`<IconChip tone="neutral">`).
- **Produto sem variantes**: célula da coluna VARIANTES mostra "—".
- **Categoria nula**: "—".
- **`stock_quantity` decrementado abaixo de 0**: clamp em 0 dentro de `adjustStock` (leva 2).
- **Default `stock_min` antes do usuário configurar**: 5 (do default da migration).
- **Importação de produtos pré-existentes**: `stock_min = 0` para todos após migration — usam default da loja automaticamente.
- **Performance com muitos produtos**: até ~500 produtos cliente-side é OK; acima disso vira tarefa futura.

## Testes

Existem testes hoje só em `src/lib/__tests__/n8n.test.ts`. Para esta entrega:

- **Leva 1**: testes unitários de `getEffectiveStockMin` e `getStockStatus` em `src/lib/__tests__/stock-status.test.ts`. Sem testes de componente (não há setup de testing-library no projeto).
- **Leva 2**: sem testes automatizados de server actions (ainda não há padrão de mock do supabase client no repo). Verificação manual pelos critérios listados no plano da leva.
- **Leva 3**: sem testes novos.

Verificação manual: dev server + checklist de cenários (filtros, drawer, mutations) descrito no plano de implementação de cada leva.

## Pré-existente

`src/app/api/inventory/import/route.ts:111` tem erro de TS (falta `user_id`) que falha `next build`. Esse erro é anterior a este projeto e não bloqueia `next dev`. Não é responsabilidade deste redesign corrigir; documentar no plano e seguir.

## Plano de levas (resumo)

| Leva | Entrega | Tarefas principais |
|---|---|---|
| **1** | Read-only redesign | Migration, helpers, server fetch, KpiSection, FilterBar, ProductTable+Row, Drawer primitive, ProductDetailsDrawer, ações 4 botões visíveis mas desabilitadas |
| **2** | Mutations | Extrair ChipInput, Dialog primitive, server actions products.ts, ProductFormDialog, DeleteConfirmDialog, ativar ações inline |
| **3** | Polimento | Aba Estoque Detalhado placeholder, responsivo, ajustes finais |

Cada leva vira PR separada. O plano de implementação detalhado começa pela Leva 1.
