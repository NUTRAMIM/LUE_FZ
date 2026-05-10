import { ChatUrlCard } from '@/components/loja/ChatUrlCard'
import { LojaForm } from './LojaForm'

export default async function LojaPage() {
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="mb-6 text-xl font-semibold text-gray-900">
        Configurações da Loja
      </h2>
      <ChatUrlCard />
      <LojaForm />
    </div>
  )
}
