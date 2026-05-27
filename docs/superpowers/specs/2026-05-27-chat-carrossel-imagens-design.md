# Chat público: carrossel arrastável para múltiplas imagens

**Data:** 2026-05-27
**Escopo:** chat público da loja (`/chat/[slug]`)

## Problema

Quando o agente n8n responde mostrando vários produtos, a resposta vem como uma única string em `messages.content` com várias URLs de imagem misturadas no texto. O `MessageBubble` atual detecta essas URLs por regex e empilha cada imagem verticalmente, ocupando muito espaço vertical e prejudicando a navegação visual entre produtos.

Queremos que múltiplas imagens consecutivas dentro de uma mesma bolha sejam exibidas como carrossel arrastável horizontalmente.

## Contexto do fluxo de dados

1. Cliente envia mensagem pelo chat público.
2. `src/actions/chat.ts` insere row `role=user` em `messages` e despacha para o webhook do n8n.
3. Workflow atual do n8n (sem splitter) responde `{ output: "<resposta completa>" }`.
4. `src/actions/chat.ts:211` insere **uma única** row `role=assistant`, `message_type='text'`, `content=output`.
5. `MessageBubble.tsx` chama `parseSegments(content)`, que detecta URLs de imagem por regex (`jpe?g|png|webp|gif`) e devolve `Segment[]` alternando texto e imagem. Hoje cada imagem é renderizada como `<img>` solto, empilhado.

Conclusão: todo o trabalho fica no componente de renderização da bolha. Não há mudança no schema do banco, no action do servidor ou no workflow do n8n.

## Mudanças observáveis pro usuário final

- **Múltiplas imagens consecutivas:** antes empilhadas verticalmente, agora carrossel arrastável.
- **Tocar/clicar numa imagem:** antes abria em nova aba do navegador, agora abre lightbox dentro do chat. Vale tanto para imagens vindas do agente (URLs no `content`) quanto para imagem isolada — para manter o gesto consistente. Mensagens do tipo `message_type='image'` (mídia enviada pelo cliente/operador) continuam abrindo em nova aba como hoje.

## Decisões de design

| Pergunta | Decisão |
|---|---|
| Como agrupar imagens? | Imagens **consecutivas** viram um carrossel. Imagens isoladas (com texto entre elas) continuam sendo `<img>` solo. |
| Tocar/clicar numa imagem | Abre lightbox dentro do chat (overlay fullscreen). Vale tanto para imagem do carrossel quanto para imagem isolada (consistência). |
| Indicadores | Bullets clicáveis embaixo do carrossel, estilo Instagram. |
| Navegação desktop | Setas `‹ ›` aparecem nas laterais ao passar o mouse sobre o carrossel. Bullets também são clicáveis. |
| Navegação mobile | Drag/swipe nativo + bullets clicáveis. |
| Biblioteca | `embla-carousel-react` (~7kb gzip, headless, sem CSS imposto). |

## Arquitetura

Três arquivos em `src/app/chat/[slug]/components/`:

```
MessageBubble.tsx       ALTERA   detecta grupos e delega pro carrossel
ImageCarousel.tsx       NOVO     embla + bullets + setas (hover desktop)
ImageLightbox.tsx       NOVO     overlay fullscreen com navegação
```

## Componente `MessageBubble.tsx` (alteração)

O `MessageBubble` hoje é um function component puro (sem estado). Passa a usar `useState` para controlar o lightbox aberto. Como `MessageBubble` é filho da árvore `ChatClient` (que já é `'use client'`), nenhum diretivo extra é necessário.

`parseSegments` continua existindo e funcionando como hoje. Adiciona um passo de **pós-processamento** que colapsa segments `image` consecutivos em `imageGroup`:

```ts
type RenderItem =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }           // imagem solitária
  | { type: 'imageGroup'; srcs: string[] }   // 2+ consecutivas

function groupConsecutiveImages(segments: Segment[]): RenderItem[]
```

Regra: dois ou mais `image` em sequência colapsam em `imageGroup`. Um único `image` rodeado de texto permanece `image`.

Estado local da bolha controla o lightbox aberto:

```ts
const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)
```

- Click numa imagem isolada → `setLightbox({ srcs: [src], index: 0 })`
- Click numa imagem do carrossel → `setLightbox({ srcs: group.srcs, index: currentSlide })`
- Render do lightbox condicional: `{lightbox && <ImageLightbox ... onClose={() => setLightbox(null)} />}`

## Componente `ImageCarousel.tsx` (novo)

```ts
interface ImageCarouselProps {
  srcs: string[]
  onImageClick: (index: number) => void
}
```

