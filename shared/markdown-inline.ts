/**
 * Inline Markdown tokenizer.
 *
 * Returns discriminated tokens so the renderer never has to guess formatting
 * from a raw string: a `text` token is always literal content and is rendered
 * verbatim. This matters because identifiers such as `_a_b_` or `__init__`
 * look like delimiters to a string-splitting parser.
 *
 * Rules:
 * - Every `__` sequence is literal. Authors write `**bold**` for strong text.
 * - `_emphasis_` needs a real delimiter: the opening `_` must not follow a
 *   letter, number or `_`; the closing `_` must not precede one. The inner run
 *   may not contain `_`, and neither delimiter may sit next to whitespace.
 * - Boundaries use Unicode property escapes so `café_nama_lain` is literal.
 * - Inline code wins over every other rule, so underscores inside code survive.
 */

export type InlineToken =
  /** Literal text, rendered byte-for-byte. */
  | { kind: 'text'; text: string }
  /** Inline code; `text` is the raw code, not Markdown. */
  | { kind: 'code'; text: string }
  /** Strong emphasis; `text` is inner Markdown and may be tokenized again. */
  | { kind: 'strong'; text: string }
  /** Strikethrough; `text` is inner Markdown and may be tokenized again. */
  | { kind: 'del'; text: string }
  /** Emphasis; `text` is inner Markdown and may be tokenized again. */
  | { kind: 'em'; text: string }
  /** `[label](url)`; `text` is the literal label. */
  | { kind: 'link'; text: string; href: string }
  /** Bare `http(s)://` URL; trailing punctuation is split into a text token. */
  | { kind: 'url'; text: string }

const CODE = /`([^`\n]+)`/y
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/y
const STRONG = /\*\*([^*\n]+)\*\*/y
const DEL = /~~([^~\n]+)~~/y
const EM_STAR = /\*([^*\n]+)\*/y
// (?<![\p{L}\p{N}\p{M}\p{Pc}]) .. (?![\p{L}\p{N}\p{M}\p{Pc}]) : not intraword,
// including Unicode combining marks and connector punctuation.
// (?![\s_]) and [^\s_] : no whitespace or second underscore at either edge.
// [^_\n]*               : no inner underscore, single line only.
const EM_UNDERSCORE = /(?<![\p{L}\p{N}\p{M}\p{Pc}])_(?![\s_])(?:[^_\n]*?[^\s_])_(?![\p{L}\p{N}\p{M}\p{Pc}])/uy
const BARE_URL = /https?:\/\/[^\s<>`]+/y

/** Punctuation that ends a sentence rather than a URL. */
const URL_TAIL = /[.,;:!?*]+$/

function trimBareUrl(raw: string): string {
  let url = raw.replace(URL_TAIL, '')
  const opens = [...url].filter(char => char === '(').length
  let closes = [...url].filter(char => char === ')').length
  while (url.endsWith(')') && closes > opens) {
    url = url.slice(0, -1)
    closes -= 1
  }
  return url
}

export function tokenizeMarkdownInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let literal = ''
  let index = 0

  const flush = () => {
    if (!literal) return
    tokens.push({ kind: 'text', text: literal })
    literal = ''
  }

  while (index < text.length) {
    const match = matchAt(text, index)
    if (match) {
      flush()
      tokens.push(match.token)
      index += match.length
      continue
    }
    // Advance by code point so surrogate pairs stay in one text token.
    const width = (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1
    literal += text.slice(index, index + width)
    index += width
  }

  flush()
  return tokens
}

function matchAt(text: string, index: number): { token: InlineToken; length: number } | null {
  const attempt = (pattern: RegExp): RegExpExecArray | null => {
    pattern.lastIndex = index
    const match = pattern.exec(text)
    return match && match.index === index ? match : null
  }

  const code = attempt(CODE)
  if (code) return { token: { kind: 'code', text: code[1] }, length: code[0].length }

  const link = attempt(LINK)
  if (link) return { token: { kind: 'link', text: link[1], href: link[2] }, length: link[0].length }

  const strong = attempt(STRONG)
  if (strong) return { token: { kind: 'strong', text: strong[1] }, length: strong[0].length }

  const del = attempt(DEL)
  if (del) return { token: { kind: 'del', text: del[1] }, length: del[0].length }

  const emStar = attempt(EM_STAR)
  if (emStar) return { token: { kind: 'em', text: emStar[1] }, length: emStar[0].length }

  const emUnderscore = attempt(EM_UNDERSCORE)
  if (emUnderscore) {
    return { token: { kind: 'em', text: emUnderscore[0].slice(1, -1) }, length: emUnderscore[0].length }
  }

  const bareUrl = attempt(BARE_URL)
  if (bareUrl) {
    const url = trimBareUrl(bareUrl[0])
    // `https://` with no host is not a link; leave it to the text scanner.
    if (url.replace(/^https?:\/\//, '')) {
      return { token: { kind: 'url', text: url }, length: url.length }
    }
  }

  return null
}
