import { addError } from 'markdownlint-rule-helpers'
import yaml from 'js-yaml'

import { getLintTokens, renderLintLiquid } from '../helpers/render-liquid'
import type { RuleParams, RuleErrorCallback, Rule } from '@/content-linter/types'

// Detects third-party actions in the format `owner/repo@ref`
const actionRegex = /[\w-]+\/[\w-]+@[\w-]+/
// Detects a full-length commit SHA (40 hexadecimal characters)
const shaRegex = /[\w-]+\/[\w-]+@[0-9a-fA-F]{40}/
// Detects first-party actions
const firstPartyPrefixes = ['actions/', './.github/actions/', 'github/', 'octo-org/', 'OWNER/']

interface WorkflowStep {
  uses?: string
  [key: string]: unknown
}

interface WorkflowJob {
  steps?: WorkflowStep[]
  [key: string]: unknown
}

interface WorkflowYaml {
  jobs?: Record<string, WorkflowJob>
  steps?: WorkflowStep[]
  [key: string]: unknown
}

export const thirdPartyActionPinning: Rule = {
  names: ['GHD041', 'third-party-action-pinning'],
  description:
    'Code examples that use third-party actions must always pin to a full length commit SHA',
  tags: ['feature', 'actions'],
  parser: 'markdownit',
  asynchronous: true,
  function: async (params: RuleParams, onError: RuleErrorCallback) => {
    for (const token of getLintTokens(params, 'fence')) {
      if (!token.info || !token.content) continue
      const lang = token.info.trim().split(/\s+/u).shift()?.toLowerCase()
      if (lang !== 'yaml' && lang !== 'yml') continue
      if (!token.content.includes('steps:')) continue
      if (!token.content.includes('uses:')) continue

      // Render Liquid first so the YAML parser doesn't see tags like {% raw %}.
      const renderedYaml = await renderLintLiquid(token.content, token.lineNumber, onError)
      if (renderedYaml === undefined) continue
      try {
        const yamlObj = yaml.load(renderedYaml) as WorkflowYaml
        const steps = getWorkflowSteps(yamlObj)
        if (!steps.some((step) => step.uses)) continue

        for (const step of steps) {
          if (step.uses) {
            const actionMatch = step.uses.match(actionRegex)
            if (actionMatch) {
              const isFirstParty = firstPartyPrefixes.some((prefix) =>
                step.uses!.startsWith(prefix),
              )
              if (!isFirstParty && !shaRegex.test(step.uses)) {
                addError(
                  onError,
                  getLineNumber(token.content!, step.uses) + token.lineNumber,
                  'Code examples that use third-party actions must always pin to a full length commit SHA',
                  step.uses,
                )
              }
            }
          }
        }
      } catch (e) {
        if (e instanceof yaml.YAMLException) {
          console.log('YAML Exception file:', params.name)
          console.error('YAML Exception:', e.message)
        } else {
          console.error('Error parsing YAML:', e)
        }
      }
    }
  },
}

function getWorkflowSteps(yamlObj: WorkflowYaml): WorkflowStep[] {
  if (yamlObj?.jobs) {
    const jobs = Object.values(yamlObj.jobs)
    return jobs.flatMap((job) => job.steps || [])
  } else if (yamlObj?.steps) {
    return yamlObj.steps
  }
  return []
}

function getLineNumber(tokenContent: string, step: string): number {
  const contentLines = tokenContent.split('\n')
  return contentLines.findIndex((line) => line.includes(step)) + 1
}
