/**
 * Shared constants for annotator components
 */

// Z-index hierarchy - ensures proper layering of annotator UI elements
export const Z_INDEX = {
  HIGHLIGHT_OVERLAY: 999996,
  HOVER_OVERLAY: 999997,
  BADGE: 999998,
  TOOLBAR: 999999,
} as const

// Console capture limits
export const CONSOLE_LIMITS = {
  MAX_ARG_LENGTH: 10000,      // Max chars per console arg to prevent memory issues
  BUFFER_MAX: 1000,           // Buffer limit before trimming
  BUFFER_TRIM_TO: 500,        // Keep last N entries after trim
} as const

// Screenshot settings
export const SCREENSHOT_TIMEOUT_MS = 10000 // 10 seconds
