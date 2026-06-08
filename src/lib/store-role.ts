import { getStoreContext } from '@/lib/active-store'

export type StoreRole = 'owner' | 'agent'

// Resolve o papel do usuário atual na loja. Um vendedor sempre tem uma linha
// em store_members (role 'agent'); um dono também tem (criada pelo trigger em
// store_settings) — mas um dono que ainda não configurou a loja não tem linha,
// então a ausência é tratada como 'owner'. Delega ao `getStoreContext`
// cacheado, compartilhando a query de store_members com o resto do render.
export async function getStoreRole(): Promise<StoreRole> {
  const ctx = await getStoreContext()
  // Sem usuário, devolve 'owner' só como fallback — nunca é usado como gate.
  return ctx?.role ?? 'owner'
}
