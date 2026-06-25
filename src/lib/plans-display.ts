// Cópia de marketing dos planos pra exibição em /painel/planos (nome, público,
// features, CTA). Números e preços NÃO vivem aqui — a fonte única é lib/plans.ts
// (convsLimit, maxAgents, price_brl). Os cards leem preço/limite de PLANS e só
// puxam a copy daqui, casando pelo `id`.

export interface PlanDisplay {
  id: 'essencial' | 'profissional' | 'performance'
  name: string
  for: string
  intro?: string
  feats: string[]
  cta: string
  featured?: boolean
  badge?: string
}

export const PLANS_DISPLAY: PlanDisplay[] = [
  {
    id: 'essencial',
    name: 'Essencial',
    for: 'Pra lojas começando a automatizar o atendimento.',
    feats: [
      'Vendedor virtual com IA treinado no catálogo',
      'Captura automática de leads',
      'Painel de conversas em tempo real',
      '1 canal de atendimento (chat no site)',
      'Suporte por e-mail',
    ],
    cta: 'Plano atual',
  },
  {
    id: 'profissional',
    name: 'Profissional',
    for: 'Pra lojas com tráfego constante e fluxo diário de mensagens.',
    intro: 'Tudo do Essencial, e mais',
    feats: [
      'Análise automática de intenções e gaps',
      'Histórico completo de leads e conversas',
      'Métricas de desempenho da IA',
      'Suporte prioritário (chat)',
    ],
    cta: 'Fazer upgrade',
    featured: true,
    badge: 'Mais escolhido',
  },
  {
    id: 'performance',
    name: 'Performance',
    for: 'Pra operações em escala que dependem do atendimento automatizado.',
    intro: 'Tudo do Profissional, e mais',
    feats: [
      'Personalização avançada do tom de voz da IA',
      'Integrações WhatsApp / Instagram DM',
      'Onboarding guiado com o time LUE',
      'Suporte dedicado',
    ],
    cta: 'Falar com vendas',
  },
]

export interface CompareRow {
  feat: string
  sub: string
  vals: (boolean | string)[]
}

export const COMPARE_ROWS: CompareRow[] = [
  { feat: 'Vendedor virtual com IA',         sub: 'Treinado no catálogo',              vals: [true, true, true] },
  { feat: 'Captura de leads',                sub: 'Nome, WhatsApp, e-mail',            vals: [true, true, true] },
  { feat: 'Painel de conversas',             sub: 'Em tempo real',                     vals: [true, true, true] },
  { feat: 'Análise de intenções e gaps',     sub: 'Veja o que falta no catálogo',      vals: [false, true, true] },
  { feat: 'Métricas de desempenho',          sub: 'Conversão, intenção, recorrência',  vals: [false, true, true] },
  { feat: 'Personalização avançada de tom',  sub: 'Tom de voz sob medida',             vals: [false, false, true] },
  { feat: 'Integração WhatsApp / Instagram', sub: 'Outros canais',                     vals: [false, false, true] },
  { feat: 'Onboarding guiado',               sub: 'Com o time LUE',                    vals: [false, false, true] },
  { feat: 'Suporte',                         sub: 'Canal de atendimento',              vals: ['E-mail', 'Chat prioritário', 'Dedicado'] },
]

export interface FAQItem {
  q: string
  a: string
}

export const FAQS: FAQItem[] = [
  {
    q: 'O que conta como uma conversa?',
    a: 'Conversa é cada novo atendimento iniciado por um cliente no mês. Várias mensagens trocadas dentro do mesmo atendimento contam como 1 conversa. Atendimentos que começaram em meses anteriores e continuam não consomem a cota do mês atual.',
  },
  {
    q: 'E se eu passar do limite no mês?',
    a: 'Ao atingir o limite de conversas do mês, a IA deixa de iniciar novos atendimentos automáticos até o próximo ciclo ou um upgrade — mas as conversas já em andamento continuam, e as mensagens dos clientes seguem sendo salvas (a captura de leads não para, nada se perde).',
  },
  {
    q: 'Tem fidelidade ou multa pra cancelar?',
    a: 'Não. Você pode cancelar quando quiser direto por essa página. O acesso continua até o fim do período já pago.',
  },
]
