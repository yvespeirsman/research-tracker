ALTER TABLE "papers" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "topic_papers" ADD COLUMN "relevance_score" integer;