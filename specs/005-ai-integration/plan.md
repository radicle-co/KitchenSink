# Technical Plan: AI Integration (Feature 005)

**Feature**: `005-ai-integration`
**Phase**: 5 — Product Forge Plan
**Status**: Draft
**Stack**: TypeScript 5.x, Node.js 24.x, NestJS 11, Drizzle ORM, pg, Vercel AI SDK, AWS Secrets Manager, SQS, Clerk MCP

---

## 1. Architecture Overview

### 1.1 Design Principles

- **BYOK-first**: The platform never pays for AI API calls. Users bring their own keys.
- **Provider-agnostic**: Vercel AI SDK abstracts OpenAI/Anthropic/Gemini behind a single interface.
- **Privacy-by-default**: PII never leaves the server. Prompts are sanitized before construction.
- **Async AI**: All generation endpoints are async (jobId + SSE streaming). Results land in standard CRUD tables.
- **EU AI Act compliance**: Transparency disclosures on all AI-generated content. Live August 2, 2026.

### 1.2 System Context

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Apps                           │
│  [Web App]  [Mobile]  [External Agents: ChatGPT/Claude]   │
└───────────────────────┬───────────────────────────────────┘
                        │
┌───────────────────────▼───────────────────────────────────┐
│                  NestJS API (Port 3000)                     │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │AuthMidwr │  │AiModule  │  │McpModule │  │ByokModule│   │
│  │(Clerk)   │  │(Vercel)  │  │(OAuth2.1)│  │(Secrets) │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐   │
│  │Sanitize │  │Piifilter │  │RecipeService             │   │
│  │Layer    │  │(PII scan)│  │(CRUD via Drizzle)       │   │
│  └──────────┘  └──────────┘  └──────────────────────────┘   │
└───────────────────────┬───────────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          │                           │
┌─────────▼─────────┐    ┌────────────▼────────────┐
│  AWS Secrets Mgr  │    │  OpenAI / Anthropic      │
│  byok/{userId}/   │    │  (user-provided keys)   │
│  {provider}       │    │                          │
└───────────────────┘    └─────────────────────────┘
```

### 1.3 Module Inventory

| Module           | File                                 | Responsibility                                               |
| ---------------- | ------------------------------------ | ------------------------------------------------------------ |
| `AiModule`       | `src/ai/ai.module.ts`                | Provider resolution, generation orchestration, SSE streaming |
| `ByokModule`     | `src/ai/byok/byok.module.ts`         | Secrets Manager CRUD, key ARN references in Postgres         |
| `McpModule`      | `src/ai/mcp/mcp.module.ts`           | MCP server, OAuth 2.1 guard, tool definitions                |
| `SanitizeModule` | `src/ai/sanitize/sanitize.module.ts` | PII scanning, pseudonymization before prompt construction    |

---

## 2. Data Model

Feature 005 stores authenticated-user ownership with Feature 002's Clerk `sub` key (the Clerk `sub` claim resolved to an app ULID via `UsersService.resolveOrCreateFromClaims`). Technical FKs use `user_sub VARCHAR(255) COLLATE "C" REFERENCES users(sub)`, aligning with `users.sub` as the canonical user primary key.

### 2.1 Database Tables (Drizzle)

#### `ai_generation_records`

Tracks every AI generation request for audit, billing, and provenance.

```sql
CREATE TABLE ai_generation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) COLLATE "C" NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
  job_id UUID NOT NULL UNIQUE,
  generation_type TEXT NOT NULL CHECK (generation_type IN ('recipe', 'meal_plan', 'shopping_list', 'nutrition_analysis')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'complete', 'failed')),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'byok_openai', 'byok_anthropic')),
  model_id TEXT,
  input_token_count INT,
  output_token_count INT,
  estimated_cost_usd NUMERIC(8, 6),
  source_prompt_hash TEXT,          -- SHA-256 of sanitized prompt; no raw prompts stored
  output_recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  output_meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_gen_records_user_sub ON ai_generation_records(user_sub);
