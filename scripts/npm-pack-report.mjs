/** Extract npm's final JSON array even when an older npm leaks lifecycle output before it. */
export function parseNpmPackReport(stdout) {
  const value = stdout.trimEnd()
  for (let index = value.lastIndexOf('['); index >= 0; index = value.lastIndexOf('[', index - 1)) {
    try {
      const parsed = JSON.parse(value.slice(index))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // Nested arrays, ANSI control sequences, and lifecycle log prefixes are not the outer report.
    }
  }
  throw new Error('npm pack did not emit a valid JSON report')
}
