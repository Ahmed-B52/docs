// [start-readme]
//
// A helper that returns an array of files for a given path and file extension.
//
// [end-readme]

import walk from 'walk-sync'
import fs from 'fs'
import { join } from 'path'

export function* walkRegularFiles(basePath: string, includeHidden = true): Generator<string> {
  const directories = [basePath]
  while (directories.length > 0) {
    const directory = directories.pop()!
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!includeHidden && entry.name.startsWith('.')) continue
      const entryPath = join(directory, entry.name)
      // Dirent types describe the entry itself, so symlinks are neither directories nor files here.
      if (entry.isDirectory()) {
        directories.push(entryPath)
      } else if (entry.isFile()) {
        yield entryPath
      }
    }
  }
}

export default function walkFiles(
  dir: string,
  ext: string | string[],
  opts: Record<string, unknown> = {},
) {
  const extensions = Array.isArray(ext) ? ext : [ext]
  const walkSyncOpts = { includeBasePath: true, directories: false }

  return walk(dir, walkSyncOpts)
    .filter(
      (file) =>
        extensions.some((extension) => file.endsWith(extension)) && !file.endsWith('README.md'),
    )
    .filter((file) => (opts.includeEarlyAccess ? file : !file.includes('/early-access/')))
}

export function readFiles(dir = 'content', ext = 'md', opts = {}) {
  const paths = walkFiles(dir, ext, opts)
  return paths.map((path) => [path, fs.readFileSync(path, 'utf8')])
}

export function filterFiles(
  files: [path: string, file: string][],
  fn: (path: string, file: string) => boolean,
) {
  return files.filter(([path, file]) => fn(path, file))
}

export function withFiles(
  files: [path: string, file: string][],
  fn: (path: string, file: string) => string,
) {
  return files.map(([path, file]) => [path, fn(path, file)])
}

export function writeFiles(files: [path: string, file: string][]) {
  return files.map(([path, file]) => fs.writeFileSync(path, file))
}
