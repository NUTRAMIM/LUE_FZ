-- F2.3 — Indices compostos para performance de queries de listagem
-- APLICAR MANUALMENTE no Supabase Dashboard > SQL Editor.
-- Em janela de baixa carga (madrugada / fim de semana cedo).
-- CONCURRENTLY nao bloqueia writes mas pode demorar minutos em tabelas grandes.
-- Rode UM comando por vez, verifique no Dashboard > Database > Indexes apos cada um.
--
-- Mapeamento dos indices vs queries (referencia PLANO_PERFORMANCE.md secao 2.3):
--   I1, I2, I4, I8 -> idx_conversations_store_status_lastmsg
--   I3            -> idx_conversations_store_created
--   I7            -> idx_messages_store_conv_created
--   I5            -> idx_leads_store_created
--   I6            -> idx_leads_store_created_whatsapp

-- I1, I2, I4, I8: queries do painel filtrando store_id + status, ordenando por last_message_at
--   - getPainelPulse counts (ai_active + assigned_to/lead_id filters)
--   - getFunnel vendor stage (status='human_active' + updated_at)
--   - RPC list_conversations_for_store ORDER BY last_message_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_store_status_lastmsg
  ON conversations (store_id, status, last_message_at DESC);

-- I3: "sessions today" e activity feed -- store_id + created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_store_created
  ON conversations (store_id, created_at);

-- I7: CTE last_msg do RPC list_conversations_for_store
--   DISTINCT ON (m.conversation_id) ORDER BY m.conversation_id, m.created_at DESC
--   WHERE m.store_id = $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_store_conv_created
  ON messages (store_id, conversation_id, created_at DESC);

-- I5: getLeads ordenacao por created_at (RLS filtra store_id implicitamente)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_store_created
  ON leads (store_id, created_at DESC);

-- I6: leads do funnel com filtro whatsapp NOT NULL (parcial)
--   getFunnel stage "leadCaptured": store_id + whatsapp IS NOT NULL + created_at >= $start
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_store_created_whatsapp
  ON leads (store_id, created_at) WHERE whatsapp IS NOT NULL;
