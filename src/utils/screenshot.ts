/**
 * Shared screenshot and feedback utilities
 */
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
  const timestamp = Date.now()
  const filename = `screenshot-${timestamp}.webp`
  const filePath = path.join(cacheDir, filename)

  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(filePath, buffer)

  return filePath
}

export type FeedbackField = 'xpath' | 'attributes' | 'styles' | 'children'
const BASIC_FIELDS = ['index', 'tagName', 'cssSelector', 'textContent'] as const

export function filterFeedbackFields(
  elements: Record<string, unknown>[],
  fields?: FeedbackField[]
): Record<string, unknown>[] {
  return elements.map((el) => {
    const result: Record<string, unknown> = {}
    // basic fields, comment, and componentData are always included
    if ('comment' in el) result.comment = el.comment
    if ('componentData' in el) result.componentData = el.componentData
    for (const f of BASIC_FIELDS) {
      if (f in el) result[f] = el[f]
    }

    // additional fields only if explicitly requested
    if (fields?.includes('xpath') && 'xpath' in el) {
      result.xpath = el.xpath
    }
    if (fields?.includes('attributes') && 'attributes' in el) {
      result.attributes = el.attributes
    }
    if (fields?.includes('styles') && 'computedStyles' in el) {
      result.computedStyles = el.computedStyles
    }
    if (fields?.includes('children') && 'children' in el) {
      result.children = el.children
    }
    return result
  })
}
