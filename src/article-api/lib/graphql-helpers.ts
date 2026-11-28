import type { Context, Page } from '@/types'
import { renderContent } from '@/content-render/index'
import parseFrontmatter from '@/frame/lib/parse-frontmatter'

/**
 * Extract manual content from page markdown
 * Used by GraphQL transformers to get content before the auto-generated marker
 */
export async function extractManualContent(page: Page, context: Context): Promise<string> {
  if (!page.markdown) return ''

  const markerIndex = page.markdown.indexOf(
    '<!-- Content after this section is automatically generated -->',
  )

  if (markerIndex <= 0) return ''

  const { content } = parseFrontmatter(page.markdown)
  const manualContentMarkerIndex = content.indexOf(
    '<!-- Content after this section is automatically generated -->',
  )

  if (manualContentMarkerIndex <= 0) return ''

  const rawManualContent = content.substring(0, manualContentMarkerIndex).trim()
  if (!rawManualContent) return ''

  return await renderContent(rawManualContent, {
    ...context,
    markdownRequested: true,
  })
}
