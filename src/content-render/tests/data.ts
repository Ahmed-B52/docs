import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createLiquidEngine } from '@/content-render/liquid/engine'
import Page from '@/frame/lib/page'
import languages from '@/languages/lib/languages-server'
import nonEnterpriseDefaultVersion from '@/versions/lib/non-enterprise-default-version'
import { DataDirectory } from '@/tests/helpers/data-directory'

describe('data tag', () => {
  let dd: DataDirectory
  const enDirBefore = languages.en.dir

  beforeAll(() => {
    dd = new DataDirectory({
      data: {
        variables: {
          stuff: {
            foo: 'Foo',
            numbers: '{{ (1..3) | size }}',
          },
        },
        ui: {
          alerts: {},
        },
      },
    })
    languages.en.dir = dd.root
  })

  afterAll(() => {
    if (dd) dd.destroy()
    languages.en.dir = enDirBefore
  })

  test('should render fine if data is found', async () => {
    const page = await Page.init({
      relativePath: 'liquid-tags/good-data-variable.md',
      basePath: './src/fixtures/fixtures',
      languageCode: 'en',
    })
    const context = {
      currentVersion: nonEnterpriseDefaultVersion,
      currentLanguage: 'en',
      currentPath: '/en/liquid-tags/good-data-variable',
    }
    const rendered = await page!.render(context)
    // The test fixture contains:
    //   {% data variables.stuff.foo %}
    // which we control the value of here in the test.
    expect(rendered.includes('Foo')).toBeTruthy()
  })
  test('data references share the allocation budget of the caller', async () => {
    const liquid = createLiquidEngine({ memoryLimit: 5 })
    const context = { currentLanguage: 'en' }
    const reference = '{% data variables.stuff.numbers %}'

    await expect(liquid.parseAndRender(reference, context)).resolves.toBe('3')
    await expect(liquid.parseAndRender(reference + reference, context)).rejects.toThrow(
      'memory alloc limit exceeded',
    )
  })

  test('should throw if the data tag is used with something unrecognized', async () => {
    const page = await Page.init({
      relativePath: 'liquid-tags/bad-data-variable.md',
      basePath: './src/fixtures/fixtures',
      languageCode: 'en',
    })
    const context = {
      currentPath: '/en/liquid-tags/bad-data-variable',
      currentLanguage: 'en',
    }
    await expect(page!.render(context)).rejects.toThrow(
      "Can't find the key 'foo.bar.tipu' in the scope., line:2, col:1",
    )
  })
})
