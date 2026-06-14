import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // vídeos de produto vão até 20MB; FormData adiciona overhead
      bodySizeLimit: '25mb',
    },
  },
  // Headers de segurança globais. Conjunto conservador (zero-risco p/ um app
  // Next): SAMEORIGIN protege painel/loja de clickjacking sem quebrar nada hoje
  // (o widget embarcável é Fase 2 — quando existir, libera só a rota /chat via
  // frame-ancestors). CSP foi deixada de fora de propósito: precisa de nonce e
  // modo Report-Only primeiro pra não quebrar a hidratação do Next.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
};

export default nextConfig;
