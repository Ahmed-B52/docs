import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

import { getFrontmatter } from '@/content-linter/lib/helpers/utils'
import readFrontmatter from '@/frame/lib/read-frontmatter'

const normalizer = fileURLToPath(
  new URL('../../../scripts/sync-sdk-docs/normalize-sdk-docs.ts', import.meta.url),
)

function normalize(markdown: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'normalize-sdk-docs-'))
  try {
    const file = path.join(directory, 'guide.md')
    writeFileSync(file, markdown)
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', normalizer, '--content-dir', directory, '--sdk-docs-dir', directory],
      { encoding: 'utf8' },
    )
    if (result.error) throw result.error
    return { ...result, markdown: readFileSync(file, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('preserves frontmatter-like Markdown exposed by removing the title and intro', () => {
  const body = '---yaml\nexample: Body text\n---\n\nMore Markdown.\n'
  const result = normalize(`# Guide\n\nIntroduction.\n\n${body}`)
  expect(result.status, result.stderr).toBe(0)

  const { content, data, errors } = readFrontmatter(result.markdown)
  expect(errors).toEqual([])
  expect(data).toMatchObject({ title: 'Guide', intro: 'Introduction.' })
  expect(data).not.toHaveProperty('example')
  expect(content).toContain(body)
})

test('keeps existing YAML frontmatter', () => {
  const result = normalize('---\ntitle: Existing title\n---\n\n# Heading\n')
  expect(result.status, result.stderr).toBe(0)
  const { content, data, errors } = readFrontmatter(result.markdown)
  expect(errors).toEqual([])
  expect(data).toEqual({ title: 'Existing title' })
  expect(content).toContain('# Heading\n')
})

test.each(['---javascript', '\uFEFF--- JS'])(
  'rejects unsupported import frontmatter: %s',
  (opener) => {
    const markdown = `${opener}\nplain text\n---\n`
    const result = normalize(markdown)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unsupported frontmatter language in guide.md')
    expect(result.markdown).toBe(markdown)
  },
)

test.each(['javascript', 'JS'])('frontmatter does not register the %s parser', (language) => {
  expect(() => getFrontmatter([`--- ${language}`, 'plain text', '---'])).toThrow(
    'is not registered',
  )
})
