-- 047_impersonation_rls_verify.sql  (rodar manualmente em dev/staging)
--
-- Pré-requisitos:
--   - Existe um admin em platform_admins (UUID_ADMIN).
--   - Existem duas lojas: A (própria do admin, se houver) e B (outra qualquer).
--   - Substituir <UUID_ADMIN>, <UUID_LOJA_B> e <UUID_NAO_ADMIN> pelos reais.
--
-- IMPORTANTE: o RLS resolve `auth.uid()` a partir de `request.jwt.claims`, NÃO
-- do header. E `set_config(..., true)` é transaction-scoped — por isso TUDO roda
-- dentro de uma única transação e como `authenticated` (sem isso, as queries
-- rodariam como owner e furariam o RLS, passando falsamente).

BEGIN;

-- 1) Sem header e sem claims: app_impersonated_store() deve ser NULL.
SELECT app_impersonated_store();  -- esperado: NULL

-- 2) Impersonar como ADMIN apontando para a loja B.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<UUID_ADMIN>', 'role', 'authenticated')::text, true);
SELECT set_config('request.headers',
  json_build_object('x-impersonate-store', '<UUID_LOJA_B>')::text, true);
SET LOCAL ROLE authenticated;

SELECT app_impersonated_store();  -- esperado: <UUID_LOJA_B>

-- 3) Isolamento: rodando como o admin impersonando B, as tabelas só devem
--    retornar linhas da loja B (o RLS filtra; estas queries não têm WHERE de loja).
SELECT count(*) FROM products      WHERE user_id  <> '<UUID_LOJA_B>';  -- esperado: 0
SELECT count(*) FROM leads         WHERE store_id <> '<UUID_LOJA_B>';  -- esperado: 0
SELECT count(*) FROM conversations WHERE store_id <> '<UUID_LOJA_B>';  -- esperado: 0

RESET ROLE;

-- 4) Paridade não-admin: mesmo header, mas claims de um usuário não-admin.
--    app_impersonated_store() deve ser NULL (header ignorado).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<UUID_NAO_ADMIN>', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

SELECT app_impersonated_store();  -- esperado: NULL

RESET ROLE;

-- Não persiste nada: é só verificação.
ROLLBACK;
