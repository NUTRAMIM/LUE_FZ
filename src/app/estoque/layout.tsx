import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'
import { ImpersonationBanner } from '@/components/ui/ImpersonationBanner'

export default async function EstoqueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const data = await getSidebarData()
  return (
    <>
      <ImpersonationBanner />
      <div className="flex flex-col md:flex-row md:h-screen bg-gray-100">
        <Sidebar {...data} />
        <main className="flex-1 md:overflow-auto">
          {children}
        </main>
      </div>
    </>
  )
}
