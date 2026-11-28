import fs from 'fs'
import path from 'path'

const { O_CREAT, O_DIRECTORY, O_EXCL, O_NOFOLLOW, O_NONBLOCK, O_RDONLY, O_WRONLY } = fs.constants

function splitPath(file: string) {
  const absolute = path.resolve(file)
  const { root } = path.parse(absolute)
  return { root, components: absolute.slice(root.length).split(path.sep) }
}

// Used during discovery, before walking directories or passing files to readers.
export function statWithoutSymlinks(file: string): fs.Stats | undefined {
  const { root, components } = splitPath(file)
  let current = root
  for (const component of components.slice(0, -1)) {
    current = path.join(current, component)
    if (!fs.lstatSync(current, { throwIfNoEntry: false })?.isDirectory()) return
  }
  const stats = fs.lstatSync(path.join(current, components.at(-1)!), { throwIfNoEntry: false })
  if (stats && !stats.isSymbolicLink()) return stats
}

function withRegularFile<T>(
  file: string,
  flags: number,
  create: boolean,
  use: (fd: number) => T,
): T {
  const unsafe = () => new Error(`Expected a regular file without symbolic links: ${file}`)
  let directory: number | undefined
  let fd: number | undefined
  try {
    let target = path.resolve(file)
    if (process.platform === 'linux') {
      const { root, components } = splitPath(target)
      const name = components.pop()!
      directory = fs.openSync(root, O_RDONLY | O_DIRECTORY)
      for (const component of components) {
        // Resolve each name relative to an open directory so replacing an
        // already checked parent cannot redirect the next open.
        const next = fs.openSync(
          `/proc/self/fd/${directory}/${component}`,
          O_RDONLY | O_DIRECTORY | O_NOFOLLOW,
        )
        fs.closeSync(directory)
        directory = next
      }
      target = `/proc/self/fd/${directory}/${name}`
    } else if (!statWithoutSymlinks(path.dirname(target))?.isDirectory()) {
      throw unsafe()
    }

    const expected = fs.lstatSync(target, { throwIfNoEntry: false })
    if (expected ? !expected.isFile() : !create) throw unsafe()

    // Do not truncate on open. For a new output, exclusive creation prevents
    // an entry inserted after lstat from being opened instead.
    fd = fs.openSync(target, flags | O_NOFOLLOW | O_NONBLOCK | (expected ? 0 : O_CREAT | O_EXCL))
    const opened = fs.fstatSync(fd)
    const matches = (stats: fs.Stats | undefined) =>
      stats?.isFile() && opened.dev === stats.dev && opened.ino === stats.ino
    if (!opened.isFile() || (expected && !matches(expected))) throw unsafe()
    // Other platforms lack /proc/self/fd. Recheck that the no-symlink path
    // still identifies the opened file before using the descriptor.
    if (process.platform !== 'linux' && !matches(statWithoutSymlinks(target))) throw unsafe()
    return use(fd)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    if (directory !== undefined) fs.closeSync(directory)
  }
}

export function readRegularFile(file: string): string {
  return withRegularFile(file, O_RDONLY, false, (fd) => fs.readFileSync(fd, 'utf8'))
}

export function writeRegularFile(file: string, content: string, { create = false } = {}) {
  withRegularFile(file, O_WRONLY, create, (fd) => {
    fs.ftruncateSync(fd)
    fs.writeFileSync(fd, content, 'utf8')
  })
}
