import { randomBytes } from 'node:crypto'

export function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function generateSku(name: string): string {
  const base = slugifyName(name) || 'produto'
  const suffix = randomBytes(3).toString('hex')
  return `${base}-${suffix}`
}
