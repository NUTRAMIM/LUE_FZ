import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'
import { ImpersonationBanner } from '@/components/ui/ImpersonationBanner'

export default async function LojaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const data = await getSidebarData()
  return (
    <>
      <ImpersonationBanner />
      <div className="flex flex-col md:flex-row md:min-h-screen">
        <Sidebar {...data} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </>
  )
}
