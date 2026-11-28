import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const document = '---\ntitle: Example\nversions:\n  fpt: "*"\n---\n\nExample body.\n'
const featured = '---\nfeaturedLinks:\n  startHere:\n    - /product/old\n---\n'

for (const scenario of [
  'source outside content',
  'destination outside content',
  'linked content root',
  'linked source',
  'linked source ancestor',
  'linked destination ancestor',
  'dangling destination',
  'linked folder descendant',
  'linked parent index',
  'linked homepage',
  'linked undo source',
  'skip linked files and directories in global updates',
  'move and undo a regular folder',
]) {
  test(scenario, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docsmove-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const content = path.join(root, 'content')
    const outside = path.join(root, 'content-neighbor')
    const product = path.join(content, 'product')
    const index = path.join(product, 'index.md')
    const homepage = path.join(content, 'index.md')
    const sentinel = path.join(outside, 'sentinel.md')
    fs.mkdirSync(product, { recursive: true })
    const features = path.join(root, 'data', 'features')
    fs.mkdirSync(features, { recursive: true })
    fs.writeFileSync(path.join(features, 'example.yml'), 'versions:\n  fpt: "*"\n')
    fs.mkdirSync(outside)
    fs.writeFileSync(sentinel, featured)
    fs.writeFileSync(homepage, '---\nchildGroups:\n  - children:\n      - product/old\n---\n')
    fs.writeFileSync(index, '---\nchildren:\n  - /old\n---\n')

    let source = path.join(product, 'old.md')
    let destination = path.join(product, 'new.md')
    fs.writeFileSync(source, document)
    const linkFile = (target: string) => fs.symlinkSync(sentinel, target, 'file')
    const linkDirectory = (target: string) => fs.symlinkSync(outside, target, 'junction')
    let undo = false
    let succeeds = false

    switch (scenario) {
      case 'source outside content':
        source = sentinel
        break
      case 'destination outside content':
        destination = path.join(outside, 'new.md')
        break
      case 'linked content root':
        fs.renameSync(content, path.join(root, 'saved-content'))
        fs.symlinkSync(path.join(root, 'saved-content'), content, 'junction')
        break
      case 'linked source':
        fs.unlinkSync(source)
        linkFile(source)
        break
      case 'linked source ancestor': {
        const linked = path.join(content, 'linked')
        linkDirectory(linked)
        source = path.join(linked, 'sentinel.md')
        break
      }
      case 'linked destination ancestor': {
        const linked = path.join(content, 'linked')
        linkDirectory(linked)
        destination = path.join(linked, 'new.md')
        break
      }
      case 'dangling destination':
        fs.symlinkSync(path.join(outside, 'missing.md'), destination, 'file')
        break
      case 'linked folder descendant':
      case 'move and undo a regular folder':
        source = path.join(product, 'old')
        destination = path.join(product, 'new')
        fs.mkdirSync(source)
        fs.writeFileSync(path.join(source, 'index.md'), document)
        if (scenario === 'linked folder descendant') linkDirectory(path.join(source, 'nested'))
        else succeeds = true
        break
      case 'linked parent index':
        fs.unlinkSync(index)
        linkFile(index)
        break
      case 'linked homepage':
        fs.unlinkSync(homepage)
        linkFile(homepage)
        break
      case 'linked undo source':
        linkFile(destination)
        undo = true
        break
      case 'skip linked files and directories in global updates':
        linkFile(path.join(product, 'linked.md'))
        linkDirectory(path.join(content, 'linked'))
        fs.writeFileSync(path.join(product, 'featured.md'), featured)
        succeeds = true
        break
    }

    function run(reverse: boolean) {
      return spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/content-render/scripts/move-content.ts',
          '--no-git',
          ...(reverse ? ['--undo'] : []),
          source,
          destination,
        ],
        { env: { ...process.env, ROOT: root }, encoding: 'utf8' },
      )
    }

    const before = [source, destination].map((file) =>
      fs.lstatSync(file, { throwIfNoEntry: false }),
    )
    const result = run(undo)
    assert.equal(fs.readFileSync(sentinel, 'utf8'), featured)
    assert.deepEqual(fs.readdirSync(outside), ['sentinel.md'])
    if (!succeeds) {
      assert.equal(result.status, 1, result.stderr)
      assert.match(result.stderr, /outside the content root|Symbolic links are not allowed/)
      for (const [i, file] of [source, destination].entries()) {
        assert.equal(fs.lstatSync(file, { throwIfNoEntry: false })?.ino, before[i]?.ino)
      }
      return
    }

    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(source), false)
    const moved = destination.endsWith('.md') ? destination : path.join(destination, 'index.md')
    assert.match(fs.readFileSync(moved, 'utf8'), /redirect_from:\n {2}- \/product\/old/)
    assert.match(fs.readFileSync(moved, 'utf8'), /contentType: (other|landing)/)
    assert.match(fs.readFileSync(index, 'utf8'), /- \/new/)
    if (scenario === 'skip linked files and directories in global updates') {
      assert.match(fs.readFileSync(path.join(product, 'featured.md'), 'utf8'), /\/product\/new/)
      assert.match(fs.readFileSync(homepage, 'utf8'), /- product\/new/)
    }

    const reversed = run(true)
    assert.equal(reversed.status, 0, reversed.stderr)
    assert.equal(fs.existsSync(destination), false)
    const restored = source.endsWith('.md') ? source : path.join(source, 'index.md')
    assert.doesNotMatch(fs.readFileSync(restored, 'utf8'), /redirect_from/)
    assert.match(fs.readFileSync(index, 'utf8'), /- \/old/)
  })
}
