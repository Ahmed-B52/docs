import { addError } from 'markdownlint-rule-helpers'
import { parse, postprocess, preprocess } from 'micromark'
import { gfmTable } from 'micromark-extension-gfm-table'
import type { Rule } from '../../types'

export const linkQuotation: Rule = {
  names: ['GHD043', 'link-quotation'],
  description: 'Internal link titles must not be surrounded by quotations',
  tags: ['links', 'url'],
  parser: 'none',
  function: ({ lines }, onError) => {
    if (!lines.some((line) => line.includes('"['))) return

    // Markdownlint 0.34 does not expose its position-aware parser to custom rules.
    const events = postprocess(
      parse({ extensions: [gfmTable()] })
        .document()
        .write(preprocess()(lines.join('\n'), undefined, true)),
    )
    const liquidDelimiter = /\{%|%\}/g
    let imageDepth = 0
    let lastFixLine = 0
    let lastFixEnd = 0

    for (const [kind, { type, start, end }] of events) {
      if (type === 'image') imageDepth += kind === 'enter' ? 1 : -1
      if (kind !== 'exit' || type !== 'link' || imageDepth || start.line !== end.line) continue

      const lineNumber = start.line
      const line = lines[lineNumber - 1]
      const openQuote = start.column - 2
      let closeQuote = end.column - 1
      if (line[openQuote] !== '"' || line[closeQuote - 1] !== ')') continue
      if (lastFixLine === lineNumber && openQuote < lastFixEnd) continue

      let beforeQuote = openQuote
      while (line[beforeQuote - 1] === '\\') beforeQuote--
      if ((openQuote - beforeQuote) % 2 !== 0) continue

      // Consume only adjacent tags. Stop at the next delimiter so malformed tags
      // cannot scan across later tag openers or absorb unrelated quoted links.
      while (line.startsWith('{%', closeQuote)) {
        liquidDelimiter.lastIndex = closeQuote + 2
        const delimiter = liquidDelimiter.exec(line)
        if (delimiter?.[0] !== '%}') break
        closeQuote = liquidDelimiter.lastIndex
      }

      if (/[!.?,]/.test(line.charAt(closeQuote))) closeQuote++
      if (line[closeQuote] !== '"') continue

      const range: [number, number] = [openQuote + 1, closeQuote - openQuote + 1]
      addError(
        onError,
        lineNumber,
        'Remove quotes surrounding the link title.',
        line.slice(openQuote, closeQuote + 1),
        range,
        {
          lineNumber,
          editColumn: range[0],
          deleteCount: range[1],
          insertText: line.slice(openQuote + 1, closeQuote),
        },
      )
      lastFixLine = lineNumber
      lastFixEnd = closeQuote + 1
    }
  },
}
