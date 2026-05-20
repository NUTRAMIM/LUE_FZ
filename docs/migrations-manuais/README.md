# Migrations Manuais

Comandos SQL que **não** devem rodar via Supabase CLI porque usam
`CREATE INDEX CONCURRENTLY` (incompatível com transação) ou outras operações
que precisam controle manual (janela de baixa carga, monitoramento, etc.).

## Como aplicar

1. Abra **Supabase Dashboard > SQL Editor**.
2. Cole o conteúdo do arquivo `.sql` desejado.
3. Rode **um comando por vez** (não o arquivo inteiro). `CREATE INDEX CONCURRENTLY`
   precisa rodar fora de transação.
4. Verifique em **Database > Indexes** que o índice foi criado / removido.
5. Se um `CREATE INDEX CONCURRENTLY` falhar no meio, o Postgres deixa um
   índice em estado `INVALID`. Rode `DROP INDEX IF EXISTS <nome>` e tente
   de novo.

## Ordem de aplicação

1. `030_drop_redundant_index.sql` — drop de `idx_products_sku` (redundante com `UNIQUE(user_id, sku)`).

Quando F2.3 chegar, adicionar aqui:

- `029_perf_indexes.sql` — índices compostos pra queries do painel e listagens.

(A numeração reflete a ordem cronológica em que cada arquivo foi adicionado
ao plano, não a ordem de aplicação. Aplique na ordem desta seção.)