CREATE INDEX idx_ai_gen_records_job_id ON ai_generation_records(job_id);
CREATE INDEX idx_ai_gen_records_status ON ai_generation_records(status);
```

#### `prompt_templates`

CMS-like management of system prompts with versioning and targeting.

```sql
CREATE TABLE prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE CHECK (template_key IN ('recipe_generation', 'meal_plan', 'shopping_list', 'nutrition_analysis', 'recipe_variation')),
  version INT NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  model_recommendations TEXT[],    -- ['gpt-4o', 'claude-opus-4-6'] per generation type
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,                  -- 'admin' or user ID for personal templates
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_prompt_templates_key_version ON prompt_templates(template_key, version);
```

#### `user_byok_keys`

Stores only the AWS Secrets Manager ARN. The raw key is never in Postgres.

```sql
CREATE TABLE user_byok_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) COLLATE "C" NOT NULL UNIQUE REFERENCES users(sub) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  secret_arn TEXT NOT NULL,         -- AWS Secrets Manager ARN: arn:aws:secretsmanager:...
  key_version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_byok_keys_user_provider ON user_byok_keys(user_sub, provider);
```

#### `mcp_oauth_consents`

Tracks OAuth grants from external agent platforms.

```sql
CREATE TABLE mcp_oauth_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub VARCHAR(255) COLLATE "C" NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,              -- space-separated: 'recipes:read recipes:write meal-plans:read'
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  refresh_token_encrypted TEXT,    -- Encrypted; stored in Secrets Manager, ARN here
  last_used_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false
);
```

---

## 3. API Contracts

### 3.1 BYOK Key Management

#### `POST /ai/byok/keys`

Store or update a user's BYOK API key.

**Request:**

```json
{
  "provider": "openai" | "anthropic" | "gemini",
  "apiKey": "sk-..."
}
```

**Response (201):**

```json
{
    "provider": "openai",
    "secretArn": "arn:aws:secretsmanager:us-east-1:123456789:secret/byok/usr_abc/openai",
    "keyVersion": 1,
    "isActive": true
}
```

**Behavior:**

1. Validate API key format (prefix check: `sk-` for OpenAI, `sk-ant` for Anthropic)
2. Test key with a minimal API call (e.g., `models.list`)
3. On success: write raw key to AWS Secrets Manager under `byok/{userId}/{provider}`
4. Store ARN in `user_byok_keys` via Drizzle
5. Return ARN reference to client (never the raw key)

---

#### `DELETE /ai/byok/keys/:provider`

Remove a BYOK key.

**Response (204):** No content.

**Behavior:**

1. Delete from AWS Secrets Manager
2. Delete from `user_byok_keys`

---

#### `GET /ai/byok/keys`

List configured BYOK keys (no raw keys returned).

**Response (200):**

```json
{
    "keys": [
        { "provider": "openai", "isActive": true, "keyVersion": 1, "configuredAt": "2026-05-01T..." },
        { "provider": "anthropic", "isActive": false, "keyVersion": 2, "configuredAt": "2026-04-28" }
    ]
}
```

---

### 3.2 Recipe Generation

#### `POST /ai/generate/recipe` — Async with Job ID

**Request:**

```json
{
  "criteria": {
    "ingredients": ["chicken", "lemon", "garlic"],
    "dietaryNeeds": ["low-carb"],
    "cuisine": "Mediterranean",
    "servings": 4,
    "skillLevel": "intermediate"
  },
  "provider": "openai" | "anthropic" | "gemini" | "auto"
}
```

**Response (202):**

```json
{
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "estimatedWaitSeconds": 10
}
```

**Poll:**
`GET /ai/generate/recipe/:jobId`

```json
{
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "complete",
    "recipe": {
        /* full GeneratedRecipe object */
    },
    "provider": "openai",
    "model": "gpt-4o",
    "tokensUsed": { "input": 342, "output": 892 }
}
```

---

#### `POST /ai/generate/recipe/stream` — SSE Streaming

**Request:** Same as above.

**Response:** `text/event-stream` with `Content-Type: text/event-stream`

```
data: {"partial": {"title": "Lemon Herb Chicken", "ingredients": []}}

