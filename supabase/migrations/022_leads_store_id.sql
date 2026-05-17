-- Add store_id to leads table
ALTER TABLE leads ADD COLUMN store_id UUID;

-- Create index for store_id queries
CREATE INDEX idx_leads_store_id ON leads (store_id);
