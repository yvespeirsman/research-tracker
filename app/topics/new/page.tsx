import Link from 'next/link'
import { NewTopicForm } from './form'

export default function NewTopicPage() {
  return (
    <main>
      <Link
        href="/"
        className="text-sm text-black/50 underline underline-offset-4 dark:text-white/50"
      >
        ← Topics
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New topic</h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Describe the research you want to follow in plain language. It gets expanded into
        several arXiv searches so papers phrased differently still turn up.
      </p>

      <div className="mt-8">
        <NewTopicForm />
      </div>
    </main>
  )
}
