import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'

export default async function EstoqueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role, slug, appUrl } = await getSidebarData()
  return (
    <div className="flex flex-col md:flex-row md:h-screen bg-gray-100">
      <Sidebar role={role} slug={slug} appUrl={appUrl} />
      <main className="flex-1 md:overflow-auto">
        {children}
      </main>
    </div>
  )
}
