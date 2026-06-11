# Termos de Uso + Privacidade — Aceite obrigatório pós-cadastro

**Data:** 2026-06-11
**Status:** Design aprovado, aguardando plano de implementação

## Objetivo

Criar uma página de **Termos de Uso + Política de Privacidade (LGPD)** que o **dono da loja (owner)** é obrigado a ler e aceitar logo após criar a conta, antes de usar o painel. O aceite precisa marcar explicitamente que o usuário **entende e concorda** com os termos (checkbox obrigatório), e deve ser registrado como prova de consentimento (versão + data/hora + IP).

## Contexto do sistema (por que esses termos)

LUE FZ é um SaaS de atendimento por IA para e-commerce. Quem cria a conta é o **lojista (owner)**, que ganha:

- Agente de IA respondendo no chat público (`/chat/[slug]`)
- Painel de operador com takeover humano
- Dashboard de estoque (import/export de produtos)
- **Leads**: capta nome, WhatsApp e email dos clientes finais (`leads` table) e guarda conversas
- Equipe (vendedores convidados)
- Cobrança por assinatura (Stripe + MercadoPago/PIX)

Isso define o conteúdo obrigatório dos termos (ver seção "Conteúdo do documento").

## Decisões já tomadas

| Decisão | Valor |
|---|---|
| Escopo do documento | Termos de Uso **+** Política de Privacidade/LGPD (um documento, em seções) |
| Quem precisa aceitar | **Apenas o owner**. Agents (vendedores) não passam pelo gate |
| Mecanismo de enforcement | Gate no middleware + página dedicada `/termos` (espelha o billing gate existente) |
| Registro do aceite | Tabela `terms_acceptances` (user_id, versão, data, IP, user agent) |
| Versionamento | Constante `TERMS_VERSION`; mudar a versão re-dispara o gate |
| Dados jurídicos | Inseridos pelo usuário; placeholders `[RAZÃO SOCIAL]`, `[CNPJ]`, `[CIDADE/UF]`, `[EMAIL]`, `[DPO]` até serem preenchidos |

## O que já existe (não mexer, reusar)

- `src/middleware.ts`: padrão de gate por rota já implementado (billing gate, hoje **desligado** — `BILLING_GATED = []`). Resolve `membership { store_id, role }` uma vez para owner/agent.
- Helper `getStoreRole(): 'owner' | 'agent'` em `src/lib/store-role.ts`
- `getAuthedUser()` em `src/lib/auth.ts`
- `store_members(store_id, user_id, role)` — fonte do role
- Clientes Supabase: `src/lib/supabase/server.ts` e `src/lib/supabase/client.ts`
- Componentes de UI existentes (`Button`, `Input`, etc.) e estilos Tailwind v4
- Migrations idempotentes numeradas; última é `042` → próxima é **`043`**

## O que muda

### 1. Schema — migration `043_terms_acceptances.sql`

```sql
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT,
  UNIQUE (user_id, terms_version)
);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

-- Usuário só enxerga e grava o próprio aceite.
CREATE POLICY "terms_acceptances_select_own" ON terms_acceptances
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "terms_acceptances_insert_own" ON terms_acceptances
  FOR INSERT WITH CHECK (auth.uid() = user_id);
```

Idempotente (`IF NOT EXISTS` + guards de policy no estilo da 042).

### 2. Versão e conteúdo dos termos

- `src/lib/terms.ts`: exporta `TERMS_VERSION = '2026-06-11'` e helper `hasAcceptedCurrentTerms(userId)`.
- Conteúdo do documento em `src/content/terms.tsx` (ou `.md`/MDX), acoplado à `TERMS_VERSION`. Separado da lógica para facilitar revisão jurídica.

### 3. Gate no middleware

Espelhando o billing gate. Após resolver `membership`:

```
TERMS_GATED = ['/painel', '/estoque', '/loja', '/conversas', '/equipe', '/leads', '/planos']
// /termos NÃO entra na lista (precisa abrir logado para aceitar)

if (user && needsTerms && membership?.role !== 'agent') {
  const accepted = await supabase
    .from('terms_acceptances')
    .select('id')
    .eq('user_id', user.id)
    .eq('terms_version', TERMS_VERSION)
    .maybeSingle()
  if (!accepted.data) redirect('/termos')
}
```

- `/termos` adicionada à lista `AUTH_PROTECTED` (precisa estar logado).
- Ordem: depois do auth check, antes/junto do billing (que está desligado).
- Agents nunca são gated (mesma razão do billing: a relação contratual é do owner).

