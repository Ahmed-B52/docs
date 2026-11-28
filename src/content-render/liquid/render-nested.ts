import type { Context, Liquid } from 'liquidjs'

export function renderNestedLiquid(
  liquid: Liquid,
  template: string,
  context: Context,
  environments = context.environments,
): Promise<string> {
  // Keep the nested render's scope isolated while sharing the parent's resource limits.
  return liquid.parseAndRender(template, context.spawn(environments))
}

export function indentLiquidText(text: string, spaces: number, context: Context): string {
  context.memoryLimit.use(spaces * (text.match(/^/gm)?.length ?? 0))
  return text.replace(/^/gm, ' '.repeat(spaces))
}