- `useEmblaCarousel({ align: 'start', containScroll: 'trimSnaps' })` — sem loop, snap nas extremidades.
- Container: `<div className="overflow-hidden group" ref={emblaRef}>` (o `group` habilita as setas aparecerem no hover).
- Cada slide: `<div className="flex-[0_0_100%]">` com `<img className="max-h-80 w-full object-cover rounded">`.
- Bullets embaixo: ordenados via `emblaApi.scrollSnapList()`, ativo via `emblaApi.selectedScrollSnap()`. Click chama `emblaApi.scrollTo(i)`.
- Setas: dois `<button>` absolutos, `opacity-0 group-hover:opacity-100 transition`. Em mobile (sem hover) ficam invisíveis. Click chama `scrollPrev`/`scrollNext`.
- `aria-label` em cada botão e bullet ("Imagem anterior", "Próxima imagem", "Ir para imagem N").
- `loading="lazy"` em todas as `<img>`.

## Componente `ImageLightbox.tsx` (novo)

```ts
interface ImageLightboxProps {
  srcs: string[]
  startIndex: number
  onClose: () => void
}
```

- Usa `createPortal` para `document.body` (escapa do `overflow-hidden` do chat).
- Fundo: `<div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>`.
- Imagem central: `<img className="max-h-screen max-w-screen object-contain" onClick={e => e.stopPropagation()}>`.
- Botão X canto superior direito, fora da imagem.
- Listener `keydown` global: `Escape` fecha; `ArrowLeft`/`ArrowRight` navegam (apenas se `srcs.length > 1`).
- Trava o scroll do body enquanto montado: `document.body.style.overflow = 'hidden'` no mount, restaura no unmount.
- Quando `srcs.length > 1`, usa um segundo Embla interno com `startIndex` para navegação.
- Quando `srcs.length === 1`, renderiza só a imagem (sem Embla, sem bullets, sem setas).

## Edge cases

| Caso | Comportamento |
|---|---|
| 0 imagens no content | Renderiza só texto (igual hoje) |
| 1 imagem isolada | `<img>` solo + click abre lightbox de 1 slide |
| 2+ consecutivas | Carrossel + click abre lightbox no slide certo |
| `[texto, img, texto, img]` | Duas imagens isoladas (não há "consecutivas") |
| `message_type='image'` (mídia do user/operador via `media_url`) | **Fora de escopo**. Continua renderizando como hoje, sem lightbox. |
| Largura da bolha | Mantém `max-w-[88%] sm:max-w-sm` quando `hasImage` (já existe) |
| Mensagens longas com texto + carrossel | Texto acima/abaixo flui normalmente; carrossel ocupa largura da bolha |

## Não-objetivos (YAGNI)

- Autoplay
- Loop infinito
- Pinch/zoom dentro do lightbox (browser faz pinch nativo se quiser)
- Acessibilidade WAI-ARIA completa de "carousel pattern" (só `aria-label` nos botões; sem `role=region` + `aria-roledescription="carousel"` + live region)
- Suporte a vídeos
- Animações além do snap nativo do Embla
- Mudar fluxo do n8n para entregar imagens estruturadas (array dedicado) em vez de strings

## Testes

Em `src/app/chat/[slug]/components/__tests__/MessageBubble.test.tsx` (novo arquivo):

- Content vazio → sem carrossel, sem lightbox
- Content só com texto → renderiza `<p>`, nenhum `<img>`
- Content com 1 URL de imagem → 1 `<img>`, sem bullets, sem setas
- Content com 3 URLs consecutivas → 1 elemento com `role` ou `data-testid` de carrossel, 3 slides, 3 bullets
- Content com `[texto, img, img, texto, img]` → 1 carrossel (2 slides) + 1 imagem isolada + 2 blocos de texto
- Click numa imagem do carrossel → lightbox monta com `startIndex` correto
- Click no fundo do lightbox → unmount
- ESC → unmount

Embla anima via `requestAnimationFrame`; em jsdom não roda animação real. Os testes validam estado renderizado (presença de elementos, callbacks, atributos), não o comportamento visual do snap.

Sem teste E2E (fora do padrão do projeto).

## Dependência nova

`embla-carousel-react@^8` — adicionar via `npm install embla-carousel-react`. Peer já satisfeito (React 19).

## Critérios de aceite

1. Resposta do agente com 3+ imagens consecutivas renderiza como carrossel arrastável horizontalmente no mobile.
2. Bullets embaixo refletem slide ativo e são clicáveis.
3. Setas aparecem ao passar mouse no desktop e somem em mobile.
4. Tocar/clicar em qualquer imagem (carrossel ou isolada) abre lightbox fullscreen.
5. Lightbox fecha com ESC, X, ou clique no fundo escuro.
6. Setas ←/→ navegam dentro do lightbox quando há múltiplas imagens.
7. Type-check (`npx tsc --noEmit`) passa.
8. Testes novos passam.
9. Mensagens existentes (sem imagem, com mídia direta, do tipo `image` legítimo) continuam funcionando como antes.
