import { describe, expect, test } from 'vitest'

import { validateJson } from '@/tests/lib/validate-json-schema'
import { formatError, formatErrorDetails } from '../lib/middleware-errors'
import { schemas } from '../lib/schema'

describe('validation diagnostics', () => {
  test('preserves the Hydro schema and small diagnostic fields', () => {
    const { errors } = validateJson({ type: 'string' }, 0)
    const formatted = formatError(formatErrorDetails(errors![0]), 0)
    expect(validateJson(schemas.validation, formatted).isValid).toBe(true)
    expect(formatted).toMatchObject({ raw: '0', keyword: 'type', params: '{"type":"string"}' })
  })

  test('bounds both payload previews and validation metadata', () => {
    const { errors } = validateJson(
      { type: 'object', additionalProperties: false },
      { ['é'.repeat(200)]: true },
    )
    const details = formatErrorDetails(errors![0])
    const formatted = formatError(details, { title: '😀'.repeat(300) })
    expect(formatted.raw).toMatch(/^\{"title":".*\.\.\.$/u)
    expect(formatted.raw!.length).toBeLessThanOrEqual(512)
    expect(formatted).toMatchObject({ keyword: 'additionalProperties', params: expect.any(String) })
    expect(details.params).toMatch(/^\{"additionalProperty":".*\.\.\.$/u)
    expect(details.params!.length).toBeLessThanOrEqual(128)
  })
})
