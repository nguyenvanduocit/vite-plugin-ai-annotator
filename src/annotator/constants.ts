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

// Cyberpunk color palette for selections
export const SELECTION_COLORS = ['#FF00FF', '#00FFFF', '#FFFF00'] as const // cyber-pink, cyber-cyan, cyber-yellow

// Text selection settings
export const TEXT_SELECTION = {
  MAX_LENGTH: 10000,           // Maximum characters allowed in a text selection
  HIGHLIGHT_OPACITY: 0.3,      // Background opacity for text highlight
} as const
