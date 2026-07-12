import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { buildReportPrompt, streamReport } from './index'
import type { ReportPaper } from '@/lib/queries'

const topic = { id: 7, name: 'Graph learning', description: 'Papers on graph neural networks' }

const paper = (overrides: Partial<ReportPaper> = {}): ReportPaper => ({
  paperId: 1,
  arxivId: '2401.00001',
  title: 'A Paper',
  abstract: 'An abstract.',
  authors: ['Ada Lovelace'],
  publishedAt: new Date('2026-06-15T00:00:00Z'),
  absUrl: 'https://arxiv.org/abs/2401.00001',
  label: null,
  ...overrides,
})

describe('buildReportPrompt', () => {
  it('includes the topic, filter description, and paper count', () => {
    const prompt = buildReportPrompt(topic, [paper(), paper({ paperId: 2 })], {
      type: 'recent',
      days: 30,
    })

    expect(prompt).toContain('Graph learning')
    expect(prompt).toContain('Papers on graph neural networks')
    expect(prompt).toContain('the last 30 days')
    expect(prompt).toContain('covering 2 papers')
  })

  it('describes a label filter and singular paper count', () => {
    const prompt = buildReportPrompt(topic, [paper()], { type: 'label', label: 'agents' })

    expect(prompt).toContain('labeled "agents"')
    expect(prompt).toContain('covering 1 paper')
  })

  it('carries each paper\'s title, authors, date, arXiv id, label, and abstract', () => {
    const prompt = buildReportPrompt(
      topic,
      [paper({ title: 'GNN Survey', authors: ['A', 'B'], label: 'survey' })],
      { type: 'label', label: 'survey' },
    )

    expect(prompt).toContain('GNN Survey')
    expect(prompt).toContain('[label: survey]')
    expect(prompt).toContain('A, B')
    expect(prompt).toContain('2026-06-15')
    expect(prompt).toContain('arXiv:2401.00001')
    expect(prompt).toContain('An abstract.')
  })

  it('includes a link to the paper\'s page within this topic', () => {
    const prompt = buildReportPrompt(topic, [paper({ paperId: 42 })], {
      type: 'recent',
      days: 30,
    })

    expect(prompt).toContain('Link: /topics/7/papers/42')
  })

  it('omits the label tag for unlabeled papers', () => {
    const prompt = buildReportPrompt(topic, [paper({ label: null })], { type: 'recent', days: 30 })

    expect(prompt).not.toContain('[label:')
  })
})

describe('streamReport', () => {
  it('streams the model\'s text output', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'Themes: ' },
            { type: 'text-delta', id: '1', delta: 'graph attention.' },
            { type: 'text-end', id: '1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 5, text: 5, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    })

    const result = streamReport(topic, [paper()], { type: 'recent', days: 30 }, { model })

    expect(await result.text).toBe('Themes: graph attention.')
  })

  it('sends the built prompt and system to the model', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '1' },
            { type: 'text-delta', id: '1', delta: 'ok' },
            { type: 'text-end', id: '1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        }),
      }),
    })

    const filter = { type: 'label' as const, label: 'agents' }
    const result = streamReport(topic, [paper({ label: 'agents' })], filter, { model })
    await result.text

    const call = model.doStreamCalls[0]
    expect(call.prompt).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('You write a research report'),
      },
      {
        role: 'user',
        content: [{ type: 'text', text: buildReportPrompt(topic, [paper({ label: 'agents' })], filter) }],
      },
    ])
  })
})
