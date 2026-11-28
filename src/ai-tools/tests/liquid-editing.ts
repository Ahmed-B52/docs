import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const cli = fileURLToPath(new URL('../scripts/ai-tools.ts', import.meta.url))
const original = 'Keep {% data reusables.example %} and {% data variables.example.name %}.\n'
const reusable = 'Nested {% data variables.example.name %}.\n'
const variable = 'name: Shared value\n'
const foreignPair = '<!-- begin liquid-other-0 -->Keep this comment pair<!-- end liquid-other-0 -->'

describe('AI CLI Liquid editing', () => {
  let root: string
  let document: string
  let reusablePath: string
  let variablePath: string
  let mock: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-liquid-'))
    document = path.join(root, 'article.md')
    reusablePath = path.join(root, 'data/reusables/example.md')
    variablePath = path.join(root, 'data/variables/example.yml')
    mock = path.join(root, 'models.mjs')
    await fs.mkdir(path.join(root, 'data/features'), { recursive: true })
    await fs.mkdir(path.dirname(reusablePath), { recursive: true })
    await fs.mkdir(path.dirname(variablePath), { recursive: true })
    await fs.writeFile(document, original)
    await fs.writeFile(reusablePath, reusable)
    await fs.writeFile(variablePath, variable)
    await fs.writeFile(
      mock,
      `import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
globalThis.fetch = async (_, { body }) => {
  const { messages } = JSON.parse(body)
  const input = messages.find(({ role }) => role === 'user').content
  const article = input.slice(input.indexOf('Keep '))
  assert.match(article, /Nested Shared value/)
  assert.equal(readFileSync(process.argv[process.argv.indexOf('--files') + 1], 'utf8'), ${JSON.stringify(original)})
  if (process.env.MODEL_RESULT === 'failure') return new Response('', { status: 500 })

  let answer = article.replace('Keep ', 'Edited ').replaceAll('Shared value', 'Model edit')
  if (process.env.MODEL_RESULT === 'partial') answer = answer.replace(/<!-- end liquid-[^>]+ -->/, '')
  answer += '\\n' + ${JSON.stringify(foreignPair)}
  return Response.json({ choices: [{ message: { content: answer } }] })
}
`,
    )
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function run(write: boolean, modelResult = 'ok') {
    return execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        pathToFileURL(mock).href,
        cli,
        '--files',
        document,
        '--prompt',
        'versioning',
        ...(write ? ['--write'] : []),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, ROOT: root, GITHUB_TOKEN: 'test', MODEL_RESULT: modelResult },
        stdio: 'pipe',
        timeout: 10_000,
      },
    )
  }

  async function expectSharedDataUnchanged() {
    expect(await fs.readFile(reusablePath, 'utf8')).toBe(reusable)
    expect(await fs.readFile(variablePath, 'utf8')).toBe(variable)
  }

  test('preview resolves nested references without writing any files', async () => {
    expect(run(false)).toContain('Nested Model edit')
    expect(await fs.readFile(document, 'utf8')).toBe(original)
    await expectSharedDataUnchanged()
  })

  test('write applies document edits and restores original tags without updating shared data', async () => {
    expect(run(true)).toContain('Updated:')
    expect(await fs.readFile(document, 'utf8')).toBe(
      `${original.replace('Keep', 'Edited')}\n${foreignPair}`,
    )
    await expectSharedDataUnchanged()
  })

  test.each(['failure', 'partial'])(
    'leaves the document untouched when the model result is %s',
    async (modelResult) => {
      expect(() => run(true, modelResult)).toThrow(
        modelResult === 'failure' ? /HTTP error/ : /incomplete or invalid Liquid markers/,
      )
      expect(await fs.readFile(document, 'utf8')).toBe(original)
      await expectSharedDataUnchanged()
    },
  )
})
