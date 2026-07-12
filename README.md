# Research Tracker

An arXiv tracker built around three AI-assisted jobs: **tracking** papers relevant to a topic
of interest, **managing** the identified set of papers, and **understanding** their contributions.

## Product

### Track: find papers relevant to a particular topic

Describe a research interest in plain language and have an LLM suggest the most appropriate
arXiv queries to track it. Edit the suggested queries where needed and check the result against
arXiv to catch errors or queries that are too broad or specific. 

Run the queries to collect the matching papers. Every matching paper is embedded (see
**Manage**, below) and scored 0–100 for how well it matches the topic's description. If necessary,
adapt the queries to optimize the results.

### Manage: search and organize your papers

All ingested papers land in the `Inbox`, where users can `save` or `dismiss` them. Papers can be sorted
by date or matching score, and their titles and abstracts can be searched. Users can assign labels to 
papers to organize them into categories.

Additionally, every intested paper gets a sentence embedding of its title and abstract, computed
locally with `Xenova/all-MiniLM-L6-v2` (`lib/embeddings`). The embedding powers multiple
advanced management functions:

- **Relevance scoring:** every paper receives a matching score between 0 and 100, based on the 
similarity between its embedding and that of the topic description. This informs users about the
relevance of each paper to their topic.
- **Find similar papers:** from any paper's page, users can identify similar papers that cover the
same ground.
- **Label suggestions:** once a user has tagged at least one paper with a label, they can ask the
tracker to suggest other papers that could match the same label. This makes it easier to identify
all papers that are relevant to a subtopic.

### Investigate: create research reports and chat with papers

This research tracker offers two ways to investigate the content of a topic, label,
or individual paper:

**Research reports:** Have AI generate a research report on the last 30 days of a topic or one of
your labels. The report summarizes overall themes, groups papers, summarizes what's notable about
each one, and concludes with what stands out. Every paper in the report links
back to its page in the tracker. The report is based only on the papers in the database.

**Paper chat:** Open a paper and ask it questions directly. The tracker fetches the paper's
full text from arXiv (the HTML or the PDF) and grounds every answer in that text rather than 
the abstract alone. Ask it to summarize the contribution, identify the limitations, or write 
a plain-language blog post about the paper.

Reports and chats are currently not stored in the database, so they will disappear when you 
leave the page.

## Technical details

### Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run db:migrate
npm run dev
```

`.env.local` needs three values:

| Variable            | What it is                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`      | Neon Postgres connection string. The same value works locally and on Vercel.  |
| `ANTHROPIC_API_KEY` | Used for query expansion, relevance-adjacent replacement, reports, and chat.   |
| `CRON_SECRET`       | Any long random string. Guards the daily cron route.                          |

The embedding model runs locally via `@huggingface/transformers` — no key or extra service
needed for scoring, similar-papers, or label suggestions.

### How it fits together

| Module            | Responsibility                                                              |
| ------------------ | ---------------------------------------------------------------------------- |
| `lib/arxiv`        | arXiv Atom API client and full-text fetcher. Owns the mandated rate limit.    |
| `lib/expansion`    | Generates, replaces, and validates arXiv search expressions with Claude.     |
| `lib/embeddings`   | Local sentence embeddings, cosine similarity, and score rescaling.           |
| `lib/ingest`       | Orchestrates a run: search → dedupe → store → embed → score, within budget.  |
| `lib/reports`      | Builds and streams AI research-report synthesis.                        |
| `lib/paper-chat`   | Builds and streams AI chat grounded in a paper's full text.             |
