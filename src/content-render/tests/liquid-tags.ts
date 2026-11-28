import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'

const rootDir = path.join(__dirname, '../../..')
const testContentDir = path.join(rootDir, 'content/test-integration')

describe('liquid-tags script integration tests', () => {
  vi.setConfig({ testTimeout: 60 * 1000 })

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testContentDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test files
    await fs.rm(testContentDir, { recursive: true, force: true })
  })

  // Helper function to run script commands
  async function runScript(
    args: string,
    dataRoot?: string,
  ): Promise<{ output: string; exitCode: number }> {
    let output = ''
    let exitCode = 0

    try {
      output = execSync(`tsx src/content-render/scripts/liquid-tags.ts ${args}`, {
        encoding: 'utf8',
        cwd: rootDir,
        env: dataRoot ? { ...process.env, ROOT: dataRoot } : process.env,
        stdio: 'pipe',
        timeout: 30000,
      })
    } catch (error: unknown) {
      const execError = error as { stdout?: string; stderr?: string; status?: number }
      output = (execError.stdout || '') + (execError.stderr || '')
      exitCode = execError.status || 1
    }

    return { output, exitCode }
  }

  test('expand command should complete successfully with basic content', async () => {
    // Create a test file with liquid reference
    const testFile = path.join(testContentDir, 'basic-test.md')
    const testContent = `---
title: Test
---

This uses {% data variables.product.prodname_dotcom %} in content.
`

    await fs.writeFile(testFile, testContent)

    const { output, exitCode } = await runScript(`expand --paths "${testFile}"`)

    // Should complete without error
    expect(exitCode, `Script failed with output: ${output}`).toBe(0)
    expect(output.length).toBeGreaterThan(0)

    // Check that the file was modified
    const expandedContent = await fs.readFile(testFile, 'utf8')
    expect(expandedContent).not.toBe(testContent)
    expect(expandedContent).toContain('GitHub') // Should expand to actual fixture value
  })

  test('restore command should complete successfully', async () => {
    const testFile = path.join(testContentDir, 'restore-test.md')
    const originalContent = `---
    title: Test
    ---

This uses {% data variables.product.prodname_dotcom %} in content.
`

    await fs.writeFile(testFile, originalContent)

    // First expand
    await runScript(`expand --paths "${testFile}"`)

    // Then restore
    const { output, exitCode } = await runScript(`restore --paths "${testFile}"`)

    expect(exitCode, `Restore script failed with output: ${output}`).toBe(0)
    expect(output.length).toBeGreaterThan(0)

    // Should be back to original liquid tags
    const restoredContent = await fs.readFile(testFile, 'utf8')
    expect(restoredContent).toContain('{% data variables.product.prodname_dotcom %}')
    expect(restoredContent).not.toContain('GitHub')
  })

  test.skipIf(process.platform === 'win32')('ignores symlinked data paths', async () => {
    const checkout = path.join(testContentDir, 'checkout')
    const outside = path.join(testContentDir, 'outside')
    const reusables = path.join(checkout, 'data/reusables')
    const variables = path.join(checkout, 'data/variables')
    await fs.mkdir(reusables, { recursive: true })
    await fs.mkdir(variables, { recursive: true })
    await fs.mkdir(outside)

    const reusableContent = 'Outside reusable fixture\n'
    const variableContent = 'label: Outside variable fixture\n'
    await fs.writeFile(path.join(outside, 'entry.md'), reusableContent)
    await fs.writeFile(path.join(outside, 'labels.yml'), variableContent)
    await fs.symlink(path.join(outside, 'entry.md'), path.join(reusables, 'leaf.md'))
    await fs.symlink(outside, path.join(reusables, 'directory'))
    await fs.symlink(path.join(outside, 'labels.yml'), path.join(variables, 'labels.yml'))

    const testFile = path.join(testContentDir, 'linked-data.md')
    const references = ['reusables.leaf', 'reusables.directory.entry', 'variables.labels.label']
    const liquid = references.map((ref) => `{% data ${ref} %}`).join('\n')
    await fs.writeFile(testFile, liquid)

    const expanded = await runScript(`expand --shallow --paths "${testFile}"`, checkout)
    expect(expanded.exitCode, expanded.output).toBe(0)
    expect(await fs.readFile(testFile, 'utf8')).toBe(liquid)

    const markers = references.map((ref) => `<!-- begin ${ref} -->Fixture edit<!-- end ${ref} -->`)
    await fs.writeFile(testFile, markers.join('\n'))
    const restored = await runScript(`restore --paths "${testFile}"`, checkout)
    expect(restored.exitCode, restored.output).toBe(0)
    expect(await fs.readFile(testFile, 'utf8')).toBe(liquid)
    expect(await fs.readFile(path.join(outside, 'entry.md'), 'utf8')).toBe(reusableContent)
    expect(await fs.readFile(path.join(outside, 'labels.yml'), 'utf8')).toBe(variableContent)
  })

  test('preserves edits in regular data files and restores nested markers', async () => {
    const checkout = path.join(testContentDir, 'checkout')
    const reusables = path.join(checkout, 'data/reusables')
    const variables = path.join(checkout, 'data/variables')
    await fs.mkdir(reusables, { recursive: true })
    await fs.mkdir(variables, { recursive: true })
    const reusable = path.join(reusables, 'entry.md')
    const variable = path.join(variables, 'labels.yml')
    await fs.writeFile(
      reusable,
      `${'Original reusable content long enough to check truncation. '.repeat(3)}\n`,
    )
    await fs.writeFile(variable, 'label: Original label\n')

    const testFile = path.join(testContentDir, 'regular-data.md')
    await fs.writeFile(
      testFile,
      '<!-- begin reusables.entry -->Édit: <!-- begin variables.labels.label -->New<!-- end variables.labels.label --><!-- end reusables.entry -->',
    )
    const result = await runScript(`restore --paths "${testFile}"`, checkout)

    expect(result.exitCode, result.output).toBe(0)
    expect(await fs.readFile(testFile, 'utf8')).toBe('{% data reusables.entry %}')
    expect(await fs.readFile(reusable, 'utf8')).toBe('Édit: {% data variables.labels.label %}\n')
    // Update the YAML independently; the outer reusable marker consumes nested matches.
    await fs.writeFile(
      testFile,
      '<!-- begin variables.labels.label -->New<!-- end variables.labels.label -->',
    )
    const variableResult = await runScript(`restore --paths "${testFile}"`, checkout)
    expect(variableResult.exitCode, variableResult.output).toBe(0)
    expect(await fs.readFile(variable, 'utf8')).toBe('label: New\n')
  })

  test('help command should display usage information', async () => {
    const { output, exitCode } = await runScript('expand --help')

    expect(exitCode, `Help command failed with output: ${output}`).toBe(0)
    expect(output).toMatch(/resolve|usage|help|command/i)
  })
})
