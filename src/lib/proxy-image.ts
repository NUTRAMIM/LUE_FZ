// Reescreve a URL de uma imagem EXTERNA pra passar pelo nosso proxy (/api/img),
// servindo-a pelo nosso domínio. Resolve "imagem não carrega no mobile" quando o
// host externo bloqueia hotlink. URLs que não são http(s) (data:, blob:) ou já
// internas passam direto.
export function proxiedImage(url: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return url
  return `/api/img?u=${encodeURIComponent(url)}`
}
