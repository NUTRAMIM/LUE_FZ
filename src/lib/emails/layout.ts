export interface EmailLayoutOptions {
  /** Texto curto exibido como preview na caixa de entrada (oculto no corpo). */
  preheader: string
  /** Título grande dentro do card. */
  heading: string
  /** HTML do corpo (parágrafos). Confiável — montado por nós, não input do usuário. */
  bodyHtml: string
  /** Texto do botão de ação. */
  ctaLabel: string
  /** URL do botão de ação. */
  ctaUrl: string
  /** Linha fina de rodapé (ex.: "se não foi você, ignore"). */
  footnote: string
}

// HTML table-based com estilos inline — padrão para máxima compatibilidade entre
// clientes de e-mail (Gmail, Outlook, Apple Mail).
export function renderEmail(o: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${o.heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#F5F3FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${o.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F3FF;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px -30px rgba(76,29,149,0.35);">
            <tr>
              <td style="background:linear-gradient(135deg,#7C3AED,#4C1D95);padding:28px 32px;">
                <span style="font-size:26px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">LUE</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0B1020;">${o.heading}</h1>
                <div style="font-size:15px;line-height:1.6;color:#4A4F66;">${o.bodyHtml}</div>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                  <tr>
                    <td style="border-radius:12px;background-color:#7C3AED;">
                      <a href="${o.ctaUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${o.ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#9095AC;">${o.footnote}</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9095AC;word-break:break-all;">Ou copie e cole este link no navegador:<br /><a href="${o.ctaUrl}" style="color:#7C3AED;">${o.ctaUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #EFF0F5;">
                <p style="margin:0;font-size:12px;color:#9095AC;">© 2026 LUE · Acesso seguro</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
