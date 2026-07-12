CREATE TYPE "public"."paper_state" AS ENUM('unread', 'read', 'saved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."query_source" AS ENUM('llm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"topics_processed" integer DEFAULT 0 NOT NULL,
	"papers_found" integer DEFAULT 0 NOT NULL,
	"error" text,
	"resume_cursor" integer
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"arxiv_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"abstract" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"pdf_url" text,
	"abs_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"paper_id" integer NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"relevance_score" integer,
	"relevance_reason" text,
	"matched_query" text,
	"state" "paper_state" DEFAULT 'unread' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"expression" text NOT NULL,
	"source" "query_source" DEFAULT 'llm' NOT NULL,
	"model" text,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_papers" ADD CONSTRAINT "topic_papers_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_papers" ADD CONSTRAINT "topic_papers_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_queries" ADD CONSTRAINT "topic_queries_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "papers_arxiv_id_idx" ON "papers" USING btree ("arxiv_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_papers_topic_paper_idx" ON "topic_papers" USING btree ("topic_id","paper_id");--> statement-breakpoint
CREATE INDEX "topic_papers_topic_state_idx" ON "topic_papers" USING btree ("topic_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_queries_topic_expression_idx" ON "topic_queries" USING btree ("topic_id","expression");--> statement-breakpoint
CREATE INDEX "topic_queries_topic_idx" ON "topic_queries" USING btree ("topic_id");