import { AssertionError, Liquid, LiquidError, LookupType, Parser } from 'liquidjs'
import { addError, filterTokens } from 'markdownlint-rule-helpers'

import { engine } from '@/content-render/liquid/engine'
import { allVersions } from '@/versions/lib/all-versions'
import type { MarkdownToken, RuleErrorCallback, RuleParams } from '../../types'

class LintLiquid extends Liquid {
  // LiquidJS normally creates a fresh parser for each string and partial.
  // Reuse one parser for the entire snippet so nested parses spend the same budget.
  private readonly snippetParser: Parser = new Parser(this)

  parse(html: string, filepath?: string) {
    return this.snippetParser.parse(html, filepath)
  }

  _parsePartialFile(file: string, sync?: boolean, currentFile?: string) {
    return this.snippetParser.parseFile(file, sync, LookupType.Partials, currentFile)
  }

  _parseLayoutFile(file: string, sync?: boolean, currentFile?: string) {
    return this.snippetParser.parseFile(file, sync, LookupType.Layouts, currentFile)
  }
}

export function getLintTokens(params: RuleParams, type: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  filterTokens(params, type, (token: MarkdownToken) => tokens.push(token))
  return tokens
}

export async function renderLintLiquid(
  source: string,
  lineNumber: number,
  onError: RuleErrorCallback,
): Promise<string | undefined> {
  if (!source.includes('{%') && !source.includes('{{')) return source

  const liquid = new LintLiquid({
    extname: engine.options.extname,
    dynamicPartials: engine.options.dynamicPartials,
    parseLimit: 128 * 1024, // Input characters across all parses.
    renderLimit: 250, // Milliseconds across the render and its descendants.
    memoryLimit: 1024 * 1024, // LiquidJS allocation units (e.g. array entries).
  })
  Object.assign(liquid.tags, engine.tags)
  Object.assign(liquid.filters, engine.filters)

  try {
    return await liquid.parseAndRender(source, {
      currentLanguage: 'en',
      currentVersionObj: allVersions['free-pro-team@latest'],
    })
  } catch (error) {
    // Limit assertions can be wrapped by LiquidJS when raised inside a tag.
    const cause = error instanceof LiquidError ? error.originalError : error
    if (
      cause instanceof AssertionError &&
      /^(?:memory alloc limit exceeded|parse length limit exceeded|template render limit exceeded|numeric range bounds exceeded)$/.test(
        cause.message,
      )
    ) {
      addError(onError, lineNumber, 'Liquid exceeded a resource limit.')
      return
    }
    if (error instanceof LiquidError) {
      addError(onError, lineNumber, 'Could not render Liquid in this snippet.')
      return
    }
    throw error
  }
}
