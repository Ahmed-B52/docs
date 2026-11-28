import { describe, expect, test } from 'vitest'
import { applyFixes } from 'markdownlint-rule-helpers'

import { runRule } from '../../lib/init-test'
import { linkQuotation } from '../../lib/linting-rules/link-quotation'
import type { Rule } from '../../types'

describe(linkQuotation.names.join(' - '), () => {
  test('links that are formatted correctly should not generate an error', async () => {
    const markdown = [
      'Random stuff [A title](./image.png)',
      '"This is a direct quote" [A title](./image.png)',
    ].join('\n')
    const result = await runRule(linkQuotation as Rule, { strings: { markdown } })
    const errors = result.markdown
    expect(errors.length).toBe(0)
  })

  test('links with quotes around them should error out', async () => {
    const markdown = [
      'Random stuff "[A title](./image.png)."',
      'Random stuff "[A title](./image.png)?"',
      'Random stuff "[A title](./image.png)!"',
      'Random stuff "[A title](./image.png)".',
      'Random stuff "[A title](./image.png)"?',
      'Random stuff "[A title](./image.png)"!',
      'See "[AUTOTITLE](/foo/bar){% ifversion fpt %}."{% elsif ghes or ghec %}" and "[AUTOTITLE](/foo/bar)."{% endif %}',
      'See "[AUTOTITLE](/foo/bar)," "[AUTOTITLE](/foo/bar2)," "[AUTOTITLE](/foo/bar3)," and "[AUTOTITLE](/foo/bar4)."',
      'See "[Anchor link](#anchor-link)."',
    ].join('\n')
    const result = await runRule(linkQuotation as Rule, { strings: { markdown } })
    const errors = result.markdown
    expect(errors.length).toBe(13)
    expect(errors[0].errorRange).toEqual([14, 25])
    expect(errors[0].fixInfo?.insertText).toBe('[A title](./image.png).')
    expect(errors[1].fixInfo?.insertText).toBe('[A title](./image.png)?')
  })

  test('fixes each quoted occurrence at its own source column', async () => {
    const link = '[`A title`](./image.png)'
    const markdown = `Read "${link}," then "${link}" beside ${link}.`
    const { markdown: errors } = await runRule(linkQuotation, { strings: { markdown } })

    expect(errors.map((error) => error.errorRange)).toEqual([
      [6, link.length + 3],
      [link.length + 15, link.length + 2],
    ])
    expect(applyFixes(markdown, errors)).toBe(`Read ${link}, then ${link} beside ${link}.`)
  })

  test('keeps only adjacent Liquid tags and punctuation inside the fix', async () => {
    const link = '[AUTOTITLE](/foo/bar)'
    const tags = '{% ifversion fpt %}{% endif %}'
    const markdown = `See "${link}${tags}." or "${link}{% ifversion ghes %} for details{% endif %}."`
    const { markdown: errors } = await runRule(linkQuotation, { strings: { markdown } })

    expect(errors).toHaveLength(1)
    expect(applyFixes(markdown, errors)).toBe(
      `See ${link}${tags}. or "${link}{% ifversion ghes %} for details{% endif %}."`,
    )
  })

  test('reports links in tables and ignores Markdown examples and escaped quotes', async () => {
    const link = '[A title](./image.png)'
    const markdown = [
      '---',
      'title: Example',
      '---',
      '',
      '| Link |',
      '| --- |',
      `| "${link}" |`,
      '',
      `\`"${link}"\``,
      String.raw`\"${link}"`,
      `<!-- "${link}" -->`,
      '',
      '```md',
      `"${link}"`,
      '```',
    ].join('\n')
    const { markdown: errors } = await runRule(linkQuotation, { strings: { markdown } })

    expect(errors.map((error) => [error.lineNumber, error.errorRange])).toEqual([
      [7, [3, link.length + 2]],
    ])
  })
})
