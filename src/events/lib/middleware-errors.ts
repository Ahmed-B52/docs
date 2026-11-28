import { pick, snakeCase } from 'lodash-es'
import { randomUUID } from 'crypto'
import type { ErrorObject } from 'ajv'

// https://ajv.js.org/api.html#error-objects
const errorKeys = [
  'keyword',
  'instancePath',
  'schemaPath',
  'params',
  'propertyName',
  'message',
  'schema',
  'parentSchema',
  'data',
]

// Eight records with these field limits keep the double-encoded Hydro batch under 100 KiB.
// Each UTF-16 code unit can cost up to seven bytes after JSON escaping twice.
export const MAX_VALIDATION_DIAGNOSTICS = 8
const MAX_RAW_LENGTH = 512
const MAX_FIELD_LENGTH = 128

export function formatErrorDetails(error: ErrorObject) {
  // Keep the existing snake_case string fields for Hydro and SQL consumers.
  return Object.fromEntries(
    Object.entries(pick(error, errorKeys)).map(([key, value]) => [
      snakeCase(key),
      truncate(makeString(value), MAX_FIELD_LENGTH),
    ]),
  )
}

export function formatError(details: ReturnType<typeof formatErrorDetails>, body: unknown) {
  // The request parser already caps the input. Serialize it at most once per sampled event.
  let raw: string | undefined
  try {
    raw = truncate(makeString(body), MAX_RAW_LENGTH)
  } catch {
    // A deeply nested JSON body can exceed the serializer's stack limit.
    raw = '[unserializable]'
  }
  return {
    event_id: randomUUID(),
    version: '1.0.0',
    created: new Date().toISOString(),
    raw,
    ...details,
  }
}

function truncate(value: string | undefined, limit: number) {
  if (value === undefined || value.length <= limit) return value
  const prefix = value.slice(0, limit - 3).replace(/[\uD800-\uDBFF]$/, '')
  // Copy the preview so it does not retain the original string's backing storage.
  return `${Buffer.from(prefix).toString()}...`
}

// Leave strings alone, otherwise convert to either string or undefined.
function makeString(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
