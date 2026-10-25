/**
 * Feedback field selection, shared by the REST API (server) and the clipboard
 * prompt builder (browser). Pure — no node or DOM globals — so the browser
 * bundle can import it without pulling node:fs in through screenshot.ts.
 */

export type FeedbackField = 'xpath' | 'attributes' | 'styles' | 'children'

const BASIC_FIELDS = ['index', 'tagName', 'cssSelector', 'textContent'] as const

export function filterFeedbackFields(
  elements: Record<string, unknown>[],
  fields?: FeedbackField[]
): Record<string, unknown>[] {
  return elements.map((el) => {
    const result: Record<string, unknown> = {}
    // What the user actually asked for, plus where it lives: always included
    if ('comment' in el) result.comment = el.comment
    if ('selectedText' in el) result.selectedText = el.selectedText
    if ('componentData' in el) result.componentData = el.componentData
    // Screenshot of the element as the user saw it — a file path the agent can open
    if ('imagePath' in el) result.imagePath = el.imagePath
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
