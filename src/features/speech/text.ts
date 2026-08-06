import type { SpeakContentMode } from './types'

const SKIP_PARENTS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'])

function isSkipped(el: Element | null): boolean {
  if (!el) return true
  return [...SKIP_PARENTS].some((tag) => el.closest(tag.toLowerCase()))
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function buildSpeakText(title: string, html: string, mode: SpeakContentMode): string {
  const document = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html',
  )
  const parts: string[] = []
  const t = normalizeWhitespace(title)
  if (t) parts.push(t)

  if (mode === 'translation-compare') {
    for (const el of document.body.querySelectorAll('.reader-translation')) {
      const s = normalizeWhitespace(el.textContent ?? '')
      if (s) parts.push(s)
    }
  } else {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const parent = (node as Text).parentElement
      if (
        parent &&
        !isSkipped(parent) &&
        !(mode === 'original' && parent.closest('.reader-translation'))
      ) {
        const s = normalizeWhitespace(node.nodeValue ?? '')
        if (s) parts.push(s)
      }
      node = walker.nextNode()
    }
  }

  return parts.join('\n\n')
}
