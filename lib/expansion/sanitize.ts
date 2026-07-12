export const MAX_QUERIES = 8

export class ExpansionError extends Error {}

/**
 * An expression this broad (`all:learning`) would drown the inbox in papers that
 * merely mention the word. The model is told not to emit these; this is the
 * backstop for when it does anyway, and the guard on hand-written expressions.
 */
function isTooBroad(query: string): boolean {
  return /^all:\s*"?[\w-]+"?$/i.test(query)
}

/** Unbalanced parentheses or quotes make arXiv silently return nothing. */
function isUnbalanced(query: string): boolean {
  let depth = 0
  for (const char of query) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth < 0) return true
  }
  if (depth !== 0) return true

  return (query.match(/"/g)?.length ?? 0) % 2 !== 0
}

/**
 * Why this expression cannot be used, or null if it looks structurally sound.
 * Purely syntactic — whether arXiv actually matches anything is a separate,
 * network-bound question handled by `validateQuery`.
 */
export function rejectReason(query: string): string | null {
  const trimmed = query.trim()

  if (!trimmed) return 'Expression is empty.'
  if (isTooBroad(trimmed)) {
    return 'Too broad: a bare all: term matches any paper mentioning the word. Combine terms, or pair it with a cat:.'
  }
  if (isUnbalanced(trimmed)) {
    return 'Unbalanced parentheses or quotes.'
  }
  if (!/^[a-z]+:/i.test(trimmed) && !trimmed.startsWith('(')) {
    return 'Expression must start with a field prefix such as ti:, abs:, au:, cat:, or all:.'
  }

  return null
}

/**
 * Normalize the model's expansions: trim, drop anything structurally unusable,
 * dedupe case-insensitively, and cap the count so one topic cannot eat the whole
 * per-run request budget.
 */
export function sanitizeQueries(raw: string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []

  for (const candidate of raw) {
    const query = candidate.trim()
    if (rejectReason(query)) continue

    const key = query.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    kept.push(query)
    if (kept.length === MAX_QUERIES) break
  }

  if (kept.length === 0) {
    throw new ExpansionError('Query expansion produced no usable arXiv expressions')
  }

  return kept
}
