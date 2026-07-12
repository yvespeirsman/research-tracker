import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { streamPaperChat, type PaperChatPaper } from './index'

const paper: PaperChatPaper = {
  title: 'A Paper',
  arxivId: '2401.00001',
  absUrl: 'https://arxiv.org/abs/2401.00001',
  authors: ['Ada Lovelace', 'Alan Turing'],
  abstract: 'An abstract about interesting things.',
}

function userMessage(text: string): UIMessage {
  return { id: '1', role: 'user', parts: [{ type: 'text', text }] }
}

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
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
}

describe('streamPaperChat', () => {
  it('streams the model\'s text output', async () => {
    const model = mockModel('The paper argues X.')

    const result = await streamPaperChat(paper, 'Full paper text here.', [userMessage('Summarize it')], {
      model,
    })

    expect(await result.text).toBe('The paper argues X.')
  })

  it('includes the full text in the system prompt when available', async () => {
    const model = mockModel('ok')

    const result = await streamPaperChat(paper, 'THE FULL TEXT MARKER', [userMessage('hi')], { model })
    await result.text

    const call = model.doStreamCalls[0]
    const system = call.prompt.find((m) => m.role === 'system')
    expect(system?.content).toContain('THE FULL TEXT MARKER')
    expect(system?.content).toContain('A Paper')
    expect(system?.content).toContain('Ada Lovelace, Alan Turing')
    expect(system?.content).not.toContain("full text couldn't be fetched")
  })

  it('falls back to the abstract and says so when full text is unavailable', async () => {
    const model = mockModel('ok')

    const result = await streamPaperChat(paper, null, [userMessage('hi')], { model })
    await result.text

    const call = model.doStreamCalls[0]
    const system = call.prompt.find((m) => m.role === 'system')
    expect(system?.content).toContain('An abstract about interesting things.')
    expect(system?.content).toContain("full text couldn't be fetched")
  })

  it('sends the user message to the model', async () => {
    const model = mockModel('ok')

    const result = await streamPaperChat(paper, null, [userMessage('What are the limitations?')], {
      model,
    })
    await result.text

    const call = model.doStreamCalls[0]
    const userTurn = call.prompt.find((m) => m.role === 'user')
    expect(userTurn?.content).toEqual([{ type: 'text', text: 'What are the limitations?' }])
  })
})
