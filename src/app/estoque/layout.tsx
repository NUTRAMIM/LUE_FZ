import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'

export default async function EstoqueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role, slug } = await getSidebarData()
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar role={role} slug={slug} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
