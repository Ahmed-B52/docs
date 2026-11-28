import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import createTree from '@/frame/lib/create-tree'

describe('createTree expansion', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-tree-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function writeIndex(dir: string, children: string[]) {
    const directory = path.join(root, dir)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(
      path.join(directory, 'index.md'),
      `---\ntitle: Sitemap\nversions:\n  fpt: '*'\nchildren: ${JSON.stringify(children)}\n---\n`,
    )
  }

  test('rejects a self reference even when the child names the index file explicitly', async () => {
    await writeIndex('', ['/index'])

    await expect(createTree(root)).rejects.toThrow(/Cycle in 'children' frontmatter/)
  })

  test('rejects an ancestor reached through a cross-product symlink', async () => {
    await writeIndex('', ['/actions'])
    await writeIndex('actions', ['/category'])
    await writeIndex('actions/category', ['/content/actions/alias'])
    await fs.symlink('index.md', path.join(root, 'actions', 'alias.md'))

    await expect(createTree(root)).rejects.toThrow(/Cycle in 'children' frontmatter/)
  })

  test('includes a shared subtree in both branches, including on reload', async () => {
    await writeIndex('', ['/actions', '/get-started'])
    await writeIndex('actions', ['/category'])
    await writeIndex('actions/category', [])
    await writeIndex('get-started', ['/content/actions/category'])

    const tree = await createTree(root)
    const reloaded = await createTree(root, undefined, tree)

    for (const result of [tree, reloaded]) {
      const [local, crossProduct] = result!.childPages.map((branch) => branch.childPages[0])
      expect(local.page.relativePath).toBe('actions/category/index.md')
      expect(crossProduct.page.relativePath).toBe(local.page.relativePath)
      expect(local.crossProductChild).toBeUndefined()
      expect(crossProduct.crossProductChild).toBe(true)
    }
  })

  test('rejects excess child work before looking up the children', async () => {
    await writeIndex(
      '',
      Array.from({ length: 25_000 }, (_, index) => `/child-${index}`),
    )

    await expect(createTree(root)).rejects.toThrow('Content tree exceeds 25000 nodes')
  })

  test('bounds the depth of an acyclic tree', async () => {
    await writeIndex('', ['/actions/level-1'])
    await Promise.all(
      Array.from({ length: 127 }, (_, index) =>
        writeIndex(`actions/level-${index + 1}`, [`/content/actions/level-${index + 2}`]),
      ),
    )

    await expect(createTree(root)).rejects.toThrow('Content tree exceeds 128 levels')
  })
})