data: {"partial": {"title": "Lemon Herb Chicken", "ingredients": [{"name": "chicken", "amount": 2, "unit": "lbs"}]}}

data: {"done": true, "recipe": { /* full object */ }}
```

**Implementation:** Uses Vercel AI SDK `streamObject` with `ReadableStream` → NestJS SSE.

---

### 3.3 Meal Plan Generation

#### `POST /ai/generate/meal-plan`

**Request:**

```json
{
    "dateRange": { "start": "2026-05-11", "end": "2026-05-17" },
    "servings": 4,
    "dietaryNeeds": ["vegetarian", "low-sodium"],
    "excludeIngredients": ["shellfish"],
    "goals": { "caloriesPerDay": 2000, "proteinGPerDay": 120 },
    "provider": "auto"
}
```

**Response (202 or SSE):** Same pattern as recipe generation. Returns a `meal_plan` entity ID on completion.

---

### 3.4 Prompt Template Management (Admin)

#### `GET /ai/prompts`

List all active prompt templates.

#### `PUT /ai/prompts/:templateKey`

Update a prompt template (creates new version).

**Request:**

```json
{
    "systemPrompt": "You are a culinary assistant...",
    "userPromptTemplate": "Generate a {{servings}}-serving {{cuisine}} recipe...",
    "modelRecommendations": ["gpt-4o", "claude-opus-4-6"]
}
```

---

### 3.5 MCP Server Endpoints (OAuth 2.1 Protected)

#### `GET /.well-known/oauth-protected-resource`

Returns [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) Protected Resource Metadata for MCP discovery.

```json
{
    "authorization_servers": ["https://clerk.commise.app"],
    "resource": "https://api.commise.io/mcp"
}
```

#### `GET /.well-known/oauth-authorization-server`

Returns the Clerk instance's authorization server metadata (auto-discovered by MCP clients).

#### `POST /mcp` — MCP JSON-RPC 2.0

MCP protocol handler. Standard JSON-RPC 2.0 batch and single requests over HTTP POST with `Bearer` token.

**Authentication:** OAuth 2.1 with PKCE. Token audience must include `https://api.commise.io/mcp`.

**MCP Tools exposed:**

- `recipes_list` — Read user's recipe collection
- `recipe_get` — Get a specific recipe
- `recipe_save` — Save a new recipe to the user's account
- `meal_plans_list` — Read user's meal plans
- `meal_plan_get` — Get a specific meal plan
- `ingredient_search` — Search the user's ingredient inventory

---

## 4. Event Contracts (EDA)

### 4.1 SQS Queue: `ai-generation-queue`

Used for async generation jobs that don't use SSE streaming.

```typescript
interface AiGenerationJob {
    jobId: string;
    userId: string;
    generationType: 'recipe' | 'meal_plan' | 'shopping_list' | 'nutrition_analysis';
    provider: string;
    sanitizedPromptContext: SanitizedPromptContext;
    outputTable: 'recipes' | 'meal_plans' | 'shopping_lists';
    correlationId: string; // for distributed tracing
    createdAt: string; // ISO 8601
}
```

**Queue configuration:**

- Type: Standard SQS
- Visibility timeout: 120s (configurable per job complexity)
- Dead letter queue: `ai-generation-dlq` (max receive count: 3)
- Max retry attempts: 3

### 4.2 SNS Topic: `ai-events` (Optional — for cross-service notifications)

Published on generation complete/failed:

```typescript
interface AiGenerationEvent {
    eventType: 'ai.generation.complete' | 'ai.generation.failed';
    jobId: string;
    userId: string;
    generationType: string;
    provider: string;
    outputEntityId?: string;
    errorMessage?: string;
    timestamp: string;
}
```

---

## 5. NestJS Services

### 5.1 `AiService` (`src/ai/ai.service.ts`)

Core generation orchestrator.

