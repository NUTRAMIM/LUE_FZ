import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
  type EmailTemplate,
} from './templates'

/** Campos do `email_data` do payload do Send Email Hook que usamos. */
export interface HookEmailData {
  token_hash: string
  email_action_type: string
  site_url: string
}

/** Para onde `/auth/confirm` redireciona após verificar o token. */
export function nextFor(actionType: string): string {
  if (actionType === 'recovery') return '/reset-password'
  return '/painel'
}

/** Escolhe o template pelo tipo de ação; desconhecido cai no genérico. */
export function pickTemplate(actionType: string): EmailTemplate {
  switch (actionType) {
    case 'signup':
      return confirmSignupTemplate
    case 'recovery':
      return resetPasswordTemplate
    default:
      return genericAuthTemplate
  }
}

/** Monta o link de ação que vai no e-mail, apontando para /auth/confirm. */
export function buildActionUrl(data: HookEmailData): string {
  const params = new URLSearchParams({
    token_hash: data.token_hash,
    type: data.email_action_type,
    next: nextFor(data.email_action_type),
  })
  return `${data.site_url}/auth/confirm?${params.toString()}`
}
