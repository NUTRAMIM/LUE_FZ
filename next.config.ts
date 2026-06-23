import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vídeos de produto vão até 20MB; FormData adiciona overhead
      bodySizeLimit: '25mb',
    },
  },
  // Headers de segurança globais. Conjunto conservador (zero-risco p/ um app
  // Next): SAMEORIGIN protege painel/loja de clickjacking. Fase 2 (widget
  // embarcável) agora ativa: a rota pública /chat é liberada para iframe de
  // qualquer site de lojista via CSP frame-ancestors — o jeito moderno e o
  // único que permite embedding cross-origin (X-Frame-Options só aceita
  // DENY/SAMEORIGIN). CSP completa segue de fora de propósito: precisa de nonce
  // e modo Report-Only primeiro pra não quebrar a hidratação do Next.
  async headers() {
    // Comuns a todas as rotas; não interferem em embedding de iframe.
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
    return [
      {
        // Tudo exceto /chat mantém o anti-clickjacking rígido. Regex negativo
        // no mesmo estilo do matcher do middleware: /chat fica de fora porque
        // X-Frame-Options não pode ser "removido" via override — só ausente.
        source: '/((?!chat/).*)',
        headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, ...baseHeaders],
      },
      {
        // Widget público embarcável: pode ser carregado em iframe por qualquer
        // domínio (escolha do produto). Sem X-Frame-Options aqui de propósito —
        // alguns browsers ainda o respeitam mesmo com CSP presente.
        source: '/chat/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
          ...baseHeaders,
        ],
      },
    ]
  },
};

export default nextConfig;
