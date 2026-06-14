-- 045_documents_rls.sql
-- A tabela `documents` (criada na 015, RAG vetorial do catálogo) nunca teve RLS
-- habilitado. Como ela é legível pela anon key (pública no front via
-- NEXT_PUBLIC_SUPABASE_ANON_KEY), qualquer cliente podia `SELECT * FROM documents`
-- e ler o catálogo indexado de TODAS as lojas (nome, descrição, image_urls,
-- video_url e user_id no metadata) — vazamento cross-tenant.
--
-- Esta migration é ADITIVA e NÃO-DESTRUTIVA:
--   - Habilitar RLS faz o default virar "deny" para roles que NÃO bypassam RLS
--     (anon, authenticated). Adiciona-se uma policy de SELECT por membership para
--     que o painel autenticado continue podendo ler o catálogo da própria loja.
--   - NÃO quebra os caminhos legítimos:
--       * n8n indexa via Supabase Vector Store (service_role) -> bypassa RLS.
--       * chat-service lê via asyncpg com a role `postgres` (DATABASE_URL) ->
--         bypassa RLS. `match_documents` é SECURITY INVOKER, mas como seus únicos
--         chamadores são essas duas roles (que ignoram RLS), continua retornando
--         linhas normalmente. Por isso NÃO é preciso torná-la SECURITY DEFINER.
--   - Não se cria policy de INSERT/UPDATE/DELETE: a escrita continua só via
--     service_role/postgres (que bypassam RLS), preservando a indexação.
--
-- Convenção: `documents.metadata->>'user_id'` guarda o store_id (= user.id do
-- dono), mesma chave usada como `filter` em match_documents.

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_member" ON documents FOR SELECT
  USING (
    (metadata->>'user_id')::uuid IN (
      SELECT store_id FROM store_members WHERE user_id = auth.uid()
    )
  );
