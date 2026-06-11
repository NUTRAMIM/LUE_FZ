// Allowlist de super-admins da plataforma. Lida da env `PLATFORM_ADMIN_EMAILS`
// (e-mails separados por vírgula). Fail-closed: env ausente/vazia => ninguém é
// admin. Server-only — nunca exposto ao client.
export function isPlatformAdmin(user: { email?: string | null } | null): boolean {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false

  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  return allow.includes(email)
}
