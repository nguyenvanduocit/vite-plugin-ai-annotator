/**
 * Server-side logging utility
 */

export interface Logger {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createLogger(verbose: boolean): Logger {
  return {
    log: verbose ? console.log.bind(console) : () => {},
    info: verbose ? console.info.bind(console) : () => {},
    warn: verbose ? console.warn.bind(console) : () => {},
    error: verbose ? console.error.bind(console) : () => {},
  }
}

export function createSilentLogger(): Logger {
  return {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}