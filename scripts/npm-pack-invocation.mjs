const PACK_ARGS = ['pack', '--dry-run', '--json', '--ignore-scripts']

/** Build an npm pack invocation without asking Node to execute a Windows .cmd file directly. */
export function npmPackInvocation(platform = process.platform, comspec = process.env.ComSpec) {
  if (platform === 'win32') {
    const command = typeof comspec === 'string' && comspec.trim().length > 0 ? comspec : 'cmd.exe'
    return { command, args: ['/d', '/s', '/c', `npm.cmd ${PACK_ARGS.join(' ')}`] }
  }
  return { command: 'npm', args: [...PACK_ARGS] }
}