### 4. Página `/termos`

`src/app/termos/page.tsx` (server component):

- Carrega `user` e checa `hasAcceptedCurrentTerms`.
- Se **não** aceitou → renderiza `<TermosAceite>` (client) com o documento + checkbox + botão.
- Se **já** aceitou (acesso para releitura) → renderiza o documento em modo leitura, sem formulário.

`src/components/termos/TermosAceite.tsx` (client):

- Documento renderizado em seções roláveis.
- Checkbox obrigatório: *"Li e concordo com os Termos de Uso e a Política de Privacidade."*
- Botão **Aceitar e continuar** desabilitado enquanto o checkbox não estiver marcado.
- Ao clicar → chama server action `acceptTerms()`.

### 5. Server action `acceptTerms()`

`src/actions/terms.ts`:

- Pega `user` autenticado, IP via header `x-forwarded-for` (fallback `x-real-ip`) e `user-agent`.
- `insert` em `terms_acceptances` com `TERMS_VERSION` (upsert/ignore em conflito de `UNIQUE`).
- `redirect('/painel')`.

### 6. Conteúdo do documento (15 seções + Privacidade/LGPD)

1. Identificação das partes — `[RAZÃO SOCIAL]`, `[CNPJ]`, definição de Plataforma/Usuário/Cliente final
2. Descrição do serviço — agente IA, painel/takeover, estoque, leads, equipe
3. Conta e acesso — credenciais, convites de equipe, elegibilidade (18+, capacidade civil)
4. Assinatura e pagamento — recorrência, Stripe/MercadoPago/PIX, renovação, cancelamento, reembolso, inadimplência → suspensão
5. **Uso da IA (isenção)** — respostas podem conter erros; lojista revisa via takeover; IA não garante vendas nem substitui aconselhamento profissional
6. Conteúdo do lojista / estoque — responsabilidade pela veracidade de produtos, preços, disponibilidade
7. **Proteção de dados / LGPD** — lojista é **Controlador** dos dados dos clientes finais (nome, WhatsApp, email, conversas); LUE é **Operadora**; bases legais e consentimento são responsabilidade do lojista; segurança, retenção, incidentes; contato do `[DPO]`
8. Uso aceitável — proibição de produtos ilícitos, spam, engenharia reversa, burla
9. Propriedade intelectual — plataforma é da LUE; dados/marca permanecem do lojista
10. Disponibilidade — sem garantia de 100% uptime; dependência de terceiros (Supabase, Vercel, provedores de IA)
11. Limitação de responsabilidade
12. Suspensão e encerramento — efeitos sobre os dados pós-cancelamento
13. Alterações nos termos — como notifica e quando exige novo aceite
14. Lei aplicável e foro — Brasil, comarca de `[CIDADE/UF]`
15. Registro do aceite — versão, data/hora e IP como prova de consentimento

> Documento é **modelo técnico/estrutural**, não aconselhamento jurídico. Deve ser revisado pelo jurídico antes de publicar — especialmente seções 7, 10 e 11.

### 7. Acesso posterior aos termos

- Link "Termos de Uso e Privacidade" no rodapé do painel (sidebar/footer) → `/termos` em modo leitura.
- Link na tela de `/login` (rodapé já tem "© 2026 LUE · Acesso seguro").

### 8. Re-aceite em mudança de versão

Bump de `TERMS_VERSION` → owners sem aceite da nova versão caem no gate novamente. Aceites antigos permanecem na tabela (histórico).

## Testes (Vitest)

- Middleware: owner sem aceite da versão atual → redirect `/termos`.
- Middleware: owner com aceite da versão atual → passa.
- Middleware: agent → nunca é gated por termos.
- Middleware: `/termos` acessível logado mesmo sem aceite (não entra em loop).
- `acceptTerms()`: grava registro com versão + IP; conflito de versão não duplica.

## Fora de escopo

- Aceite por agents/vendedores (decisão: só owner).
- Envio de email/PDF dos termos.
- Internacionalização (documento só em PT-BR).
- Geração automática do texto jurídico final (placeholders preenchidos manualmente).

## Pendências

- Dados jurídicos reais: `[RAZÃO SOCIAL]`, `[CNPJ]`, `[CIDADE/UF]`, `[EMAIL]` de contato, `[DPO]`, e se o nome comercial no texto é "LUE" ou "LUE FZ".
