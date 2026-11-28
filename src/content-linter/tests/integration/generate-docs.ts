import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect, test } from 'vitest'

const root = path.join(__dirname, '../../../..')

test.skipIf(process.platform === 'win32')(
  'the rules generator writes regular files and rejects links in its output path',
  () => {
    const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'content-linter-docs-'))
    const output = path.join(cwd, 'data/reusables/contributing/content-linter-rules.md')
    const generate = () =>
      execFileSync(
        process.execPath,
        [
          path.join(root, 'node_modules/tsx/dist/cli.mjs'),
          '--tsconfig',
          path.join(root, 'tsconfig.json'),
          path.join(root, 'src/content-linter/scripts/generate-docs.ts'),
        ],
        { cwd, stdio: 'pipe' },
      )

    try {
      fs.mkdirSync(path.dirname(output), { recursive: true })
      // Rule modules load repository configuration relative to the working directory.
      for (const directory of ['content', 'src']) {
        fs.symlinkSync(path.join(root, directory), path.join(cwd, directory), 'dir')
      }
      for (const entry of fs.readdirSync(path.join(root, 'data'), { withFileTypes: true })) {
        if (entry.name === 'reusables') continue
        const relative = path.join('data', entry.name)
        fs.symlinkSync(
          path.join(root, relative),
          path.join(cwd, relative),
          entry.isDirectory() ? 'dir' : 'file',
        )
      }
      generate()
      const generated = fs.readFileSync(output, 'utf8')
      expect(generated).toContain('| Rule ID |')
      fs.writeFileSync(output, 'stale content')
      generate()
      expect(fs.readFileSync(output, 'utf8')).toBe(generated)

      const fixture = path.join(cwd, 'fixture.md')
      fs.writeFileSync(fixture, 'fixture content')
      fs.unlinkSync(output)
      fs.symlinkSync(fixture, output)
      expect(generate).toThrow()
      expect(fs.readFileSync(fixture, 'utf8')).toBe('fixture content')

      fs.unlinkSync(output)
      const parent = path.dirname(output)
      const movedParent = path.join(cwd, 'fixture-dir')
      fs.renameSync(parent, movedParent)
      fs.symlinkSync(movedParent, parent, 'dir')
      expect(generate).toThrow()
      expect(fs.readdirSync(movedParent)).toEqual([])
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  },
  30000,
)
