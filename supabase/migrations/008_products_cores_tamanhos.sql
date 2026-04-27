-- Colunas separadas para cores e tamanhos
ALTER TABLE products ADD COLUMN cores TEXT[] DEFAULT '{}';
ALTER TABLE products ADD COLUMN tamanhos TEXT[] DEFAULT '{}';
