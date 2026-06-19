-- 047_impersonation_rls_verify.sql  (rodar manualmente em dev/staging)
-- Pré: existe um admin em platform_admins e duas lojas A (sua) e B (outra).
-- Substituir os UUIDs e o JWT/role conforme o ambiente.
--
-- 1) Sem header: app_impersonated_store() deve ser NULL.
SELECT app_impersonated_store();  -- esperado: NULL
--
-- 2) Simular header de admin para a loja B:
SELECT set_config('request.headers',
  json_build_object('x-impersonate-store', '<UUID_LOJA_B>')::text, true);
-- e simular auth.uid() = <UUID_ADMIN> conforme o harness do ambiente.
SELECT app_impersonated_store();  -- esperado: <UUID_LOJA_B> (se o uid for admin)
--
-- 3) Conferência de isolamento (rodando como o admin impersonando B):
--    products/leads/conversations devem retornar SÓ a loja B.
SELECT count(*) FROM products WHERE user_id <> '<UUID_LOJA_B>';   -- esperado: 0
SELECT count(*) FROM leads    WHERE store_id <> '<UUID_LOJA_B>';  -- esperado: 0
--
-- 4) Paridade não-admin: com um uid não-admin e o mesmo header,
--    app_impersonated_store() deve ser NULL e as queries só verem a própria loja.
