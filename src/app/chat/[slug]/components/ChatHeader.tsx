export function ChatHeader({ storeName }: { storeName: string }) {
  const initials = storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white shadow">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
        {initials}
      </div>
      <div className="flex flex-col">
        <span className="text-base font-medium leading-tight">{storeName}</span>
        <span className="text-xs leading-tight text-white/80">online</span>
      </div>
    </header>
  )
}
