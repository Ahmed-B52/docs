import { readFileSync } from 'fs'
import parseFrontmatter from '@/frame/lib/parse-frontmatter'

// Filters out files from a list of filePaths
// that have a contentType property in their frontmatter
// where the contentType value matches the given contentType argument
export function checkContentType(filePaths: string[], contentType: string) {
  const unallowedChangedFiles = []
  for (const filePath of filePaths) {
    const { data } = parseFrontmatter(readFileSync(filePath, 'utf8'))
    if (data.contentType === contentType) {
      unallowedChangedFiles.push(filePath)
    }
  }
  return unallowedChangedFiles
}
