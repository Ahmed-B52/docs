import fs from 'node:fs'
import path from 'node:path'

// The configured workspace is trusted; its content directory and everything below it are not.
export function assertContentPath(contentRoot: string, filePath: string, missingLeaf = false) {
  const relative = path.relative(contentRoot, filePath)
  const parts = relative ? relative.split(path.sep) : []
  if (path.isAbsolute(relative) || parts[0] === '..') {
    throw new Error(`Path is outside the content root: ${filePath}`)
  }

  let current = contentRoot
  for (let i = 0; i <= parts.length; i++) {
    const leaf = i === parts.length
    const stat = fs.lstatSync(current, { throwIfNoEntry: !(missingLeaf && leaf) })
    if (stat?.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in content paths: ${current}`)
    }
    if (!leaf || i === 0) {
      if (!stat?.isDirectory()) throw new Error(`Expected a content directory: ${current}`)
    } else if (stat && !stat.isDirectory() && !stat.isFile()) {
      throw new Error(`Expected a regular content file or directory: ${current}`)
    }
    if (leaf) return stat
    current = path.join(current, parts[i])
  }
}

export function assertContentFile(contentRoot: string, filePath: string) {
  const stat = assertContentPath(contentRoot, filePath)
  if (!stat?.isFile()) {
    throw new Error(`Expected a regular content file: ${filePath}`)
  }
  return stat
}

export function walkContentFiles(
  contentRoot: string,
  directory = contentRoot,
  rejectLinks = false,
): string[] {
  const files: string[] = []
  function visit(dir: string) {
    if (!assertContentPath(contentRoot, dir)?.isDirectory()) {
      throw new Error(`Expected a content directory: ${dir}`)
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) files.push(target)
      else if (rejectLinks) assertContentPath(contentRoot, target)
    }
  }
  visit(directory)
  return files
}

function withContentFile<T>(
  contentRoot: string,
  filePath: string,
  flags: number,
  useFile: (fd: number) => T,
) {
  const target = path.resolve(filePath)
  const expected = assertContentFile(contentRoot, target)
  // Keep the checked file open for I/O, and disallow a replacement leaf symlink on
  // platforms with O_NOFOLLOW. Run the migration in a checkout with exclusive write access:
  // portable Node filesystem APIs cannot pin ancestor directories for open or rename.
  const fd = fs.openSync(
    target,
    flags | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
  )
  try {
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw new Error(`Content file changed while opening: ${target}`)
    }
    return useFile(fd)
  } finally {
    fs.closeSync(fd)
  }
}

export function readContentFile(contentRoot: string, filePath: string) {
  return withContentFile(contentRoot, filePath, fs.constants.O_RDONLY, (fd) =>
    fs.readFileSync(fd, 'utf8'),
  )
}

export function writeContentFile(contentRoot: string, filePath: string, content: string) {
  withContentFile(contentRoot, filePath, fs.constants.O_WRONLY, (fd) => {
    fs.ftruncateSync(fd, 0)
    fs.writeFileSync(fd, content, 'utf8')
  })
}
