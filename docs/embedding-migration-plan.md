# Embedding Migration Plan: nomic-embed-text → qwen3-embedding:4b

**Status:** Approved (design meeting 2026-03-31)
**Epic:** private-journal-mcp-zgk
**Meeting report:** `.claude/scratchpad/meetings/embedding-model-review/report.md`

## Context

Mnemosyne uses nomic-embed-text at 768 dimensions for semantic journal search. A design meeting with three domain reviewers (ML/model quality, systems/infrastructure, search/IR quality) evaluated switching to qwen3-embedding. Unanimous recommendation: switch to the 4B variant.

### Key Evidence

| Model | MTEB Retrieval (English v2) | VRAM (Q4_K_M) | Context |
|-------|----------------------------|---------------|---------|
| nomic-embed-text | 52.8 | ~262 MB | 8192 tokens |
| qwen3-embedding:0.6b | 61.83 | ~400 MB | 32K tokens |
| qwen3-embedding:4b | **68.46** | ~2.5 GB | 32K tokens |
| qwen3-embedding:8b | 69.44 | ~4.7 GB | 32K tokens |

- 4B captures 93% of 8B's retrieval improvement over nomic (15.66 vs 16.64 point gain)
- 30% relative retrieval improvement over nomic on BEIR benchmarks (NQ, HotpotQA, FiQA, SciFact)
- Starting at 768d avoids schema migration; model supports up to 2560d for future use

### Hardware

RTX 5070 Ti, 16 GB VRAM. The 4B model at ~2.5 GB leaves ample room for generation models.

## Implementation Sequence

### Step 0: Column rename (standalone PR)

Rename `embedding_768d` to `embedding` throughout:
- Database: `ALTER TABLE ... RENAME COLUMN embedding_768d TO embedding`
- HNSW index: rebuild with new column name
- Code: all references in `postgresql-journal-simple.ts`, `distillation-service.ts`
- This is a non-functional change that improves maintainability

### Step 1: Config bundle (half day)

Introduce `EmbeddingModelConfig` interface with model presets:

```typescript
interface EmbeddingModelConfig {
  model: string;
  dimensions: number;
  documentPrefix: string;
  queryPrefix: string;
  defaultMinRelevance: number;
  maxInputChars: number;
  embeddingColumn: string;
}

const MODEL_CONFIGS: Record<string, EmbeddingModelConfig> = {
  'nomic-embed-text': {
    model: 'nomic-embed-text',
    dimensions: 768,
    documentPrefix: 'search_document: ',
    queryPrefix: 'search_query: ',
    defaultMinRelevance: 0.6,
    maxInputChars: 6000,
    embeddingColumn: 'embedding',
  },
  'qwen3-embedding:4b': {
    model: 'qwen3-embedding:4b',
    dimensions: 768,
    documentPrefix: '',
    queryPrefix: 'Instruct: Given a personal journal search query, retrieve relevant journal entries\nQuery: ',
    defaultMinRelevance: 0.55,  // TBD via empirical calibration
    maxInputChars: 16000,
    embeddingColumn: 'embedding',
  },
};
```

Parameterize hardcoded `768` checks in:
- `formatEmbeddingForPgvector()` — currently throws if not exactly 768
- Write-path gates in `writeEntry()` and `writeThoughtsToDatabase()` — check `length === 768`
- `distillation-service.ts` `generateAndStoreEmbedding()` — checks `length === 768`

### Step 2: Model-aware prefix logic (half day)

Update `OpenAIEmbeddingService`:
- `generateDocumentEmbedding()`: use `config.documentPrefix` (empty for Qwen3)
- `generateQueryEmbedding()`: use `config.queryPrefix` (Instruct format for Qwen3)
- Update `maxInputChars` from config instead of hardcoded `MAX_CHARS = 6000`

### Step 3: Evaluation harness + baseline (1 day)

Build `scripts/evaluate-search-quality.ts`:
- Read test fixture with 20 curated (query, expected_entry_ids, must_be_in_top_k) tuples
- Metrics: Recall@3, Recall@5, MRR, score distribution (min/max/mean)
- A/B mode: run same queries against two embedding columns during migration
- Claude curates evaluation queries (Claude is the journal user)
- Bypass `OpenAIEmbeddingService` singleton — use `OpenAIClient` directly for per-model evaluation
- Run baseline against current nomic embeddings

### Step 4: Re-embed with qwen3-embedding:4b (half day scripting + 30-60 min batch)

Prerequisites before running:
- [ ] `<|endoftext|>` token test: embed same text with/without token via Ollama, compare vectors
- [ ] Pre-flight check in script: embed known test string, verify expected similarity behavior

Migration steps:
1. Add new `embedding_qwen3` column (`vector(768)`) — temporary during migration
2. Disable audit triggers (embeddings are derived data, audit entries have zero diagnostic value)
3. Run re-embedding batch with Qwen3 prefix logic
4. Re-enable audit triggers
5. Build HNSW index on new column

Audit trigger disable/enable should be automated in the script with try/finally.

### Step 5: A/B evaluate + calibrate threshold (half day)

- Run evaluation harness against both columns
- Compare Recall@k and MRR between nomic and Qwen3
- Calibrate `defaultMinRelevance` for Qwen3 (expected ~0.55, needs empirical tuning)
- Document results

### Step 6: Cut over (1 hour)

- Swap config to point at new column
- Drop old embedding column and its HNSW index
- Update env vars in MCP config

## Rollback Strategy

If Qwen3 doesn't improve search quality:
1. Switch `OPENAI_EMBEDDING_MODEL` env var back to `nomic-embed-text`
2. Config bundle auto-resolves correct preset (prefix, threshold, max chars)
3. Re-embed with nomic (30-60 min batch)
4. No schema changes needed if staying at 768d

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wrong prefix during re-embed | HIGH | Pre-flight check: embed test string, verify similarity before batch |
| Threshold miscalibration | HIGH | Empirical calibration via evaluation harness; bundled in config |
| `<|endoftext|>` token not auto-handled | MEDIUM | 5-min empirical test before migration |
| Re-embedding batch failure mid-way | LOW | Script uses try/finally for audit trigger re-enable; batch is idempotent |

## Total Effort

~3-4 days of development plus the re-embedding batch window (30-60 min on RTX 5070 Ti).
