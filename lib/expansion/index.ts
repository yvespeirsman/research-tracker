import type Anthropic from '@anthropic-ai/sdk'
import { firstTextBlock, getAnthropic, MODEL } from '@/lib/anthropic'
import { ExpansionError, MAX_QUERIES, rejectReason, sanitizeQueries } from './sanitize'

export { ExpansionError, MAX_QUERIES, rejectReason, sanitizeQueries }
export { validateQuery, type QueryCheck, type ValidateOptions } from './validate'

export interface ExpansionResult {
  queries: string[]
  model: string
  generatedAt: Date
}

const SYSTEM = `You translate a researcher's interest into arXiv API search expressions.

The goal is RECALL: papers about the same idea often use different words, so a single
keyword search misses them. Produce a set of expressions that together cover the
different ways authors would phrase this work.

arXiv search syntax:
- Field prefixes: ti: (title), abs: (abstract), au: (author), cat: (category), all: (any field)
- Boolean operators: AND, OR, ANDNOT. Group with parentheses.
- Multi-word phrases MUST be double-quoted, e.g. abs:"graph neural network"

Rules:
- Return between 4 and ${MAX_QUERIES} expressions.
- Each expression must be independently useful — they are run as separate searches
  and the results are merged and deduplicated.
- Cover: the exact terminology, common synonyms and alternate phrasings, closely
  related subfields, and relevant arXiv categories.
- Every expression must be constrained enough to return topical results. Never emit a
  bare single-word catch-all like all:learning — combine terms, or pair with a cat:.
- Do not include any date filter; the caller adds one.
- Prefer abs: and ti: over all: — all: matches full text and is noisy.`

const SCHEMA = {
  type: 'object',
  properties: {
    queries: {
      type: 'array',
      items: { type: 'string' },
      description: 'arXiv search_query expressions',
    },
  },
  required: ['queries'],
  additionalProperties: false,
} as const

export interface ExpandOptions {
  client?: Anthropic
  model?: string
}

/**
 * Turn a natural-language research interest into arXiv search expressions.
 *
 * Pure with respect to the database: callers persist the result on the topic so
 * that reruns search for exactly the same things. Regenerating on every run
 * would make results drift for reasons unrelated to arXiv.
 */
export async function expandTopic(
  description: string,
  options: ExpandOptions = {},
): Promise<ExpansionResult> {
  const trimmed = description.trim()
  if (!trimmed) throw new ExpansionError('Topic description is empty')

  const client = options.client ?? getAnthropic()
  const model = options.model ?? MODEL

  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: 'user', content: trimmed }],
  })

  if (message.stop_reason === 'refusal') {
    throw new ExpansionError('Claude declined to expand this topic')
  }

  let parsed: { queries?: unknown }
  try {
    parsed = JSON.parse(firstTextBlock(message))
  } catch {
    throw new ExpansionError('Claude returned malformed JSON for query expansion')
  }

  if (!Array.isArray(parsed.queries)) {
    throw new ExpansionError('Claude returned no queries array')
  }

  return {
    queries: sanitizeQueries(parsed.queries.map(String)),
    model,
    generatedAt: new Date(),
  }
}

const REPLACE_SYSTEM = `You write a single replacement arXiv search expression for a
researcher's topic.

arXiv search syntax:
- Field prefixes: ti: (title), abs: (abstract), au: (author), cat: (category), all: (any field)
- Boolean operators: AND, OR, ANDNOT. Group with parentheses.
- Multi-word phrases MUST be double-quoted, e.g. abs:"graph neural network"

Rules:
- Return exactly one expression.
- It must be meaningfully different from the expressions already in use — cover an
  angle, synonym, or subfield they miss. Do not restate one of them.
- It must be constrained enough to return topical results. Never emit a bare
  single-word catch-all like all:learning.
- Do not include any date filter; the caller adds one.
- Prefer abs: and ti: over all:, which matches full text and is noisy.`

const REPLACE_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string', description: 'One arXiv search_query expression' } },
  required: ['query'],
  additionalProperties: false,
} as const

export interface SuggestOptions extends ExpandOptions {
  /** The expression being replaced, if this is a replacement rather than an addition. */
  replacing?: string
}

/**
 * Ask for one new expression for a topic, given the ones already in use.
 *
 * Passing the siblings matters: without them the model tends to regenerate the
 * most obvious phrasing, which is usually the expression already there.
 */
export async function suggestReplacement(
  description: string,
  existing: string[],
  options: SuggestOptions = {},
): Promise<{ query: string; model: string }> {
  const trimmed = description.trim()
  if (!trimmed) throw new ExpansionError('Topic description is empty')

  const client = options.client ?? getAnthropic()
  const model = options.model ?? MODEL

  const keep = options.replacing
    ? existing.filter((e) => e !== options.replacing)
    : existing

  const prompt = [
    `<interest>${trimmed}</interest>`,
    keep.length > 0
      ? `<already_in_use>\n${keep.map((q) => `- ${q}`).join('\n')}\n</already_in_use>`
      : '',
    options.replacing
      ? `<replacing>${options.replacing}</replacing>\nWrite a better expression covering what that one was aiming at.`
      : 'Write one additional expression covering an angle the others miss.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const message = await client.messages.create({
    model,
    max_tokens: 4000,
    system: REPLACE_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: REPLACE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: 'user', content: prompt }],
  })

  if (message.stop_reason === 'refusal') {
    throw new ExpansionError('Claude declined to suggest an expression')
  }

  let parsed: { query?: unknown }
  try {
    parsed = JSON.parse(firstTextBlock(message))
  } catch {
    throw new ExpansionError('Claude returned malformed JSON for the replacement query')
  }

  const query = String(parsed.query ?? '').trim()
  const problem = rejectReason(query)
  if (problem) {
    throw new ExpansionError(`Claude suggested an unusable expression: ${problem}`)
  }

  return { query, model }
}
