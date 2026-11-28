import yaml from 'js-yaml'
import { addError } from 'markdownlint-rule-helpers'

import { getLintTokens, renderLintLiquid } from '../helpers/render-liquid'
import type { RuleParams, RuleErrorCallback, Rule } from '../../types'

interface YamlSchedule {
  cron: string
}

interface YamlWorkflow {
  on?: {
    schedule?: YamlSchedule[]
  }
}

const scheduledYamlJobs: string[] = []

export const yamlScheduledJobs: Rule = {
  names: ['GHD021', 'yaml-scheduled-jobs'],
  description:
    'YAML snippets that include scheduled workflows must not run on the hour and must be unique',
  tags: ['feature', 'actions'],
  parser: 'markdownit',
  asynchronous: true,
  function: async (params: RuleParams, onError: RuleErrorCallback) => {
    for (const token of getLintTokens(params, 'fence')) {
      if (!token.info) continue
      if (!token.content) continue
      const lang = token.info.trim().split(/\s+/u).shift()?.toLowerCase()
      if (lang !== 'yaml' && lang !== 'yml') continue
      if (!token.content.includes('schedule:')) continue
      if (!token.content.includes('- cron:')) continue

      // Render Liquid first so the YAML parser doesn't see tags like {% raw %}.
      const renderedYaml = await renderLintLiquid(token.content, token.lineNumber, onError)
      if (renderedYaml === undefined) continue
      const yamlObj = yaml.load(renderedYaml) as YamlWorkflow
      if (!yamlObj.on) continue
      if (!yamlObj.on.schedule) continue

      for (const schedule of yamlObj.on.schedule) {
        if (schedule.cron.split(' ')[0] === '0') {
          addError(
            onError,
            getLineNumber(token.content!, schedule.cron) + token.lineNumber,
            `YAML scheduled workflow must not run on the hour`,
            schedule.cron,
          )
        }

        if (scheduledYamlJobs.includes(schedule.cron)) {
          addError(
            onError,
            getLineNumber(token.content!, schedule.cron) + token.lineNumber,
            `YAML scheduled workflow must not use the same cron schedule as another workflow`,
            schedule.cron,
          )
        }

        scheduledYamlJobs.push(schedule.cron)
      }
    }
  },
}

function getLineNumber(tokenContent: string, schedule: string): number {
  const contentLines = tokenContent.split('\n')
  return contentLines.findIndex((line) => line.includes(schedule)) + 1
}
