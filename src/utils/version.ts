/**
 * Shared version utility - reads version from package.json
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function getVersion(): string {
  const possiblePaths = [
    join(__dirname, '..', 'package.json'),
    join(__dirname, 'package.json'),
    join(process.cwd(), 'package.json'),
  ]

  for (const pkgPath of possiblePaths) {
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        if (pkg.name === 'vite-plugin-ai-annotator' && pkg.version) {
          return pkg.version
        }
      } catch {
        continue
      }
    }
  }
  return '0.0.0'
}
