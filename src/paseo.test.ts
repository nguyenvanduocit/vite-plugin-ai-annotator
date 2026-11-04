import { describe, expect, test } from 'bun:test'
import { buildPaseoPrompt } from './paseo'

const elements = [
  { index: 1, comment: 'remove this', imagePath: '/tmp/a.webp' },
  { index: 2, imagePath: '/tmp/b.webp' },
]

describe('buildPaseoPrompt', () => {
  const prompt = buildPaseoPrompt({ pageUrl: 'http://localhost:5173/x', pageTitle: 'X', elements })

  test('inlines the element data', () => {
    expect(prompt).toContain('"comment": "remove this"')
    expect(prompt).toContain('/tmp/b.webp')
  })

  // The toolbar drops the sent elements itself; a DELETE from the agent would
  // wipe whatever the user selected for the next agent meanwhile.
  test('does not ask the agent to clear the selection', () => {
    expect(prompt).not.toContain('DELETE')
  })

  test('requires every screenshot to be opened before any change', () => {
    expect(prompt).toContain('Open every `imagePath`')
  })
})
