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

Aplicar **nesta ordem** (criar índices novos **antes** de remover redundantes,
pra tabela nunca ficar com cobertura reduzida):

1. `029_perf_indexes.sql` — 5 índices compostos pra queries do painel e listagens
   (`conversations`, `messages`, `leads`). Cada `CREATE INDEX CONCURRENTLY` pode
   demorar minutos em tabelas grandes — rode **um por vez** e verifique em
   Database > Indexes antes de seguir pro próximo.
2. `030_drop_redundant_index.sql` — drop de `idx_products_sku` (redundante com
   `UNIQUE(user_id, sku)`).

(A numeração reflete a ordem cronológica em que cada arquivo foi adicionado
ao plano, não a ordem em si — aplique sempre na sequência desta seção.)
