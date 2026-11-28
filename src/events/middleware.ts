import { createLogger } from '@/observability/logger'
import express from 'express'
import { omit, without, mapValues } from 'lodash-es'
import QuickLRU from 'quick-lru'
import { createHash } from 'crypto'

import type { ExtendedRequest } from '@/types'
import type { Response } from 'express'

import { schemas, hydroNames } from './lib/schema'
import type { EventT } from './lib/hydro'
import catchMiddlewareError from '@/observability/middleware/catch-middleware-error'
import { noCacheControl } from '@/frame/middleware/cache-control'
import { getJsonValidator } from '@/tests/lib/validate-json-schema'
import {
  formatError,
  formatErrorDetails,
  MAX_VALIDATION_DIAGNOSTICS,
} from './lib/middleware-errors'
import { publish as _publish } from './lib/hydro'
import { DOTCOM_USER_COOKIE_NAME, STAFFONLY_COOKIE_NAME } from '@/frame/lib/constants'
import { analyzeComment, getGuessedLanguage } from './lib/analyze-comment'
import { EventType, EventProps, EventPropsByType } from './types'

const logger = createLogger(import.meta.url)

const router = express.Router()
const OMIT_FIELDS = ['type']
const allowedTypes = new Set(without(Object.keys(schemas), 'validation'))
const isProd = process.env.NODE_ENV === 'production'
const validators = mapValues(schemas, (schema) => getJsonValidator(schema))

// In production, fire and not wait to respond.
// _publish will send an error to failbot,
// so we don't get alerts but we still track it.
// This ends up being the same as try > await > catch > (do nothing).
async function publish(...args: Parameters<typeof _publish>) {
  if (isProd) {
    _publish(...args)
    return
  }
  return await _publish(...args)
}

const sentValidationErrors = new QuickLRU({
  maxSize: 10_000,
  maxAge: 1000 * 60,
})

router.post(
  '/',
  catchMiddlewareError(async function postEvents(req: ExtendedRequest, res: Response) {
    noCacheControl(res)

    const eventsToProcess = Array.isArray(req.body) ? req.body : [req.body]
    const validEvents: EventT[] = []
    const validationErrors: EventT[] = []

    for (const eventBody of eventsToProcess) {
      try {
        // Skip event if it doesn't have a type or if the type is not in the allowed types
        if (!eventBody.type || !allowedTypes.has(eventBody.type)) {
          continue
        }
        const type: EventType = eventBody.type
        const body: EventProps & EventPropsByType[EventType] = eventBody
        if (isSurvey(body) && body.survey_comment) {
          body.survey_rating = await getSurveyCommentRating({
            comment: body.survey_comment,
            language: body.context.path_language || 'en',
          })
          body.survey_comment_language = await getGuessedLanguage(body.survey_comment)
        }

        if (body.context) {
          // Add dotcom_user to the context if it's available
          // JSON.stringify removes `undefined` values but not `null`, and we don't want to send `null` to Hydro
          body.context.dotcom_user = req.cookies?.[DOTCOM_USER_COOKIE_NAME]
            ? req.cookies[DOTCOM_USER_COOKIE_NAME]
            : undefined
          body.context.is_staff = Boolean(req.cookies?.[STAFFONLY_COOKIE_NAME])
          // Add IP address and user agent from request
          // Moda forwards the client's IP using the `fastly-client-ip` header
          body.context.ip = req.headers['fastly-client-ip'] as string | undefined
          body.context.user_agent ??= req.headers['user-agent']
        }
        const validate = validators[type]
        if (!validate(body)) {
          // Sample one AJV error per rejected event, and stop allocating diagnostics
          // once this request has used its budget.
          if (validationErrors.length < MAX_VALIDATION_DIAGNOSTICS) {
            const error = validate.errors?.[0]
            if (error) {
              const details = formatErrorDetails(error)
              const window = Math.floor(Date.now() / 10_000)
              const hash = createHash('sha256').update(JSON.stringify(details)).digest('hex')
              const key = `${window}:${hash}`
              if (!sentValidationErrors.has(key)) {
                validationErrors.push({
                  schema: hydroNames.validation,
                  value: formatError(details, body),
                })
                sentValidationErrors.set(key, true)
              }
            }
          }
          continue
        }
        validEvents.push({
          schema: hydroNames[type],
          value: omit(body, OMIT_FIELDS),
        })
      } catch (eventError) {
        logger.error('Error validating event', { error: eventError })
      }
    }
    if (validEvents.length > 0) {
      await publish(validEvents)
    }

    if (validationErrors.length > 0) {
      await publish(validationErrors)
    }
    const statusCode = validationErrors.length > 0 ? 400 : 200

    return res.status(statusCode).json(
      isProd
        ? undefined
        : {
            success_count: validEvents.length,
            failure_count: validationErrors.length,
            details: validationErrors,
          },
    )
  }),
)

// https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates
function isSurvey(
  body: EventProps & EventPropsByType[EventType],
): body is EventProps & EventPropsByType[EventType.survey] {
  return body.type === EventType.survey
}

type GetSurveyCommentRatingArgs = {
  comment: string
  language: string
}
async function getSurveyCommentRating({ comment, language }: GetSurveyCommentRatingArgs) {
  if (!comment || !comment.trim()) return
  const { rating } = await analyzeComment(comment, language)
  return rating
}

export default router
