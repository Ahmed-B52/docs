import type { Context, Liquid, TagToken, Template, TopLevelToken } from 'liquidjs'
import { renderNestedLiquid } from './render-nested'

export const tags: Record<string, string> = {
  note: 'accent',
  tip: 'success',
  warning: 'attention',
  danger: 'danger',
}

const template: string =
  '<div class="ghd-alert ghd-alert-{{ color }} ghd-spotlight-{{ color }}">{{ output }}</div>'

export const Spotlight = {
  type: 'block' as const,
  tagName: '' as string,
  templates: [] as Template[],
  liquid: null as Liquid | null,

  parse(tagToken: TagToken, remainTokens: TopLevelToken[]): void {
    this.tagName = tagToken.name
    this.templates = []

    const stream = this.liquid!.parser.parseStream(remainTokens)
    stream
      .on(`tag:end${this.tagName}`, () => stream.stop())
      .on('template', (tpl: Template) => this.templates.push(tpl))
      .on('end', () => {
        throw new Error(`tag ${tagToken.getText()} not closed`)
      })
    stream.start()
  },

  *render(scope: Context): Generator<unknown, unknown, unknown> {
    const output = yield this.liquid!.renderer.renderTemplates(this.templates, scope)

    return yield renderNestedLiquid(this.liquid!, template, scope, {
      color: tags[this.tagName],
      output,
    })
  },
}
