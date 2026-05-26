'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthedUser } from '@/lib/auth'
import { getMaxAgentsForStore } from '@/lib/plan-limits'
import { getAppUrl } from '@/lib/app-url'

const INVITE_TTL_DAYS = 7

export interface MemberRow {
  id: string
  userId: string
  fullName: string
  email: string
  role: 'owner' | 'agent'
}

export interface InviteRow {
  id: string
  email: string
  fullName: string
  token: string
  url: string
  expiresAt: string
  createdAt: string
}

export interface EquipeData {
  members: MemberRow[]
  invites: InviteRow[]
  maxAgents: number
  agentCount: number
  pendingCount: number
}

async function ownerStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (data?.role === 'agent') return null
  return user.id
}

function inviteUrl(token: string): string {
  return `${getAppUrl()}/convite/${token}`
}

// Procura um user no auth.users pelo email. O JS SDK não tem filtro por
// email no listUsers, então paginamos até achar ou esgotar. Limite de 10
// páginas (1000 users) — suficiente pro estágio do projeto.
async function emailExistsInAuth(email: string): Promise<boolean> {
  const admin = createAdminClient()
  const lower = email.toLowerCase()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    })
    if (error || !data?.users) return false
    const hit = data.users.find((u) => u.email?.toLowerCase() === lower)
    if (hit) return true
    if (data.users.length < 100) return false
  }
  return false
}

export async function listEquipeData(): Promise<EquipeData> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return {
      members: [],
      invites: [],
      maxAgents: 0,
      agentCount: 0,
      pendingCount: 0,
    }
  }

  const admin = createAdminClient()

  const [membersRes, invitesRes, maxAgents] = await Promise.all([
    admin
      .from('store_members')
      .select('id, user_id, full_name, role')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true }),
    admin
      .from('store_invites')
      .select('id, email, full_name, token, expires_at, created_at')
      .eq('store_id', storeId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
    getMaxAgentsForStore(storeId),
  ])

  const members: MemberRow[] = membersRes.data
    ? await Promise.all(
        membersRes.data.map(async (m) => {
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
    : []

  const invites: InviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    fullName: i.full_name,
    token: i.token,
    url: inviteUrl(i.token),
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }))

  const agentCount = members.filter((m) => m.role === 'agent').length
  return {
    members,
    invites,
    maxAgents,
    agentCount,
    pendingCount: invites.length,
  }
}

export async function createInvite(input: {
  fullName: string
  email: string
}): Promise<{ ok: boolean; error?: string; url?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode convidar vendedores.' }
  }

  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!fullName) return { ok: false, error: 'Informe o nome do vendedor.' }
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Informe um email válido.' }
  }

  const maxAgents = await getMaxAgentsForStore(storeId)
  if (maxAgents <= 0) {
    return {
      ok: false,
      error: 'Ative seu plano pra adicionar vendedores.',
    }
  }

  const admin = createAdminClient()

  const [{ count: agentCount }, { count: pendingCount }] = await Promise.all([
    admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('role', 'agent'),
    admin
      .from('store_invites')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])
  if ((agentCount ?? 0) + (pendingCount ?? 0) >= maxAgents) {
    return {
      ok: false,
      error: `Limite de ${maxAgents} vendedores atingido nesse plano.`,
    }
  }

  if (await emailExistsInAuth(email)) {
    return { ok: false, error: 'Esse email já tem conta no LUE.' }
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const user = await getAuthedUser()
  if (!user) return { ok: false, error: 'Sessão expirada.' }

  const { error: insertErr } = await admin.from('store_invites').insert({
    store_id: storeId,
    email,
    full_name: fullName,
    token,
    invited_by: user.id,
    expires_at: expiresAt,
  })
  if (insertErr) {
    if (insertErr.code === '23505') {
      return {
        ok: false,
        error: 'Já existe um convite pendente pra esse email.',
      }
    }
    console.error('createInvite insert error', insertErr)
    return { ok: false, error: 'Não foi possível criar o convite.' }
  }

  revalidatePath('/equipe')
  return { ok: true, url: inviteUrl(token) }
}

export async function revokeInvite(
  inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode revogar convites.' }
  }

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('store_id')
    .eq('id', inviteId)
    .maybeSingle()
  if (!invite || invite.store_id !== storeId) {
    return { ok: false, error: 'Convite não encontrado.' }
  }

  const { error } = await admin.from('store_invites').delete().eq('id', inviteId)
  if (error) {
    console.error('revokeInvite error', error)
    return { ok: false, error: 'Não foi possível revogar o convite.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}

export async function acceptInvite(input: {
  token: string
  password: string
}): Promise<{ ok: boolean; error?: string; email?: string }> {
  if (!input.token) return { ok: false, error: 'Token inválido.' }
  if (input.password.length < 6) {
    return { ok: false, error: 'A senha precisa ter ao menos 6 caracteres.' }
  }

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('id, store_id, email, full_name, expires_at, accepted_at')
    .eq('token', input.token)
    .maybeSingle()
  if (!invite) {
    return { ok: false, error: 'Convite inválido.' }
  }
  if (invite.accepted_at) {
    return { ok: false, error: 'Esse convite já foi usado.' }
  }
  if (new Date(invite.expires_at) <= new Date()) {
    return { ok: false, error: 'Esse convite expirou.' }
  }

  if (await emailExistsInAuth(invite.email)) {
    return {
      ok: false,
      error: 'Esse email já foi cadastrado. Peça outro link pro dono.',
    }
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password: input.password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    console.error('acceptInvite createUser error', createErr)
    return { ok: false, error: 'Não foi possível criar a conta.' }
  }

  const { error: memberErr } = await admin.from('store_members').insert({
    store_id: invite.store_id,
    user_id: created.user.id,
    role: 'agent',
    full_name: invite.full_name,
  })
  if (memberErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    console.error('acceptInvite member insert error', memberErr)
    return { ok: false, error: 'Não foi possível vincular o vendedor à loja.' }
  }

  await admin
    .from('store_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  revalidatePath('/equipe')
  return { ok: true, email: invite.email }
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

  const { error } = await admin.auth.admin.deleteUser(member.user_id)
  if (error) {
    console.error('removeVendor error', error)
    return { ok: false, error: 'Não foi possível remover o vendedor.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}

// Backward-compat: a página /equipe ainda importa listStoreMembers e
// createVendor. Task 9 (refactor da EquipeView) substitui pela listEquipeData
// e createInvite; estes aliases mantêm o type-check passando durante o ciclo.
export async function listStoreMembers(): Promise<MemberRow[]> {
  return (await listEquipeData()).members
}

/** @deprecated Use createInvite. Removido na Task 9. */
export async function createVendor(_input: {
  fullName: string
  email: string
  password: string
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Use o fluxo de convite.' }
}
