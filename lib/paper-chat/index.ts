import { anthropic } from '@ai-sdk/anthropic'
import { convertToModelMessages, streamText, type LanguageModel, type UIMessage } from 'ai'
import { MODEL } from '@/lib/anthropic'
import type { InboxPaper } from '@/lib/queries'

const SYSTEM_HEADER = `You are discussing a specific arXiv paper with a researcher who is
tracking it in their reading queue. They may ask questions about the paper, or ask you to
write something based on it — e.g. a blog post, a summary, or an explainer for a general
audience. When asked to write something, write it directly in markdown rather than describing
what you would write.

Rules:
- Base every claim on the paper text given below. If a question needs detail the paper doesn't
  cover, say so rather than guessing.
- Write in markdown. Do not wrap responses in a code fence.`

export type PaperChatPaper = Pick<InboxPaper, 'title' | 'authors' | 'arxivId' | 'absUrl' | 'abstract'>

function buildSystemPrompt(paper: PaperChatPaper, fullText: string | null): string {
  const body = fullText
    ? `<paper_full_text>\n${fullText}\n</paper_full_text>`
    : `<paper_abstract>\n${paper.abstract}\n</paper_abstract>\n\n(The paper's full text couldn't be fetched from arXiv. Work from the abstract above, and say so if a question needs more detail than the abstract gives.)`

  return `${SYSTEM_HEADER}

<paper title="${paper.title}" arxiv="${paper.arxivId}" url="${paper.absUrl}">
Authors: ${paper.authors.join(', ')}
</paper>

${body}`
}

export interface StreamPaperChatOptions {
  /** Overrides the model, for test injection. */
  model?: LanguageModel
}

/** Streams a chat response about `paper`, grounded in its full text when available. */
export async function streamPaperChat(
  paper: PaperChatPaper,
  fullText: string | null,
  messages: UIMessage[],
  options: StreamPaperChatOptions = {},
) {
  return streamText({
    model: options.model ?? anthropic(MODEL),
    system: buildSystemPrompt(paper, fullText),
    messages: await convertToModelMessages(messages),
  })
}