```typescript
@Injectable()
export class AiService {
    constructor(
        private readonly byokService: ByokService,
        private readonly sanitizeService: SanitizeService,
        private readonly generationQueue: GenerationQueueService,
    ) {}

    async generateRecipe(userId: string, dto: GenerateRecipeDto): Promise<{ jobId: string }>;

    streamRecipe(userId: string, dto: GenerateRecipeDto): Observable<StreamingChunk>;

    async generateMealPlan(userId: string, dto: GenerateMealPlanDto): Promise<{ jobId: string }>;

    async pollJobStatus(jobId: string): Promise<JobStatus>;
}
```

### 5.2 `ByokService` (`src/ai/byok/byok.service.ts`)

AWS Secrets Manager integration. Only handles secret ARN CRUD; does not cache raw keys in application memory.

```typescript
@Injectable()
export class ByokService {
    async storeKey(userId: string, provider: Provider, apiKey: string): Promise<string>;
    async deleteKey(userId: string, provider: Provider): Promise<void>;
    async getKey(userId: string, provider: Provider): Promise<string>; // raw key from Secrets Manager
    async listKeys(userId: string): Promise<ByokKeyMeta[]>;
    async validateKey(provider: Provider, apiKey: string): Promise<boolean>;
}
```

### 5.3 `SanitizeService` (`src/ai/sanitize/sanitize.service.ts`)

PII scrubbing layer. Runs before prompt construction.

```typescript
@Injectable()
export class SanitizeService {
    sanitizeContext(userId: string, context: RecipeContext): SanitizedContext {
        // Pseudonymize user ID → stable hash token
        // Replace health conditions with dietary category labels
        // Strip: email, full name, account numbers, phone numbers
        // Preserve: allergies (needed for recipe safety), dietary preferences
    }

    scanForPii(text: string): Piifinding[]; // used in audit/pre-flight
}
```

**PII patterns detected:**

- Email addresses (regex + heuristics)
- Phone numbers
- Names (via NameRecognizer ML model or dictionary lookup)
- Account IDs / numeric identifiers in context
- Health conditions → replaced with category labels ("diabetic" → "medical-diet-low-sugar")

### 5.4 `McpServerService` (`src/ai/mcp/mcp-server.service.ts`)

MCP JSON-RPC 2.0 handler with OAuth 2.1 token validation.

```typescript
@Injectable()
export class McpServerService {
    async handleRpcRequest(payload: JsonRpcRequest, auth: OAuthTokenPayload): Promise<JsonRpcResponse>;
}
```

### 5.5 `GenerationQueueService` (`src/ai/generation-queue.service.ts`)

SQS producer/consumer for async generation jobs.

```typescript
@Injectable()
export class GenerationQueueService {
    async enqueue(job: AiGenerationJob): Promise<string>; // returns jobId
    async processJob(job: AiGenerationJob): Promise<void>; // consumer
}
```

---

## 6. Resilience & External Services

### 6.1 Rate Limits (Per-User, BYOK Mode)

| Tier             | Limit                                               |
| ---------------- | --------------------------------------------------- |
| Free (BYOK only) | No platform limit; user's provider limit applies    |
| Pro              | 500 generation requests/month on platform key quota |

Rate limit state tracked in `ai_generation_records`; counter per user per month reset on 1st of month.

### 6.2 Token Buckets

- **Per-user generation throttle:** Max 1 concurrent generation job per user
- **SQS consumer:** Max 5 concurrent Lambda/SQS workers processing the queue
- **Secrets Manager:** 10 req/s per account (AWS default); keys fetched just-in-time with circuit breaker

### 6.3 Circuit Breaker

For Secrets Manager fetches and AI provider calls:

```typescript
// Using NestJS CircuitBreaker module
@CircuitBreaker({ timeout: 3000, threshold: 5, resetTimeout: 30000 })
async getByokKey(userId: string, provider: Provider): Promise<string>
```

### 6.4 Privacy / PII Sanitization

**Mandatory before any prompt construction:**

