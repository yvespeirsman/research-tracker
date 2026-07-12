import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { expandTopic, suggestReplacement } from './index'
import { ExpansionError } from './sanitize'

/** Minimal stub of the one SDK method expandTopic uses. */
function stubClient(response: Partial<Anthropic.Message>) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParams) => ({
    stop_reason: 'end_turn',
    content: [],
    ...response,
  }))
  return { client: { messages: { create } } as unknown as Anthropic, create }
}

const textResponse = (text: string): Partial<Anthropic.Message> => ({
  content: [{ type: 'text', text, citations: null }],
})

describe('expandTopic', () => {
  it('returns sanitized queries plus provenance', async () => {
    const { client } = stubClient(
      textResponse(
        JSON.stringify({
          queries: ['abs:"graph neural network"', 'ti:"GNN"', 'abs:"graph neural network"'],
        }),
      ),
    )

    const result = await expandTopic('graph neural networks', { client })

    // The duplicate is collapsed.
    expect(result.queries).toEqual(['abs:"graph neural network"', 'ti:"GNN"'])
    expect(result.model).toBe('claude-opus-4-8')
    expect(result.generatedAt).toBeInstanceOf(Date)
  })

  it('sends the description as the user turn and requests structured JSON', async () => {
    const { client, create } = stubClient(
      textResponse(JSON.stringify({ queries: ['cat:cs.LG'] })),
    )

    await expandTopic('  spiking neural nets  ', { client })

    const args = create.mock.calls[0][0]
    expect(args.model).toBe('claude-opus-4-8')
    expect(args.messages).toEqual([{ role: 'user', content: 'spiking neural nets' }])
    expect(args.output_config?.format?.type).toBe('json_schema')
    expect(args.thinking?.type).toBe('adaptive')
  })

  it('rejects an empty description without calling the API', async () => {
    const { client, create } = stubClient(textResponse('{}'))
    await expect(expandTopic('   ', { client })).rejects.toThrow(ExpansionError)
    expect(create).not.toHaveBeenCalled()
  })

  it('throws on malformed JSON', async () => {
    const { client } = stubClient(textResponse('not json'))
    await expect(expandTopic('x', { client })).rejects.toThrow(/malformed JSON/)
  })

  it('throws when the queries array is missing', async () => {
    const { client } = stubClient(textResponse(JSON.stringify({ something: 1 })))
    await expect(expandTopic('x', { client })).rejects.toThrow(/no queries array/)
  })

  it('throws when every query is filtered out as too broad', async () => {
    const { client } = stubClient(textResponse(JSON.stringify({ queries: ['all:learning'] })))
    await expect(expandTopic('x', { client })).rejects.toThrow(/no usable arXiv expressions/)
  })

  it('surfaces a refusal rather than parsing empty content', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', content: [] })
    await expect(expandTopic('x', { client })).rejects.toThrow(/declined/)
  })
})

describe('suggestReplacement', () => {
  it('returns one trimmed expression', async () => {
    const { client } = stubClient(textResponse(JSON.stringify({ query: '  cat:cs.LG  ' })))

    const result = await suggestReplacement('topic', [], { client })

    expect(result.query).toBe('cat:cs.LG')
    expect(result.model).toBe('claude-opus-4-8')
  })

  it('shows the model the sibling expressions so it does not restate one', async () => {
    const { client, create } = stubClient(textResponse(JSON.stringify({ query: 'cat:cs.LG' })))

    await suggestReplacement('topic', ['abs:"a"', 'abs:"b"'], { client })

    const prompt = String(create.mock.calls[0][0].messages[0].content)
    expect(prompt).toContain('abs:"a"')
    expect(prompt).toContain('abs:"b"')
  })

  it('excludes the expression being replaced from the sibling list', async () => {
    const { client, create } = stubClient(textResponse(JSON.stringify({ query: 'cat:cs.LG' })))

    await suggestReplacement('topic', ['abs:"keep"', 'abs:"drop"'], {
      client,
      replacing: 'abs:"drop"',
    })

    const prompt = String(create.mock.calls[0][0].messages[0].content)
    expect(prompt).toContain('<replacing>abs:"drop"</replacing>')
    // The replaced expression must not also appear as one to avoid.
    expect(prompt).not.toContain('- abs:"drop"')
    expect(prompt).toContain('- abs:"keep"')
  })

  it('rejects an unusable suggestion rather than saving it', async () => {
    const { client } = stubClient(textResponse(JSON.stringify({ query: 'all:learning' })))

    await expect(suggestReplacement('topic', [], { client })).rejects.toThrow(/too broad/i)
  })

  it('rejects an empty suggestion', async () => {
    const { client } = stubClient(textResponse(JSON.stringify({ query: '' })))

    await expect(suggestReplacement('topic', [], { client })).rejects.toThrow(ExpansionError)
  })

  it('throws on malformed JSON', async () => {
    const { client } = stubClient(textResponse('not json'))

    await expect(suggestReplacement('topic', [], { client })).rejects.toThrow(/malformed JSON/)
  })

  it('surfaces a refusal', async () => {
    const { client } = stubClient({ stop_reason: 'refusal', content: [] })

    await expect(suggestReplacement('topic', [], { client })).rejects.toThrow(/declined/)
  })

  it('rejects an empty description without calling the API', async () => {
    const { client, create } = stubClient(textResponse('{}'))

    await expect(suggestReplacement('  ', [], { client })).rejects.toThrow(ExpansionError)
    expect(create).not.toHaveBeenCalled()
  })
})
