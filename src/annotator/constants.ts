/**
 * Shared constants for annotator components
 */

// Z-index hierarchy - ensures proper layering of annotator UI elements
// Using high values to stay above most third-party widgets (Intercom, Stripe, etc.)
// If conflicts occur, increase all values uniformly (maintain relative ordering)
export const Z_INDEX = {
  INSPECTION_OVERLAY: 999995,  // Mouse inspection hover highlight
  HIGHLIGHT_OVERLAY: 999996,   // Selected element marching ants border
  HOVER_OVERLAY: 999997,       // Element hover during inspection mode
  BADGE: 999998,               // Selection badge with index number
  TOOLBAR: 999999,             // Bottom-right toolbar UI
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

// UI Colors
export const COLORS = {
  INSPECTION: '#A855F7',      // Purple for inspection
  BADGE_TEXT: '#050505',      // Black for badge text
  BADGE_BG: '#050505',        // Black for badge background
} as const

// Fonts
export const FONTS = {
  MONO: "'JetBrains Mono', monospace",
  GOOGLE_FONTS_URL: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap",
} as const

// Text selection settings
export const TEXT_SELECTION = {
  MAX_LENGTH: 10000,           // Maximum characters allowed in a text selection
  HIGHLIGHT_OPACITY: 0.3,      // Background opacity for text highlight
} as const
