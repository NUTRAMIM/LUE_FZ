// Nome do cookie de impersonação. Em módulo próprio para que tanto
// `supabase/server.ts` quanto `active-store.ts` o importem sem criar ciclo.
export const IMPERSONATE_COOKIE = 'impersonate_store'
