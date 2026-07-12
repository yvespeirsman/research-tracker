import Anthropic from '@anthropic-ai/sdk'

/** The model used for query expansion. */
export const MODEL = 'claude-opus-4-8'

let client: Anthropic | undefined

/** Lazily constructed so importing this module doesn't require the key at build time. */
export function getAnthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }
    client = new Anthropic()
  }
  return client
}

/** Pull the first text block out of a response, which is where structured JSON lands. */
export function firstTextBlock(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text
  }
  throw new Error('Claude returned no text block')
}
