'use client'

import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import ReactMarkdown, { type Components } from 'react-markdown'

const MARKDOWN_COMPONENTS: Components = {
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
}

const SUGGESTIONS = [
  'Summarize the key contribution in a couple of sentences.',
  'What are the main limitations the authors acknowledge?',
  'Write a short blog post introducing this paper to a general audience.',
]

export function PaperChat({ topicId, paperId }: { topicId: number; paperId: number }) {
  const [input, setInput] = useState('')

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/paper-chat',
      body: { topicId, paperId },
    }),
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  const onSend = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    sendMessage({ text: trimmed })
    setInput('')
  }

  return (
    <div>
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSend(suggestion)}
              className="rounded-full border border-black/15 px-3 py-1 text-xs text-black/60 hover:bg-black/5 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/10"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div className="mt-3 space-y-4">
          {messages.map((message) => (
            <div key={message.id}>
              <p className="text-xs font-medium text-black/40 dark:text-white/40">
                {message.role === 'user' ? 'You' : 'Claude'}
              </p>
              <div className="prose prose-sm dark:prose-invert mt-1 max-w-none">
                {message.parts.map((part, i) =>
                  part.type === 'text' ? (
                    <ReactMarkdown key={i} components={MARKDOWN_COMPONENTS}>
                      {part.text}
                    </ReactMarkdown>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error.message || 'Something went wrong.'}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSend(input)
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question, or ask for a blog post…"
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-md border border-black/15 px-4 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {isLoading ? 'Thinking…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
