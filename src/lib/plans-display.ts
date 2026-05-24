// Dados estáticos dos planos pra exibição em /painel/planos.
// Não toca em lib/plans.ts (que segue como source-of-truth do checkout
// atual, com plano 'pro' de teste). Quando os planos forem reais, ligar
// id → price/checkout neste arquivo.

export interface PlanDisplay {
  id: 'essencial' | 'profissional' | 'performance'
  name: string
  for: string
  msgs: string
  msgsLimit: number
  priceMonthly: number
  priceAnnual: number
  cpm: string
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
    msgs: '1.000',
    msgsLimit: 1000,
    priceMonthly: 97,
    priceAnnual: 81,
    cpm: '~R$ 0,09 / mensagem',
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
    msgs: '5.000',
    msgsLimit: 5000,
    priceMonthly: 247,
    priceAnnual: 207,
    cpm: '~R$ 0,049 / mensagem',
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
    msgs: '20.000',
    msgsLimit: 20000,
    priceMonthly: 597,
    priceAnnual: 497,
    cpm: '~R$ 0,029 / mensagem',
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
    q: 'O que conta como uma mensagem?',
    a: 'Mensagem é cada resposta que a IA envia para o seu cliente. Mensagens recebidas do cliente não contam. Por exemplo: cliente pergunta "vocês têm vestido azul?" e a IA responde mostrando 3 opções — isso conta como 1 mensagem usada.',
  },
  {
    q: 'E se eu passar do limite no mês?',
    a: 'Você é avisado antes de atingir o limite. Pode subir de plano na hora ou adicionar um pacote extra sem interromper o atendimento. A captura de leads continua funcionando mesmo se o limite acabar — nada se perde.',
  },
  {
    q: 'Tem fidelidade ou multa pra cancelar?',
    a: 'Não. Você pode cancelar quando quiser direto por essa página. O acesso continua até o fim do período já pago.',
  },
]
