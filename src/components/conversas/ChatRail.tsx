'use client'

import { Icon } from '@/components/painel/Icons'
import type { ConversationRow } from '@/actions/conversas'
import {
  avatarColor,
  avatarInitials,
  formatRelativeTime,
  previewPrefix,
} from './formatters'

interface ChatRailProps {
  active: ConversationRow[]
  closed: ConversationRow[]
  closedExpanded: boolean
  onToggleClosed: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  query: string
  onQueryChange: (q: string) => void
}

function matchesQuery(c: ConversationRow, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    c.visitor_name.toLowerCase().includes(needle) ||
    (c.last_message_preview ?? '').toLowerCase().includes(needle)
  )
}

function ConversationTile({
  c,
  selected,
  onSelect,
}: {
  c: ConversationRow
  selected: boolean
  onSelect: (id: string) => void
}) {
  const lastText =
    previewPrefix(c.last_message_role) + (c.last_message_preview ?? '')
  const time = formatRelativeTime(c.last_message_at)
  const initials = avatarInitials(c.visitor_name)
  const bg = avatarColor(c.visitor_id)
  const unread = c.unread_count > 0

  return (
    <button
      onClick={() => onSelect(c.id)}
      className={`w-full text-left relative px-3 py-2.5 flex gap-2.5 transition-colors ${
        selected ? 'bg-brand-50' : 'hover:bg-ink-50'
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-600" />
      )}
      <div className="relative shrink-0">
        <div
          className="w-10 h-10 rounded-full font-display font-bold text-white text-[12px] flex items-center justify-center"
          style={{ background: bg }}
        >
          {initials}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`text-[13px] truncate ${
              selected ? 'font-bold text-brand-900' : 'font-semibold text-ink-900'
            } ${unread ? 'font-bold' : ''}`}
          >
            {c.visitor_name}
          </div>
          <span
            className={`text-[10.5px] tabular shrink-0 ${
              unread && !selected ? 'text-brand-700 font-bold' : 'text-ink-500'
            }`}
          >
            {time}
          </span>
        </div>
        <div
          className={`text-[11.5px] truncate mt-0.5 ${
            unread && !selected ? 'text-ink-800 font-semibold' : 'text-ink-500'
          }`}
        >
          {lastText || ' '}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-600">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#7C3AED' }}
            />
            SITE
          </span>
          {unread && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold tabular bg-brand-600 text-white">
              {c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ChatRail({
  active,
  closed,
  closedExpanded,
  onToggleClosed,
  selectedId,
  onSelect,
  query,
  onQueryChange,
}: ChatRailProps) {
  const activeFiltered = active.filter((c) => matchesQuery(c, query))
  const closedFiltered = closed.filter((c) => matchesQuery(c, query))

  return (
    <div className="card flex flex-col h-[calc(100dvh-180px)] md:h-[calc(100vh-138px)]">
      <div className="px-3.5 pt-3.5 pb-2 border-b border-ink-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-ink-900 text-[15px]">
            Caixa de entrada
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[11px] font-bold tabular bg-ink-100 text-ink-700">
            {active.length + closed.length}
          </span>
        </div>
      </div>

      <div className="px-3.5 py-2.5 border-b border-ink-100">
        <div className="relative">
          <Icon
            name="search"
            className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar conversas…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-ink-50 text-[12.5px] placeholder:text-ink-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
          <div className="px-3.5 pt-3.5 pb-1.5 flex items-center justify-between">
            <span className="eyebrow text-ink-500">ATIVAS</span>
            <span className="eyebrow text-ink-400 tabular">
              {activeFiltered.length}
            </span>
          </div>
          {activeFiltered.length === 0 ? (
            <div className="px-3.5 py-6 text-[12px] text-ink-500">
              {active.length === 0
                ? 'Nenhuma conversa ainda. Quando alguém chamar pelo chat público, ela aparece aqui.'
                : 'Nada bate com a busca.'}
            </div>
          ) : (
            <div className="divide-y divide-ink-100/70">
              {activeFiltered.map((c) => (
                <ConversationTile
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-1 border-t border-ink-100">
          <button
            onClick={onToggleClosed}
            className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-ink-50"
          >
            <span className="eyebrow text-ink-500">ENCERRADAS</span>
            <span className="eyebrow text-ink-400 tabular flex items-center gap-1">
              {closed.length > 0 && closedExpanded ? closedFiltered.length : ''}
              <Icon
                name="chev"
                className={`w-3 h-3 transition-transform ${
                  closedExpanded ? 'rotate-180' : ''
                }`}
              />
            </span>
          </button>
          {closedExpanded && (
            <div className="divide-y divide-ink-100/70">
              {closedFiltered.map((c) => (
                <ConversationTile
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
              {closedFiltered.length === 0 && (
                <div className="px-3.5 py-4 text-[12px] text-ink-500">
                  Nenhuma conversa encerrada.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
