'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface MemberRow {
  id: string
  userId: string
  fullName: string
  email: string
  role: 'owner' | 'agent'
}

// Devolve o id do dono (= store_id) se o chamador for dono; senão null.
async function ownerStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  // Vendedor tem role 'agent'. Dono tem 'owner' ou (se não configurou a loja
  // ainda) nenhuma linha — ausência conta como dono.
  if (data?.role === 'agent') return null
  return user.id
}

export async function listStoreMembers(): Promise<MemberRow[]> {
  const storeId = await ownerStoreId()
  if (!storeId) return []

  const admin = createAdminClient()
  const { data: members, error } = await admin
    .from('store_members')
    .select('id, user_id, full_name, role')
    .eq('store_id', storeId)
    .order('created_at', { ascending: true })
  if (error || !members) {
    console.error('listStoreMembers error', error)
    return []
  }

  const rows: MemberRow[] = await Promise.all(
    members.map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id)
      return {
        id: m.id,
        userId: m.user_id,
        fullName: m.full_name,
        email: u.user?.email ?? '',
        role: m.role === 'owner' ? 'owner' : 'agent',
      }
    }),
  )
  return rows
}

export async function createVendor(input: {
  fullName: string
  email: string
  password: string
}): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode adicionar vendedores.' }
  }

  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!fullName) return { ok: false, error: 'Informe o nome do vendedor.' }
  if (!email) return { ok: false, error: 'Informe o email do vendedor.' }
  if (input.password.length < 6) {
    return { ok: false, error: 'A senha deve ter ao menos 6 caracteres.' }
  }

  const admin = createAdminClient()
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    })
  if (createErr || !created.user) {
    return {
      ok: false,
      error: createErr?.message ?? 'Não foi possível criar a conta.',
    }
  }

  const { error: memberErr } = await admin.from('store_members').insert({
    store_id: storeId,
    user_id: created.user.id,
    role: 'agent',
    full_name: fullName,
  })
  if (memberErr) {
    // Desfaz o usuário órfão do Auth.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error('createVendor member insert error', memberErr)
    return { ok: false, error: 'Não foi possível vincular o vendedor à loja.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}

export async function removeVendor(
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode remover vendedores.' }
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('store_members')
    .select('user_id, store_id, role')
    .eq('id', memberId)
    .maybeSingle()
  if (!member || member.store_id !== storeId) {
    return { ok: false, error: 'Vendedor não encontrado.' }
  }
  if (member.role !== 'agent') {
    return { ok: false, error: 'Só é possível remover vendedores.' }
  }

  // Apagar o usuário do Auth cascateia o delete da linha store_members.
  const { error } = await admin.auth.admin.deleteUser(member.user_id)
  if (error) {
    console.error('removeVendor error', error)
    return { ok: false, error: 'Não foi possível remover o vendedor.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}
