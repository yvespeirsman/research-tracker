export interface ArxivPaper {
  /** Version-stripped identifier, e.g. `2401.12345` or `cs/0501001`. */
  arxivId: string
  version: number
  title: string
  abstract: string
  authors: string[]
  categories: string[]
  publishedAt: Date
  updatedAt: Date
  absUrl: string
  pdfUrl: string | null
}
