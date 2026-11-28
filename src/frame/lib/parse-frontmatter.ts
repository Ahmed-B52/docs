import matter from '@gr2m/gray-matter'

export class UnsupportedFrontmatterLanguageError extends Error {
  readonly reason = this.message

  constructor() {
    super('unsupported frontmatter language; use YAML or JSON')
  }
}

function checkLanguage(markdown: string, delimiters: string | [string, string] = '---') {
  // Match gray-matter's BOM handling and opening delimiter check before it can
  // select a parser from the remainder of the opening line.
  const input = markdown.replace(/^\uFEFF/, '')
  const open = Array.isArray(delimiters) ? delimiters[0] : delimiters
  if (!input.startsWith(open) || input.charAt(open.length) === open.slice(-1)) return

  const language = input.slice(open.length).split('\n', 1)[0].trim()
  if (language && !/^(?:ya?ml|json)$/i.test(language)) {
    throw new UnsupportedFrontmatterLanguageError()
  }
}

export default function parseFrontmatter(markdown: string) {
  checkLanguage(markdown)
  // Passing options avoids reusing entries from gray-matter's unrestricted cache.
  return matter(markdown, {})
}

// gray-matter also parses string input when stringifying.
const stringify: typeof matter.stringify = (file, data, options) => {
  if (typeof file === 'string') checkLanguage(file, options?.delimiters)
  return matter.stringify(file, data, options ?? {})
}

parseFrontmatter.stringify = stringify
