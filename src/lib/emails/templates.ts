import { renderEmail } from './layout'

export interface EmailTemplate {
  subject: string
  /** Recebe a URL de ação (link de confirmação) e devolve o HTML completo. */
  render: (actionUrl: string) => string
}

export const confirmSignupTemplate: EmailTemplate = {
  subject: 'Confirme seu cadastro na LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Falta só um clique para ativar sua conta na LUE.',
      heading: 'Bem-vindo à LUE 👋',
      bodyHtml:
        '<p style="margin:0 0 12px;">Sua conta foi criada. Para começar a usar o painel, confirme seu e-mail no botão abaixo.</p>',
      ctaLabel: 'Confirmar meu e-mail',
      ctaUrl: actionUrl,
      footnote:
        'Se você não criou uma conta na LUE, pode ignorar este e-mail com segurança.',
    }),
}

export const resetPasswordTemplate: EmailTemplate = {
  subject: 'Redefina sua senha da LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Use o link para criar uma nova senha de acesso.',
      heading: 'Redefinir sua senha',
      bodyHtml:
        '<p style="margin:0 0 12px;">Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha. O link expira em pouco tempo.</p>',
      ctaLabel: 'Criar nova senha',
      ctaUrl: actionUrl,
      footnote:
        'Se você não pediu para redefinir a senha, ignore este e-mail — sua senha atual continua valendo.',
    }),
}

// Fallback para email_action_type que ainda não personalizamos (magiclink,
// invite, email_change). Garante que nenhum e-mail de auth fique sem envio.
export const genericAuthTemplate: EmailTemplate = {
  subject: 'Ação de segurança na sua conta LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Confirme esta ação na sua conta LUE.',
      heading: 'Confirme esta ação',
      bodyHtml:
        '<p style="margin:0 0 12px;">Para continuar, confirme esta ação na sua conta clicando no botão abaixo.</p>',
      ctaLabel: 'Confirmar',
      ctaUrl: actionUrl,
      footnote:
        'Se você não reconhece esta ação, ignore este e-mail.',
    }),
}
