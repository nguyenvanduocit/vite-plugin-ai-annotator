/**
 * Screenshot storage utilities
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export function getScreenshotCacheDir(): string {
  const cacheDir = path.join(os.tmpdir(), 'ai-annotator-screenshots')
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

export function saveScreenshot(base64: string): string {
  const cacheDir = getScreenshotCacheDir()
  // One feedback submit saves several screenshots within the same millisecond
  const filename = `screenshot-${Date.now()}-${randomUUID().slice(0, 8)}.webp`
  const filePath = path.join(cacheDir, filename)

  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(filePath, buffer)

  return filePath
}
