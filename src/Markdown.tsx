import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Align = 'left' | 'center' | 'right'
type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'para'; lines: string[] }

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseBlocks(text).map((block, index) => <Block key={index} block={block} />)}
    </div>
  )
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(.*)$/)
    if (fence) {
      const marker = fence[1]
      const fenceChar = marker[0]
      const minLength = marker.length
      const lang = fence[2].trim().split(/\s+/)[0] || ''
      const body: string[] = []
      index += 1
      const closesFence = (candidate: string) => {
        const trimmed = candidate.trim()
        return trimmed.length >= minLength && trimmed.split('').every(char => char === fenceChar)
      }
      while (index < lines.length && !closesFence(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }
    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index])
      const align = splitTableRow(lines[index + 1]).map((cell): Align => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        return left && right ? 'center' : right ? 'right' : 'left'
      })
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim() && lines[index].includes('|') && !isTableStart(lines, index)) {
        const cells = splitTableRow(lines[index])
        rows.push(header.map((_, cell) => cells[cell] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered: false, items })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered: true, items })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index]) && !isTableStart(lines, index)) {
      paragraph.push(lines[index])
      index += 1
    }
    if (paragraph.length === 0) {
      // A startsBlock() line that matched no branch above must still advance.
      paragraph.push(line)
      index += 1
    }
    blocks.push({ kind: 'para', lines: paragraph })
  }
  return blocks
}

function splitTableRow(line: string): string[] {
  return line.trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.replace(/\\\|/g, '|').trim())
}

function isTableStart(lines: string[], index: number): boolean {
  const headerLine = lines[index] || ''
  if (!headerLine.includes('|')) return false
  const header = splitTableRow(headerLine)
  const delimiter = splitTableRow(lines[index + 1] || '')
  if (header.length < 2 || delimiter.length !== header.length) return false
  return delimiter.every(cell => /^:?-{3,}:?$/.test(cell))
}

function startsBlock(line: string): boolean {
  return /^\s*(`{3,}|~{3,}|#{1,6}\s|>\s?|[-*+]\s+|\d+[.)]\s+)/.test(line)
    || /^\s*([-*_])\1{2,}\s*$/.test(line)
}

function Block({ block }: { block: Block }) {
  if (block.kind === 'code') return <CodeBlock lang={block.lang} text={block.text} />
  if (block.kind === 'heading') {
    const tags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const
    const Tag = tags[Math.min(Math.max(block.level, 1), 6) - 1]
    return <Tag><Inline text={block.text} /></Tag>
  }
  if (block.kind === 'hr') return <hr />
  if (block.kind === 'quote') {
    return (
      <blockquote>
        {block.lines.map((line, index) => <p key={index}><Inline text={line} /></p>)}
      </blockquote>
    )
  }
  if (block.kind === 'table') {
    return (
      <div className="md-table-wrap">
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index} style={{ textAlign: block.align[index] || 'left' }}><Inline text={cell} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.header.map((_, cellIndex) => (
                  <td key={cellIndex} style={{ textAlign: block.align[cellIndex] || 'left' }}><Inline text={row[cellIndex] || ''} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (block.kind === 'list') {
    const items = block.items.map((item, index) => <li key={index}><Inline text={item} /></li>)
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
  }
  return (
    <p>
      {block.lines.map((line, index) => (
        <span key={index}>{index > 0 && <br />}<Inline text={line} /></span>
      ))}
    </p>
  )
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // WebViews may expose the API but reject it without a secure context.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 6.5" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      <path d="M4 9l5-5M20 9l-5-5M4 15l5 5M20 15l-5 5" />
    </svg>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    const onBack = (event: Event) => {
      event.preventDefault()
      setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('icyteru:back', onBack)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('icyteru:back', onBack)
    }
  }, [expanded])

  async function copy() {
    if (await copyText(text)) setCopied(true)
  }

  const code = (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>{text}</code>
    </pre>
  )

  return (
    <>
      <div className="md-code">
        <div className="md-code-head">
          <span className="md-code-label">CODE</span>
          {lang && <span className="md-code-lang">{lang}</span>}
          <div className="md-code-actions">
            <button type="button" className="md-code-action" title="Expand code" aria-label="Expand code" onClick={() => setExpanded(true)}>
              <ExpandIcon />
            </button>
            <button type="button" className={copied ? 'md-code-action copied' : 'md-code-action'} title={copied ? 'Copied' : 'Copy code'} aria-label={copied ? 'Copied' : 'Copy code'} aria-live="polite" onClick={() => void copy()}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
        {code}
      </div>
      {expanded && typeof document !== 'undefined' && createPortal(
        <div className="code-modal" role="dialog" aria-modal="true" aria-label="Expanded code" onPointerDown={() => setExpanded(false)}>
          <section className="code-modal-card" onPointerDown={event => event.stopPropagation()}>
            <header className="code-modal-head">
              <span className="md-code-label">CODE</span>
              {lang && <span className="md-code-lang">{lang}</span>}
              <div className="md-code-actions">
                <button type="button" className={copied ? 'md-code-action copied' : 'md-code-action'} title={copied ? 'Copied' : 'Copy code'} aria-label={copied ? 'Copied' : 'Copy code'} onClick={() => void copy()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button type="button" className="md-code-action" title="Close expanded code" aria-label="Close expanded code" onClick={() => setExpanded(false)}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </header>
            <div className="code-modal-body">{code}</div>
          </section>
        </div>,
        document.body
      )}
    </>
  )
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>`]+)/g

function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}><Inline text={part.slice(2, -2)} /></strong>
        if (part.startsWith('__') && part.endsWith('__')) return <strong key={index}><Inline text={part.slice(2, -2)} /></strong>
        if (part.startsWith('~~') && part.endsWith('~~')) return <del key={index}><Inline text={part.slice(2, -2)} /></del>
        if (part.startsWith('*') && part.endsWith('*')) return <em key={index}><Inline text={part.slice(1, -1)} /></em>
        if (part.startsWith('_') && part.endsWith('_')) return <em key={index}><Inline text={part.slice(1, -1)} /></em>
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
        if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
        if (/^https?:\/\//.test(part)) {
          const url = part.replace(/[.,;:!?*]+$/, '')
          const tail = part.slice(url.length)
          return (
            <span key={index}>
              <a href={url} target="_blank" rel="noreferrer">{url}</a>
              {tail}
            </span>
          )
        }
        return <span key={index}>{part}</span>
      })}
    </>
  )
}
