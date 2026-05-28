// Um convite está "vivo e pendente" quando ainda não foi aceito e não expirou.
// Convites aceitos ou expirados são resíduos: não devem bloquear um reconvite
// pro mesmo email (o UNIQUE(store_id, email) em store_invites os removeria).
export function isLivePendingInvite(
  invite: { accepted_at: string | null; expires_at: string } | null,
  now: Date = new Date(),
): boolean {
  if (!invite || invite.accepted_at) return false
  return new Date(invite.expires_at).getTime() > now.getTime()
}
