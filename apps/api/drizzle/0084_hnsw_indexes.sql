-- v1.07 (ADR-103): HNSW indexy pro vyhledávání podle významu. Sloupce embedding nemají pevnou dimenzi (model lze změnit),
-- proto částečné indexy nad přetypováním pro běžné dimenze modelů (384 MiniLM, 768 nomic/e5-base, 1024 bge-m3/e5-large, 1536 OpenAI).
CREATE INDEX IF NOT EXISTS "record_vectors_hnsw_384" ON "record_vectors" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE vector_dims("embedding") = 384;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_vectors_hnsw_768" ON "record_vectors" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE vector_dims("embedding") = 768;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_vectors_hnsw_1024" ON "record_vectors" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE vector_dims("embedding") = 1024;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_vectors_hnsw_1536" ON "record_vectors" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE vector_dims("embedding") = 1536;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_hnsw_384" ON "doc_chunks" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE vector_dims("embedding") = 384;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_hnsw_768" ON "doc_chunks" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE vector_dims("embedding") = 768;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_hnsw_1024" ON "doc_chunks" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE vector_dims("embedding") = 1024;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_chunks_hnsw_1536" ON "doc_chunks" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE vector_dims("embedding") = 1536;
