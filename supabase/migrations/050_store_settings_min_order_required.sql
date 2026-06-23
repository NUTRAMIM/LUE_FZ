-- 050_store_settings_min_order_required.sql
-- Atacado: quando ligado, o agente só fecha o pedido se o mínimo for atingido.
-- Default false preserva o comportamento atual (só avisa, pode fechar abaixo).
-- Idempotente: seguro re-rodar.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS min_order_required BOOLEAN NOT NULL DEFAULT false;
