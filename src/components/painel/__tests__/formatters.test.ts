import { describe, it, expect } from 'vitest'
import {
  rangeStart,
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
  formatPercent1,
  formatIntBr,
  dropOffPct,
  captureRatePct,
} from '../formatters'

// 2026-05-15T18:30:00Z = sexta-feira 15:30 em São Paulo (UTC-3).
const FRI = new Date('2026-05-15T18:30:00Z')
// 2026-05-15T02:00:00Z = quinta-feira 23:00 em São Paulo (dia anterior).
const LATE = new Date('2026-05-15T02:00:00Z')

describe('rangeStart', () => {
  it('day: início do dia em SP convertido para UTC (03:00Z)', () => {
    expect(rangeStart(FRI, 'day').toISOString()).toBe('2026-05-15T03:00:00.000Z')
  })

  it('day: respeita o fuso — 02:00Z ainda é o dia anterior em SP', () => {
    expect(rangeStart(LATE, 'day').toISOString()).toBe('2026-05-14T03:00:00.000Z')
  })

  it('week: volta para a segunda-feira da semana', () => {
    expect(rangeStart(FRI, 'week').toISOString()).toBe('2026-05-11T03:00:00.000Z')
  })

  it('month: primeiro dia do mês em SP', () => {
    expect(rangeStart(FRI, 'month').toISOString()).toBe('2026-05-01T03:00:00.000Z')
  })
})

describe('formatPainelDate', () => {
  it('formata como "sexta, 15 mai"', () => {
    expect(formatPainelDate(FRI)).toBe('sexta, 15 mai')
  })
})

describe('formatPainelClock', () => {
  it('formata o horário de SP como HH:MM', () => {
    expect(formatPainelClock(FRI)).toBe('15:30')
  })
})

describe('painelGreeting', () => {
  it('tarde entre 12h e 18h', () => {
    expect(painelGreeting(FRI)).toBe('BOA TARDE')
  })

  it('noite a partir das 18h', () => {
    expect(painelGreeting(new Date('2026-05-15T23:00:00Z'))).toBe('BOA NOITE')
  })

  it('manhã antes do meio-dia', () => {
    expect(painelGreeting(new Date('2026-05-15T13:00:00Z'))).toBe('BOM DIA')
  })
})

describe('formatPercent1', () => {
  it('uma casa decimal com vírgula', () => {
    expect(formatPercent1(15.08)).toBe('15,1%')
  })
})

describe('formatIntBr', () => {
  it('separador de milhar pt-BR', () => {
    expect(formatIntBr(1284)).toBe('1.284')
  })
})

describe('dropOffPct', () => {
  it('queda percentual entre etapas', () => {
    expect(dropOffPct(1284, 312)).toBeCloseTo(75.7, 1)
  })

  it('retorna 0 quando a etapa anterior é 0', () => {
    expect(dropOffPct(0, 0)).toBe(0)
  })
})

describe('captureRatePct', () => {
  it('leads sobre sessões em porcentagem', () => {
    expect(captureRatePct(47, 312)).toBeCloseTo(15.06, 2)
  })

  it('retorna 0 quando não há sessões', () => {
    expect(captureRatePct(5, 0)).toBe(0)
  })
})
