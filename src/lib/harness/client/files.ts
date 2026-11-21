import { MAX_FILE_BYTES } from '../session/format'

/** Images Venice vision models accept. SVG is left out: it is markup, not pixels. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Venice extracts these to text before inference (docs: File Inputs). */
const FILE_EXTENSIONS = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'xls', 'csv', 'txt', 'md', 'markdown', 'json',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'php', 'java', 'kt', 'swift', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'ps1', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'ini',
  'sql', 'html', 'css', 'scss', 'xml', 'vue', 'svelte', 'lua', 'r', 'dart', 'scala',
])

export type FileCheck = { ok: true; kind: 'image' | 'file' } | { ok: false; error: string }

export function classifyFile(file: { name: string; type: string; size: number }, supportsVision: boolean): FileCheck {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `"${file.name}" is over 4 MB.` }
  if (IMAGE_TYPES.has(file.type)) {
    return supportsVision ? { ok: true, kind: 'image' } : { ok: false, error: 'This model can’t read images.' }
  }
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (FILE_EXTENSIONS.has(ext)) return { ok: true, kind: 'file' }
  return { ok: false, error: `"${file.name}" isn’t a supported file type.` }
}

/** The sidebar title when the title model can't provide one. */
export function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return 'New chat'
  if (clean.length <= 40) return clean
  const cut = clean.slice(0, 40)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read "${file.name}".`))
    reader.readAsDataURL(file)
  })
}
