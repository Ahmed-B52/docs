import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import languages from '@/languages/lib/languages-server'
import { loadUnversionedTree } from '@/frame/lib/page-data'

vi.mock(import('@/languages/lib/languages-server'), async (importOriginal) => {
  const original = await importOriginal()
  const { en, ja } = original.default
  return {
    ...original,
    default: {
      en: { ...en },
      ja: { ...ja, code: 'ja' },
    },
  }
})

describe('translated content loading', () => {
  let root: string
  let checkout: string

  function article(body: string, frontmatter = '') {
    return `---\ntitle: Fixture\n${frontmatter}versions:\n  fpt: '*'\n---\n\n${body}\n`
  }

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'translated-content-'))
    languages.en.dir = path.join(root, 'en')
    checkout = languages.ja.dir = path.join(root, 'ja')
    const englishContent = path.join(languages.en.dir, 'content')
    await fs.mkdir(englishContent, { recursive: true })
    await fs.writeFile(
      path.join(englishContent, 'index.md'),
      article('Homepage', 'children: [fixture]\n'),
    )
    await fs.writeFile(path.join(englishContent, 'fixture.md'), article('English body'))
  })

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  test.each([
    ['regular translation', 'Localized body'],
    ['link within content', 'Localized body'],
    ['link outside content', 'English body'],
    ['linked content directory', 'English body'],
  ])('loads the expected body for %s', async (kind, expected) => {
    const content = path.join(checkout, 'content')
    const sibling = path.join(checkout, 'content-other')
    await fs.rm(checkout, { recursive: true, force: true })
    await fs.mkdir(sibling, { recursive: true })
    await fs.writeFile(path.join(sibling, 'fixture.md'), article('Other body'))

    if (kind === 'linked content directory') {
      await fs.symlink(sibling, content, 'dir')
    } else {
      await fs.mkdir(content)
      const translatedArticle = path.join(content, 'fixture.md')
      if (kind === 'regular translation') {
        await fs.writeFile(translatedArticle, article('Localized body'))
      } else if (kind === 'link within content') {
        await fs.writeFile(path.join(content, 'localized.md'), article('Localized body'))
        await fs.symlink('localized.md', translatedArticle)
      } else {
        await fs.symlink(path.join(sibling, 'fixture.md'), translatedArticle)
      }
    }

    const tree = await loadUnversionedTree(['ja'])
    expect(tree.ja.childPages[0].page.markdown.trim()).toBe(expected)
  })
})
