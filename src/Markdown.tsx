import type { ReactNode } from 'react'

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
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
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
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

function startsBlock(line: string): boolean {
  return /^\s*(```|#{1,6}\s|>\s?|[-*+]\s+|\d+[.)]\s+)/.test(line)
    || /^\s*([-*_])\1{2,}\s*$/.test(line)
}

function Block({ block }: { block: Block }) {
  if (block.kind === 'code') {
    return (
      <pre>
        <code className={block.lang ? `language-${block.lang}` : undefined}>{block.text}</code>
      </pre>
    )
  }
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
