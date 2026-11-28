import { afterAll, beforeAll, expect, test } from 'vitest'

import languages from '@/languages/lib/languages-server'
import { DataDirectory } from '@/tests/helpers/data-directory'
import { runRule } from '../../lib/init-test'
import { incorrectAltTextLength } from '../../lib/linting-rules/image-alt-text-length'
import { thirdPartyActionPinning } from '../../lib/linting-rules/third-party-action-pinning'
import { yamlScheduledJobs } from '../../lib/linting-rules/yaml-scheduled-jobs'
import type { Rule } from '../../types'

const limitedLoop = (endpoint: number) => `{% for i in (1..${endpoint}) limit:1 %}{% endfor %}`
const oversizedRange = limitedLoop(1_100_000)
const resourceError = 'Liquid exceeded a resource limit.'
const alt = 'The account settings page with the Security tab selected.'
const originalDir = languages.en.dir
let data: DataDirectory

beforeAll(() => {
  data = new DataDirectory({
    data: {
      reusables: {
        range: limitedLoop(600_000),
        plain: alt,
        large: 'x'.repeat(70_000),
      },
    },
  })
  languages.en.dir = data.root
})

afterAll(() => {
  languages.en.dir = originalDir
  data.destroy()
})

test.each([
  [incorrectAltTextLength as Rule, (liquid: string) => `![${liquid}${alt}](image.png)`],
  [
    thirdPartyActionPinning,
    (liquid: string) =>
      ['```yaml', 'steps:', '  - uses: actions/checkout@v4', liquid, '```'].join('\n'),
  ],
  [
    yamlScheduledJobs,
    (liquid: string) =>
      ['```yaml', 'on:', '  schedule:', "    - cron: '13 5 * * *'", liquid, '```'].join('\n'),
  ],
] as const)('$names.0 reports a range limit at the snippet', async (rule, snippet) => {
  const markdown = `# Example\n\n${snippet(oversizedRange)}`
  const result = await runRule(rule, { strings: { markdown } })
  expect(result.markdown).toMatchObject([{ lineNumber: 3, errorDetail: resourceError }])
})

test('nested data renders share the range budget and do not stop later images from being checked', async () => {
  const markdown = [
    `![${limitedLoop(600_000)}{% data reusables.range %}${alt}](image.png)`,
    '![{% data reusables.plain %}](image.png)',
    '![Short](image.png)',
  ].join('\n')
  const result = await runRule(incorrectAltTextLength as Rule, { strings: { markdown } })
  expect(result.markdown).toMatchObject([
    { lineNumber: 1, errorDetail: resourceError },
    { lineNumber: 3, errorDetail: 'Image alternate text is 5 characters long.' },
  ])
})

test('nested data renders share the parse budget', async () => {
  const reference = '{% data reusables.large %}'
  const markdown = `![${reference}${reference}](image.png)`
  const result = await runRule(incorrectAltTextLength as Rule, { strings: { markdown } })
  expect(result.markdown).toMatchObject([{ lineNumber: 1, errorDetail: resourceError }])
})
