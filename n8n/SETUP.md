# n8n Workflow Setup

## Importar o Workflow

1. No n8n, vá em **Workflows → Import from file**
2. Selecione `workflow-chat-agent.json`

## Credenciais Necessárias

### 1. Anthropic (Claude API)
- Vá em **Credentials → Add Credential → Anthropic**
- Cole sua API key da Anthropic
- Associe aos nodes "Claude Chat" e "Claude Lead"

### 2. HTTP Header Auth (Supabase)
- Vá em **Credentials → Add Credential → Header Auth**
- Name: `Supabase Service Role`
- Header Name: `Authorization`
- Header Value: `Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY`
- Associe a todos os nodes HTTP Request

### 3. Variáveis de Ambiente
No n8n, configure a variável de ambiente:
- `SUPABASE_SERVICE_ROLE_KEY` = sua service role key do Supabase

## Testar

1. Ative o workflow
2. Copie a URL do webhook (ex: `https://seu-n8n.com/webhook/chat-agent`)
3. No projeto Next.js, configure no `.env.local`:
   ```
   N8N_WEBHOOK_URL=https://seu-n8n.com/webhook/chat-agent
   ```
4. Teste enviando um POST para o webhook:
   ```bash
   curl -X POST https://seu-n8n.com/webhook/chat-agent \
     -H "Content-Type: application/json" \
     -d '{"conversation_id":"test","message_id":"test","content":"tem camiseta?","visitor_id":"test"}'
   ```

## Fluxo

```
Webhook → Edit Fields ─┬─→ Get Conversation → IF ai_active? → Get History → Chat Agent (Claude + Search Products) → Save Message
                        └─→ Lead Analyzer (Claude) → IF Has Lead? → Save Lead
```

- **Branch 1 (Chat)**: Verifica se a conversa está em modo IA, busca histórico, responde com Claude usando tool de busca de produtos, salva resposta no Supabase
- **Branch 2 (Lead)**: Analisa cada mensagem buscando WhatsApp/nome, salva na tabela leads se encontrar
