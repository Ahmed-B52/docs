import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import ora from 'ora'
import dotenv from 'dotenv'
import { expandLiquidForEditing } from '@/content-render/scripts/liquid-tags'
import readFrontmatter from '@/frame/lib/read-frontmatter'
import { findMarkdownFiles, mergeFrontmatterProperties } from '@/ai-tools/lib/file-utils'
import {
  getPromptsDir,
  getAvailableEditorTypes,
  getRefinementDescriptions,
  callEditor,
  enrichIndexContext,
} from '@/ai-tools/lib/prompt-utils'
import { fetchCopilotSpace, convertSpaceToPrompt } from '@/ai-tools/lib/spaces-utils'
import { ensureGitHubToken } from '@/ai-tools/lib/auth-utils'
dotenv.config({ quiet: true })

const promptDir = getPromptsDir()

// Ensure GitHub token is available
ensureGitHubToken()

const editorTypes = getAvailableEditorTypes(promptDir)

interface CliOptions {
  verbose?: boolean
  prompt?: string[]
  refine?: string[]
  files?: string[]
  write?: boolean
  exportSpace?: string
  space?: string
  output?: string
}

const program = new Command()

program
  .name('ai-tools')
  .description('AI-powered content tools for editing and analysis')
  .option('-v, --verbose', 'Enable verbose output')
  .option(
    '-w, --write',
    'Write changes back to the original files (default: output to console only)',
  )
  .option(
    '-p, --prompt <type...>',
    `Specify one or more prompt type: ${getRefinementDescriptions(editorTypes)}`,
  )
  .option(
    '-r, --refine <type...>',
    `(Deprecated: use --prompt) Specify one or more prompt type: ${getRefinementDescriptions(editorTypes)}`,
  )
  .option(
    '--export-space <url>',
    'Export a Copilot Space to a prompt file (format: https://api.github.com/orgs/{org}/copilot-spaces/{id})',
  )
  .option(
    '--space <url>',
    'Use a Copilot Space as prompt source (format: https://api.github.com/orgs/{org}/copilot-spaces/{id})',
  )
  .option(
    '--output <filename>',
    'Output filename for exported Space prompt (use with --export-space)',
  )
  .option('-f, --files <files...>', 'One or more content file paths in the content directory')
  .action((options: CliOptions) => {
    ;(async () => {
      // Handle export-space workflow (standalone, doesn't process files)
      if (options.exportSpace) {
        if (!options.output) {
          console.error('Error: --export-space requires --output option')
          process.exit(1)
        }

        const spinner = ora('Fetching Copilot Space...').start()
        try {
          const space = await fetchCopilotSpace(options.exportSpace)
          spinner.text = `Converting Space "${space.name}" to prompt format...`

          const promptContent = convertSpaceToPrompt(space)
          const outputPath = path.join(promptDir, options.output)

          fs.writeFileSync(outputPath, promptContent, 'utf8')
          spinner.succeed(`Exported Space to: ${outputPath}`)
          console.log(`\nSpace: ${space.name}`)
          console.log(`Resources: ${space.resources_attributes?.length || 0} items`)
          console.log(`\nYou can now use it with: --prompt ${path.basename(options.output, '.md')}`)
          return
        } catch (error) {
          spinner.fail(`Failed to export Space: ${(error as Error).message}`)
          process.exit(1)
        }
      }

      // Validate mutually exclusive options
      if (options.space && options.prompt) {
        console.error('Error: Cannot use both --space and --prompt options')
        process.exit(1)
      }

      // Files are required for processing workflows
      if (!options.files || options.files.length === 0) {
        console.error('Error: --files option is required (unless using --export-space)')
        process.exit(1)
      }

      const spinner = ora('Starting AI review...').start()

      const files = options.files
      let prompts: string[] = []
      let promptContent: string | undefined

      // Handle Space workflow (in-memory)
      if (options.space) {
        try {
          spinner.text = 'Fetching Copilot Space...'
          const space = await fetchCopilotSpace(options.space)
          promptContent = convertSpaceToPrompt(space)
          prompts = [space.name] // Use space name for display

          if (options.verbose) {
            console.log(`Using Space: ${space.name} (ID: ${space.number})`)
            console.log(`Resources: ${space.resources_attributes?.length || 0} items`)
          }
        } catch (error) {
          spinner.fail(`Failed to fetch Space: ${(error as Error).message}`)
          process.exit(1)
        }
      } else {
        // Handle local prompt workflow
        prompts = options.prompt || options.refine || []

        if (prompts.length === 0) {
          spinner.fail('No prompt type specified. Use --prompt, --refine, or --space.')
          process.exitCode = 1
          return
        }
      }

      // Validate local prompt types exist (skip for Space workflow)
      if (!options.space) {
        const availableEditors = editorTypes
        for (const editor of prompts) {
          if (!availableEditors.includes(editor)) {
            spinner.fail(
              `Unknown prompt type: ${editor}. Available types: ${availableEditors.join(', ')}`,
            )
            process.exitCode = 1
            return
          }
        }
      }

      if (options.verbose) {
        console.log(`Processing ${files.length} files with prompts: ${prompts.join(', ')}`)
      }

      for (const file of files) {
        const filePath = path.resolve(process.cwd(), file)
        spinner.text = `Checking file: ${file}`

        if (!fs.existsSync(filePath)) {
          spinner.fail(`File not found: ${filePath}`)
          process.exitCode = 1
          continue
        }

        // Check if it's a directory
        const isDirectory = fs.statSync(filePath).isDirectory()

        for (const editorType of prompts) {
          try {
            // For other editor types, process individual files
            const filesToProcess: string[] = []

            if (isDirectory) {
              // Find all markdown files in the directory recursively
              // Use process.cwd() as the root directory for safety
              const rootDir = fs.realpathSync(process.cwd())
              filesToProcess.push(...findMarkdownFiles(filePath, rootDir))

              if (filesToProcess.length === 0) {
                spinner.warn(`No markdown files found in directory: ${file}`)
                continue
              }

              spinner.text = `Found ${filesToProcess.length} markdown files in ${file}`
            } else {
              filesToProcess.push(filePath)
            }

            spinner.start()
            for (const fileToProcess of filesToProcess) {
              const relativePath = path.relative(process.cwd(), fileToProcess)
              spinner.text = `Processing: ${relativePath}`
              try {
                // Expand Liquid references before processing
                const originalContent = fs.readFileSync(fileToProcess, 'utf8')
                let originalIntro = ''
                if (editorType === 'intro') {
                  const { data: originalData } = readFrontmatter(originalContent)
                  originalIntro = originalData?.intro || ''
                }

                if (options.verbose) {
                  console.log(`Expanding Liquid references in: ${relativePath}`)
                }
                const { expanded, restore } = await expandLiquidForEditing(
                  originalContent,
                  options.verbose,
                )
                let content = expanded

                // For intro prompt, add original intro and enrich context
                if (editorType === 'intro') {
                  if (originalIntro) {
                    content = `\n\n---\nOriginal intro (unresolved): ${originalIntro}\n---\n\n${content}`
                  }
                  content = enrichIndexContext(fileToProcess, content)
                }

                // For content-type prompt, skip files that already have contentType
                if (editorType === 'content-type' && content.includes('contentType:')) {
                  spinner.stop()
                  console.log(`⏭️  Skipping ${relativePath} (already has contentType)`)
                  continue
                }

                const answer = await callEditor(
                  editorType,
                  content,
                  promptDir,
                  options.write || false,
                  options.verbose || false,
                  promptContent, // Pass Space prompt content if using --space
                )
                spinner.stop()

                if (options.write) {
                  const restoredAnswer = restore(answer)
                  if (editorType === 'intro' || editorType === 'content-type') {
                    // For frontmatter addition/modification, merge properties instead of overwriting entire file
                    const updatedContent = mergeFrontmatterProperties(fileToProcess, restoredAnswer)
                    fs.writeFileSync(fileToProcess, updatedContent, 'utf8')
                    console.log(`✅ Added frontmatter properties to: ${relativePath}`)
                  } else {
                    // For other editor types, write the full result back to the original file
                    fs.writeFileSync(fileToProcess, restoredAnswer, 'utf8')
                    console.log(`✅ Updated: ${relativePath}`)
                  }
                } else {
                  // Just output to console (current behavior)
                  if (filesToProcess.length > 1) {
                    console.log(`\n=== ${relativePath} ===`)
                  }
                  console.log(answer)
                }
              } catch (err) {
                const error = err as Error
                spinner.fail(`Error processing ${relativePath}: ${error.message}`)
                process.exitCode = 1
              } finally {
                spinner.stop()
              }
            }
          } catch (err) {
            const error = err as Error
            const targetName = path.relative(process.cwd(), filePath)
            spinner.fail(`Error processing ${targetName}: ${error.message}`)
            process.exitCode = 1
          }
        }
      }

      spinner.stop()

      // Exit with appropriate code based on whether any errors occurred
      if (process.exitCode) {
        process.exit(process.exitCode)
      }
    })()
  })

program.parse(process.argv)

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Process interrupted by user')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Process terminated')
  process.exit(0)
})