1. `SanitizeService.sanitizeContext()` — pseudonymizes identifiers
2. `SanitizeService.scanForPii()` — logs any PII hits to audit log (content not stored)
3. Prompt templates NEVER contain raw user data

**Audit log shape (metadata only, no prompt content):**

```typescript
await auditLog.record({
    requestId: uuid(),
    userId: userId,
    generationType: 'recipe',
    provider: 'openai',
    sourceHash: sha256(sanitizedPrompt), // reproducible for audit, no raw content
    piiDetected: false,
    timestamp: new Date().toISOString(),
});
```

### 6.5 EU AI Act Compliance

**Effective August 2, 2026.**

- All AI-generated recipe/meal plan outputs display: _"AI-generated content may be inaccurate. Verify before use."_
- Nutrition advice outputs (if any): _"This is not medical advice. Consult a qualified professional."_
- Transparent disclosure in app UI when AI is generating content (loading states)
- `ai_generation_records.source_prompt_hash` provides audit trail for regulatory inquiry
- Anthropic/Claude and OpenAI are the two providers with best compliance postures (SCCs available, ZDR options)

---

## 7. Migration / Schema Changes

### 7.1 Drizzle Migration: `005_ai_integration`

```typescript
// src/db/migrations/005_ai_integration.ts
export async function up(db: DB) {
    // ai_generation_records
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_generation_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) COLLATE "C" NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
      job_id UUID NOT NULL UNIQUE,
      generation_type TEXT NOT NULL CHECK (generation_type IN ('recipe', 'meal_plan', 'shopping_list', 'nutrition_analysis')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'streaming', 'complete', 'failed')),
      provider TEXT NOT NULL,
      model_id TEXT,
      input_token_count INT,
      output_token_count INT,
      estimated_cost_usd NUMERIC(8, 6),
      source_prompt_hash TEXT,
      output_recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
      output_meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
      error_message TEXT,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_gen_records_user_sub ON ai_generation_records(user_sub);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_gen_records_job_id ON ai_generation_records(job_id);`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ai_gen_records_status ON ai_generation_records(status);`);

    // prompt_templates
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key TEXT NOT NULL UNIQUE,
      version INT NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      model_recommendations TEXT[],
      is_active BOOLEAN DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    // user_byok_keys
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_byok_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) COLLATE "C" NOT NULL UNIQUE REFERENCES users(sub) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      secret_arn TEXT NOT NULL,
      key_version INT NOT NULL DEFAULT 1,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

    // mcp_oauth_consents
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mcp_oauth_consents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_sub VARCHAR(255) COLLATE "C" NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      granted_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      refresh_token_encrypted TEXT,
      last_used_at TIMESTAMPTZ,
      is_revoked BOOLEAN DEFAULT false
    );
  `);
}
```

### 7.2 AWS Resources

| Resource                   | Type                       | Name                        |
| -------------------------- | -------------------------- | --------------------------- |
| SQS Queue                  | `AWS::SQS::Queue`          | `ai-generation-queue`       |
| SQS DLQ                    | `AWS::SQS::Queue`          | `ai-generation-dlq`         |
| SNS Topic                  | `AWS::SNS::Topic`          | `ai-events`                 |
| IAM Role (queue consumer)  | `AWS::IAM::Role`           | `ai-generation-worker-role` |
| Secrets Manager (per-user) | Created at runtime via SDK | `byok/{userId}/{provider}`  |

Secrets Manager key deletion policy: key is deleted when user removes BYOK key from settings. Secrets Manager automatic rotation is NOT enabled (user-provided keys cannot be rotated by the platform).

---

## 8. Open Questions from Research

| #    | Question                                                                                                                                                                                                | Status | Notes                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| OQ-1 | **Which GCP region for Gemini?** Gemini is GCP-native; us-east1 vs us-central1 has pricing/availability implications. Decision needed before GA.                                                        | Open   | Monitor Gemini regional availability in AWS regions we use.     |
| OQ-2 | **Platform key quota enforcement granularity?** Do we track by generation _type_ (recipe vs meal plan) or total count?                                                                                  | Open   | Per-type tracking is more complex but fairer. Total is simpler. |
| OQ-3 | **MCP OAuth client registration UI?** External agents need a `client_id`/`client_secret` per integration. Self-service registration portal or email-request?                                            | Open   | Recommend: self-service portal in app settings.                 |
| OQ-4 | **Prompt template versioning strategy?** Do we allow users to fork and customize system prompts? If yes, user-specific template overrides need a `created_by = userId` path.                            | Open   | V2 scope. V1: platform-only templates with versioned updates.   |
| OQ-5 | **Anthropic data processing agreement?** Has the legal team executed OpenAI DPA + SCCs? Is there an Anthropic DPA? Required before EU user prompts can flow.                                            | Open   | Block EU AI features until DPA is executed.                     |
| OQ-6 | **Nutrition advice AI risk classification?** Under EU AI Act, nutrition advice touching medical conditions may be **high-risk**. Is Commise claiming to give medical advice, or is it general wellness? | Open   | Classification determines mandatory conformity assessment.      |

---

## 9. Implementation Order

### Phase 5A: Foundation (Weeks 1–2)

1. **DB migration** — create all 4 new tables
2. **BYOK module** — `ByokService` + AWS Secrets Manager CRUD
3. **Sanitize module** — PII detection + pseudonymization (baseline patterns)
4. **Drizzle schema definitions** — `AiGenerationRecord`, `PromptTemplate`, `UserByokKey`, `McpOAuthConsent`

### Phase 5B: Core Generation (Weeks 3–4)

5. **`AiService` core** — `generateRecipe()` using Vercel AI SDK + Zod schema
6. **Recipe SSE streaming** — `POST /ai/generate/recipe/stream`
7. **Async job queue** — SQS enqueue + consumer Lambda/SQS worker
8. **Poll endpoint** — `GET /ai/generate/recipe/:jobId`

### Phase 5C: Extended Generation (Week 5)

9. **Meal plan generation** — `POST /ai/generate/meal-plan` with SSE
10. **Shopping list generation** — `POST /ai/generate/shopping-list`
11. **Prompt template CMS** — `GET/PUT /ai/prompts/:key`

### Phase 5D: External Agent / MCP (Weeks 6–7)

12. **Clerk MCP integration** — OAuth 2.1 + PKCE consent flow
13. **MCP server** — JSON-RPC 2.0 handler, tool definitions for recipes + meal plans
14. **OAuth consent management UI** — app settings page for external agent connections

### Phase 5E: Compliance & Polish (Week 8)

15. **EU AI Act disclosures** — AI-generated content watermarks + disclaimer strings
16. **Audit log integration** — `ai_generation_records` writes for all generations
17. **Circuit breakers + rate limit middleware**
18. **E2E tests** — BYOK flow, SSE streaming, MCP OAuth flow

---

## 10. Acceptance Criteria

| ID    | Criterion                                                                                  | Verification                  |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| AC-1  | User can store an OpenAI key and generate a recipe via `/ai/generate/recipe`               | E2E test                      |
| AC-2  | Raw API key is never stored in Postgres (only Secrets Manager ARN)                         | Code inspection               |
| AC-3  | SSE streaming returns partial recipe objects in real-time                                  | E2E test with network capture |
| AC-4  | SQS queue processes async job and stores result in `recipes` table                         | Integration test              |
| AC-5  | PII scan detects email + name patterns before prompt construction                          | Unit test                     |
| AC-6  | EU AI Act disclaimer appears on all AI-generated content                                   | Visual E2E test               |
| AC-7  | MCP OAuth 2.1 PKCE flow completes; agent can call tools with Bearer token                  | E2E test                      |
| AC-8  | BYOK key deleted from Secrets Manager on `DELETE /ai/byok/keys/:provider`                  | Integration test              |
| AC-9  | `GET /ai/generate/recipe/:jobId` returns correct status through pending→complete lifecycle | E2E test                      |
| AC-10 | Clerk MCP guard rejects requests without valid `Authorization: Bearer <token>`             | Security test                 |
