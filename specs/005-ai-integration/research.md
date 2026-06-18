# Research: AI Integration — BYOK Recipe Generation & External Agent Platforms

**Feature**: `005-ai-integration`
**Date**: 2026-05-08
**Status**: Complete
**Scope**: BYOK AI recipe generation (OpenAI/Claude), external agent platform OAuth (MCP), meal plan / shopping list / nutrition AI, user data privacy in AI pipelines, NestJS integration architecture.

---

## 1. Competitor Analysis

### 1.1 Paprika Recipe Manager 3

**AI posture**: Minimal generative AI. Paprika's "AI" is a structured web-scraping parser that extracts recipe fields (title, ingredients, instructions, photos) from arbitrary web pages. No LLM-based generation, no meal plan AI, no nutrition advice. The value proposition is organization + sync, not generation.

**Business model**: One-time purchase per platform (~$4.99–$9.99). No subscription, no AI upsell. This is a deliberate anti-AI stance — the 2026 review cycle consistently praises Paprika for _not_ requiring a subscription while competitors add AI tiers.

**Competitive gap**: Paprika has zero AI generation. Any app offering BYOK recipe generation immediately differentiates on this axis.

### 1.2 Mealime

**AI posture**: No AI generation as of 2026. Mealime is explicitly categorized as "manual selection" in the 2026 AI meal planning app comparison landscape. Users choose from a curated recipe library filtered by dietary preferences. The "personalization" is rule-based filtering (diet type, allergies, disliked ingredients), not LLM generation.

**Strengths**: 5M+ downloads, polished UX, grocery delivery integrations (Kroger, Walmart, Amazon Fresh, Instacart). Strong for users who want to choose their own meals.

**Competitive gap**: No AI meal generation, no multi-person planning, no macro optimization. A BYOK AI layer on top of a recipe corpus would directly address Mealime's stated weaknesses.

### 1.3 Samsung Food (formerly Whisk)

**AI posture**: The most AI-forward competitor. Samsung Food uses "Food AI" (Whisk's proprietary system, acquired 2019) for:

- **Personalize Recipe**: Converts saved recipes to vegan/vegetarian, adjusts nutrition balance, creates fusion variants, adjusts cook time/skill level
- **AI meal planning**: Recommendations based on user data, dietary preferences, cuisine types
- **Vision AI** (2024): Camera-based food recognition → nutrition info + recipe suggestions
- **Samsung TV integration** (CES 2025): AI recognizes food on-screen and pulls up the recipe

**Key insight**: Samsung Food's AI is _platform-provided_ (not BYOK). Users cannot bring their own OpenAI key. The AI is opaque — users cannot inspect or modify prompts. This is the exact opposite of the BYOK model.

**Competitive gap**: Samsung Food's AI is locked to Samsung's infrastructure and Samsung device ecosystem. A BYOK model gives power users (developers, nutrition-focused users, enterprise) full control over model choice, prompt customization, and data routing — none of which Samsung Food offers.

### 1.4 ChefGPT API

**What it is**: A dedicated food AI API (not a consumer app) offering:

- `recipe-from-ingredients`: Generate recipes from available ingredients
- `recipe`: Generate by criteria (diet, servings, prep time, difficulty, allergies, language)
- `recipe-from-macros`: Generate by macronutrient targets
- `meal-plan`: Full meal plan generation
- `pairings`: Wine/beer pairings
- `recipe-images`: AI image generation for recipes

**Pricing**: $19.99/mo (1,000 req) → $99.99/mo (10,000 req) → Enterprise (unlimited). Pro plan required for meal plans.

**Response schema** (JSON):

```json
{
    "recipeName": "string",
    "difficulty": "intermediate",
    "kitchenToolsUsed": ["Saucepan"],
    "instructions": ["1. Boil pasta."],
    "preparationTime": 30,
    "servings": 4,
    "recipeCategory": ["dinner"],
    "recipeCuisine": ["italian"],
    "ingredients": [{ "name": "Pasta", "unit": "grams", "amount": 250 }],
    "macros": {
        "carbs": { "amount": 45, "unit": "grams" },
        "fats": { "amount": 10, "unit": "grams" },
        "proteins": { "amount": 8, "unit": "grams" },
        "calories": { "amount": 280, "unit": "kcal" }
    }
}
```

**Critical limitation**: ChefGPT's ToS explicitly prohibits automated/programmatic requests for data collection or storage. Data returned can only be presented to the human end-user who initiated the request and **cannot be stored** unless explicitly permitted. This makes ChefGPT unsuitable as a backend generation engine for a recipe management app — the core use case is storing generated recipes.

**Verdict**: ChefGPT is a consumer-facing widget product, not a B2B API for recipe apps. Direct OpenAI/Anthropic integration is the correct path.

---

## 2. BYOK Model vs Platform-Provided AI

### 2.1 Industry Standard in 2026

The BYOK model has become the dominant pattern for AI SaaS targeting technical/power users. The economics are clear:

| Aspect         | Platform-Provided AI           | BYOK Model                           | Hybrid          |
| -------------- | ------------------------------ | ------------------------------------ | --------------- |
| Gross margin   | 40–55% (API costs eat revenue) | ~80% (pure software margin)          | Mixed           |
| User trust     | Data routes through your infra | Direct provider connection           | User choice     |
| Scale risk     | Power users can bankrupt you   | Zero variable cost to platform       | Quota + BYOK    |
| Audience       | Mass market                    | Technical users                      | Both            |
| GDPR liability | You are data controller for AI | User is controller of AI interaction | Depends on mode |

**The liability shift is critical**: With a shared platform key, you own GDPR compliance for all AI-generated data and are liable for ToS violations. With BYOK, the API key holder (the user) is the controller of that AI interaction. Your role shifts to a processor. This changes your Terms of Service and DPA obligations substantially.

### 2.2 Recommended Architecture: Hybrid Model

```typescript
async function getApiClient(userId: string, provider: 'openai' | 'anthropic') {
    // First: check for user's own key (BYOK)
    const userKey = await getUserKey(userId, provider);
    if (userKey) {
        // User's own key — zero cost to platform, user is data controller
        return createClient(provider, decrypt(userKey.encryptedKey));
    }
    // Fall back to platform key with quota enforcement
    if (await checkPlatformQuota(userId)) {
        return createClient(provider, getPlatformKey(provider));
    }
    throw new HttpException('Add your own API key for unlimited access.', 402);
}
```

**Tier structure**:

- **Free**: BYOK only — user provides key, unlimited usage, user pays API costs directly
- **Pro ($X/mo)**: Optional platform key with monthly quota OR BYOK for unlimited
- **Enterprise**: Managed keys, dedicated support, compliance features

### 2.3 BYOK Key Storage: Security Requirements

**Never store API keys in plain text in your primary database.** The correct pattern uses a dedicated secrets vault:

**Option A — AWS Secrets Manager** (natural fit for this stack):

```typescript
// Store: write to Secrets Manager, save only the ARN in Postgres
const secretArn = await secretsManager.createSecret({
    Name: `byok/${userId}/openai`,
    SecretString: JSON.stringify({ apiKey: userProvidedKey }),
});
await db.update(users).set({ openaiSecretArn: secretArn }).where(eq(users.id, userId));

// Retrieve: fetch just-in-time, never cache in application memory
const secret = await secretsManager.getSecretValue({ SecretId: user.openaiSecretArn });
const { apiKey } = JSON.parse(secret.SecretString);
```

**Option B — Infisical** (open-source, end-to-end encrypted):

- Store path `byok/tenant/{userId}/openai` in Infisical vault
- Save only the path reference in Postgres
- Fetch just-in-time via Infisical SDK

**AWS Secrets Manager is the recommended choice** given the existing AWS stack (RDS, S3, SQS). It provides audit trails, IAM-based access control, automatic rotation support, and no additional infrastructure.

---

## 3. OpenAI / Claude API Integration Patterns

### 3.1 NestJS Module Architecture

The canonical NestJS pattern for Claude/OpenAI integration uses a custom provider token for testability:

```typescript
// src/ai/ai.module.ts
export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';
export const OPENAI_CLIENT = 'OPENAI_CLIENT';

@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: ANTHROPIC_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const apiKey = config.get<string>('anthropic.apiKey');
                if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
                return new Anthropic({ apiKey });
            },
        },
        {
            provide: OPENAI_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                return new OpenAI({ apiKey: config.get<string>('openai.apiKey') });
            },
        },
        AiService,
    ],
    exports: [ANTHROPIC_CLIENT, OPENAI_CLIENT, AiService],
})
export class AiModule {}
```

**For BYOK**: The module provides _platform_ clients. A separate `ByokAiService` resolves the user's key at request time and instantiates a per-request client — it does not use the module-level singleton.

### 3.2 Structured Output for Recipe Generation

**Recommended approach**: Vercel AI SDK (`ai` package) with Zod schemas. This gives provider flexibility (OpenAI structured outputs where available, Zod validation + retry for Claude) with a single API surface.

```typescript
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const RecipeSchema = z.object({
    name: z.string().describe('Recipe title'),
    description: z.string().describe('Brief description'),
    servings: z.number().int().min(1).max(20),
    prepTimeMinutes: z.number().int().min(0),
    cookTimeMinutes: z.number().int().min(0),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    cuisine: z.string().optional(),
    tags: z.array(z.string()),
    ingredients: z.array(
        z.object({
            name: z.string(),
            amount: z.number(),
            unit: z.string(),
            notes: z.string().optional(),
        }),
    ),
    instructions: z.array(
        z.object({
            step: z.number().int(),
            text: z.string(),
            durationMinutes: z.number().optional(),
        }),
    ),
    nutrition: z
        .object({
            calories: z.number(),
            proteinG: z.number(),
            carbsG: z.number(),
            fatG: z.number(),
            fiberG: z.number().optional(),
            sodiumMg: z.number().optional(),
        })
        .optional(),
});

export type GeneratedRecipe = z.infer<typeof RecipeSchema>;

// The AI SDK automatically uses OpenAI Structured Outputs for gpt-4o+
// and falls back to prompt-based JSON + Zod validation for Claude
const { object } = await generateObject({
    model: userKey?.provider === 'anthropic' ? anthropic('claude-opus-4-6') : openai('gpt-4o'),
    schema: RecipeSchema,
    prompt: buildRecipePrompt(userRequest),
});
```

**Why not ChefGPT or other food-specific APIs**: Storage prohibition in ToS, no BYOK, no prompt customization, vendor lock-in, and pricing that doesn't scale with user-provided keys.

### 3.3 Streaming for Long Generations

Meal plans and shopping lists can be long. Use SSE streaming via NestJS `@Sse()`:

```typescript
// NestJS SSE endpoint
@Sse('generate/meal-plan/stream')
generateMealPlanStream(@Body() dto: MealPlanRequestDto): Observable<MessageEvent> {
  return this.aiService.streamMealPlan(dto).pipe(
    map(chunk => ({ data: chunk }))
  );
}

// Service using Vercel AI SDK streamObject
async *streamMealPlan(dto: MealPlanRequestDto) {
  const { partialObjectStream } = streamObject({
    model: await this.resolveModel(dto.userId),
    schema: MealPlanSchema,
    prompt: buildMealPlanPrompt(dto),
  });
  for await (const partial of partialObjectStream) {
    yield partial;
  }
}
```

---

## 4. OAuth with AI Platforms — External Agent Integration (MCP)

### 4.1 MCP Authorization Standard (2026)

The Model Context Protocol (MCP), developed by Anthropic, has become the standard for connecting AI agents to external tools and data sources. As of 2026, MCP authorization uses **OAuth 2.1 with PKCE** as the required mechanism (mandated in the March 2025 spec revision).

**Key requirements for an MCP server** (exposing KitchenSink to external AI agents):

1. Implement **OAuth 2.0 Protected Resource Metadata** (RFC 9728) — MCP clients discover your authorization server via `/.well-known/oauth-protected-resource`
2. Support **Resource Indicators** (RFC 8707) — tokens are audience-bound to your specific MCP server URI, preventing token mix-up attacks
3. Use **OAuth 2.1** (PKCE mandatory for all clients, no implicit grant, no resource owner password flow)
4. Expose tools via JSON-RPC 2.0

**Clerk integration** (already in the stack from feature 002): Clerk acts as the OAuth 2.1 authorization server for this spec:

- Standards-based discovery and OAuth client registration
- Resource-scoped tokens (scopes/permissions carried in the session token's `public_metadata` claim)
- The MCP server verifies presented session tokens networklessly via `verifyToken` (`@clerk/backend`) using the public `CLERK_JWT_KEY`, enforcing authorized parties (`azp`) via `CLERK_AUTHORIZED_PARTIES`
- The Clerk Backend API (`@clerk/backend`) is used off the hot path for any management operations

```typescript
// MCP server tool definition example
// External agents (Claude Desktop, Cursor, custom agents) can call these
const tools = {
    generateRecipe: {
        description: 'Generate a recipe based on ingredients and preferences',
        inputSchema: {
            type: 'object',
            properties: {
                ingredients: { type: 'array', items: { type: 'string' } },
                dietary: { type: 'string', enum: ['vegetarian', 'vegan', 'keto', 'paleo'] },
                servings: { type: 'number' },
            },
            required: ['ingredients'],
        },
    },
    getMealPlan: {
        description: 'Retrieve or generate a meal plan for a date range',
        // ...
    },
};
```

### 4.2 OAuth Flow for External Agents

```
External Agent (Claude Desktop / custom)
  │
  ├─► GET /.well-known/oauth-protected-resource
  │     ← { authorization_servers: ["https://clerk.commise.app"] }
  │
  ├─► GET https://clerk.commise.app/.well-known/oauth-authorization-server
  │     ← { authorization_endpoint, token_endpoint, ... }
  │
  ├─► Authorization Code + PKCE flow (user consents in browser)
  │     scope: "recipes:read recipes:write meal-plans:read"
  │     resource: "https://api.commise.io/mcp"  ← RFC 8707
  │
  ├─► POST /token → access_token (audience-bound to MCP server URI)
  │
  └─► MCP tool calls with Bearer token
        KitchenSink MCP server validates token, enforces scopes
```

**Cross-App Access (XAA / SEP-990)**: For multi-agent workflows, the 2026 MCP spec supports Identity Assertion Authorization Grant — an agent carries verified user identity across multiple services without re-authentication. Relevant if KitchenSink integrates with external nutrition or grocery services.

---

## 5. Prompt Engineering for Recipe/Nutrition Contexts

### 5.1 System Prompt Structure

Effective food AI prompts follow a role + boundary + format pattern:

```
You are a culinary assistant for [AppName]. You help users generate recipes,
meal plans, and nutrition guidance.

CONSTRAINTS:
- Generate only recipes appropriate for home cooking
- Always include complete ingredient lists with measurements
- Nutrition values must be estimates — include a disclaimer
- Do not provide medical nutrition advice or therapeutic diet plans
- If the user has stated allergies: [ALLERGY_LIST], never include those ingredients
- Output must conform exactly to the provided JSON schema

USER CONTEXT:
- Dietary preference: [DIET_TYPE]
- Servings: [SERVINGS]
- Available ingredients: [INGREDIENT_LIST]
- Cuisine preference: [CUISINE]
- Skill level: [SKILL_LEVEL]
```

**Key principles from research**:

1. **Define the content class first** (recipe generation vs nutrition advice vs meal planning) — each has different risk levels and review requirements
2. **Explicit boundaries**: Tell the model what it may NOT do (medical advice, therapeutic claims, condition-specific recommendations)
3. **Structured output mandate**: Always specify JSON schema in the prompt AND use API-level structured outputs
4. **Missing context handling**: Prompt the model to list missing information rather than invent assumptions (e.g., ask about allergies before generating)
5. **Two-pass for nutrition**: Generate recipe first, then run a second pass to audit for unsupported nutritional claims

### 5.2 Recipe-Specific Prompt Patterns

**From-ingredients pattern** (most common):

```
I have: [INGREDIENT_LIST]
Generate a [CUISINE] [MEAL_TYPE] recipe for [SERVINGS] people.
Prep time under [MINUTES] minutes. Difficulty: [LEVEL].
Exclude: [ALLERGIES/DISLIKES].
```

**Macro-constrained pattern** (nutrition feature):

```
Generate a [MEAL_TYPE] recipe meeting these macro targets per serving:
- Protein: [X]g minimum
- Carbohydrates: [X]g maximum
- Fat: [X]g maximum
- Calories: [X] kcal (±10%)
Dietary restriction: [DIET_TYPE]
```

**Recipe revision pattern** (from academic research on LLM recipe revision):
The most effective prompts for recipe revision include:

- Explicit list of valid operations (keep, delete, revise, split, add, combine)
- Demonstrations of each operation
- Original ingredients list as grounding context
- Constraint that revised steps must produce the same dish

### 5.3 Nutrition Advice Safety Boundaries

**Critical**: Nutrition advice that touches medical conditions (diabetes, eating disorders, GLP-1 protocols, therapeutic diets) requires explicit guardrails:

```typescript
const NUTRITION_SYSTEM_PROMPT = `
You are a general wellness cooking assistant, NOT a clinician or registered dietitian.

HARD LIMITS — never cross these:
- Do not provide personalized medical nutrition therapy
- Do not recommend specific supplements, medications, or therapeutic protocols
- Do not make claims about treating, curing, or managing medical conditions
- For any query involving a medical condition, redirect to a qualified professional

SOFT LIMITS — include disclaimers:
- Calorie and macro estimates are approximate (±15%)
- Individual nutritional needs vary; consult a professional for personalized guidance
`;
```

---

## 6. Data Privacy in AI Pipelines

### 6.1 The Core Problem

~8.5% of prompts submitted to LLM tools contain sensitive information (PII, credentials, internal data). In a recipe app, the sensitive data includes:

- User dietary restrictions and health conditions (potentially special-category data under GDPR)
- Allergy information (health data)
- User names and account identifiers in prompt context
- Meal history that could reveal health conditions

### 6.2 GDPR Compliance Requirements (2026)

**Sending data to OpenAI/Anthropic API = cross-border data transfer to a third-party processor under GDPR.** Required steps:

1. **Data Processing Agreement (DPA)**: Execute OpenAI's DPA with Standard Contractual Clauses before any EU user data enters prompts
2. **Zero Data Retention**: Request ZDR from OpenAI (`api-compliance@openai.com`) — by default OpenAI retains API inputs/outputs for 30 days for abuse monitoring. ZDR eliminates this.
3. **Anthropic**: Review Anthropic's data usage policies; enterprise agreements include no-training guarantees
4. **EU AI Act (August 2, 2026)**: Recipe generation AI is likely limited-risk (transparency disclosure required). Nutrition advice touching medical conditions may require higher classification review.

### 6.3 PII Sanitization Layer (Required)

A sanitization layer must sit between the application and the LLM API call:

```typescript
// Pseudonymization before prompt construction
function sanitizePromptContext(userId: string, context: RecipeContext): SanitizedContext {
    return {
        // Replace direct identifiers with stable tokens
        userRef: `USER_${hashUserId(userId)}`, // never the real user ID
        // Health data: use categories, not specific conditions
        dietaryProfile: context.dietaryPreferences, // "vegetarian", not "diabetic type 2"
        allergies: context.allergies, // safe to include — needed for recipe safety
        // Never include: email, name, account number, health conditions
    };
}

// Audit log: metadata only, never raw prompts
await auditLog.record({
    requestId: uuid(),
    userId: userId, // for DSAR compliance
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
    timestamp: new Date().toISOString(),
    // NOT: the actual prompt text
});
```

### 6.4 BYOK Privacy Advantage

With BYOK, the user's data goes directly from KitchenSink's backend to the user's own API account at OpenAI/Anthropic. The user is the data controller for that AI interaction. This:

- Shifts GDPR controller liability to the user for the AI processing step
- Eliminates the need for KitchenSink to execute a DPA on behalf of users (users have their own agreements with providers)
- Increases user trust — their data doesn't pass through a third-party intermediary

**This is a significant privacy selling point for BYOK mode.**

---

## 7. NestJS Monorepo Integration Architecture

### 7.1 Module Placement

```
src/
├── ai/
│   ├── ai.module.ts          # Provider tokens, client factories
│   ├── ai.service.ts         # Platform-key AI calls (quota-gated)
│   ├── byok-ai.service.ts    # BYOK key resolution + per-request clients
│   ├── prompt-builder/
│   │   ├── recipe.prompts.ts
│   │   ├── meal-plan.prompts.ts
│   │   └── nutrition.prompts.ts
│   ├── schemas/
│   │   ├── recipe.schema.ts  # Zod schemas (shared with DTOs)
│   │   ├── meal-plan.schema.ts
│   │   └── nutrition.schema.ts
│   └── sanitizer/
│       └── prompt-sanitizer.service.ts  # PII removal before API calls
├── byok/
│   ├── byok.module.ts
│   ├── byok.controller.ts    # POST /byok/keys, DELETE /byok/keys/:provider
│   ├── byok.service.ts       # AWS Secrets Manager integration
│   └── byok.dto.ts
├── mcp/
│   ├── mcp.module.ts
│   ├── mcp.server.ts         # MCP tool definitions + JSON-RPC handler
│   └── mcp-auth.guard.ts     # OAuth 2.1 token validation for MCP
```

### 7.2 AI Generation vs Traditional CRUD

**Traditional CRUD** (synchronous, deterministic):

- Recipe save/update/delete
- Ingredient management
- Meal plan scheduling
- Shopping list management

**AI Generation** (async, non-deterministic, expensive):

- Recipe generation from ingredients/criteria
- Meal plan generation
- Shopping list optimization
- Nutrition analysis and advice
- Recipe variation/adaptation

**Architectural rule**: AI generation endpoints are always async. They:

1. Accept a request, return a `jobId` immediately (202 Accepted)
2. Process via SQS queue (already in stack from feature 001) or stream via SSE
3. Store results in the recipe/meal-plan tables as normal CRUD objects
4. The generated content becomes a first-class entity — indistinguishable from manually created content after generation

```typescript
// POST /recipes/generate → 202 { jobId }
// GET  /recipes/generate/:jobId → { status: 'pending' | 'complete' | 'failed', recipeId? }
// SSE  /recipes/generate/stream → real-time partial recipe object

// After generation, the recipe is stored via the standard recipe service
// AI provenance is tracked in a metadata field, not a separate table
```

### 7.3 Provider Abstraction

To avoid coupling to a single LLM provider:

```typescript
interface AiProvider {
    generateRecipe(prompt: RecipePrompt): Promise<GeneratedRecipe>;
    generateMealPlan(prompt: MealPlanPrompt): Promise<GeneratedMealPlan>;
    streamRecipe(prompt: RecipePrompt): AsyncIterable<Partial<GeneratedRecipe>>;
}

// Implementations: OpenAiProvider, AnthropicProvider, ByokOpenAiProvider, ByokAnthropicProvider
// The Vercel AI SDK's generateObject/streamObject handles the abstraction internally
```

---

## 8. Key Decisions & Recommendations

| Decision                     | Recommendation                                              | Rationale                                                               |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| AI model strategy            | Multi-provider (OpenAI + Anthropic) via Vercel AI SDK       | Provider flexibility, best structured output support, single API        |
| BYOK key storage             | AWS Secrets Manager (ARN reference in Postgres)             | Native to existing AWS stack, audit trails, IAM access control          |
| BYOK business model          | Hybrid: free tier BYOK-only, pro tier platform quota + BYOK | Maximizes TAM while protecting margins                                  |
| Structured output            | Zod schemas + `generateObject` from Vercel AI SDK           | Provider-agnostic, TypeScript type inference, automatic retry           |
| External agent protocol      | MCP with OAuth 2.1 + PKCE via Clerk                         | Industry standard, Clerk already in stack (feature 002)                 |
| AI generation pattern        | Async (SQS queue) + SSE streaming option                    | Consistent with existing queue infrastructure, handles long generations |
| PII in prompts               | Sanitization layer + pseudonymization before API calls      | GDPR compliance, ZDR request to OpenAI                                  |
| Nutrition advice             | Hard guardrails in system prompt, no medical claims         | Liability, EU AI Act limited-risk classification                        |
| ChefGPT / food-specific APIs | Do not use                                                  | Storage prohibition in ToS, no BYOK, vendor lock-in                     |

---

## 9. Open Questions

1. **Model selection UX**: Should users choose their model (gpt-4o vs claude-opus) or should the app abstract this? Power users want control; casual users want simplicity. Recommendation: abstract by default, expose in advanced settings.

2. **Prompt customization**: The feature description mentions "user maintains control over AI prompts." How deep does this go? Custom system prompts per user? Per-recipe-type prompt templates? This needs product definition before implementation.

3. **AI-generated content provenance**: Should generated recipes be visually distinguished from imported/manual recipes in the UI? Affects feature 001 (recipe core) data model.

4. **Rate limiting for platform-key mode**: What is the monthly quota for pro tier? Needs cost modeling based on average tokens per recipe generation (~500–1,500 tokens) and meal plan (~2,000–5,000 tokens).

5. **EU AI Act classification**: Recipe generation is clearly limited-risk (transparency disclosure only). Nutrition advice that could influence health decisions may warrant a higher-risk review. Legal input needed before launch in EU.

6. **MCP scope definition**: Which KitchenSink capabilities should be exposed as MCP tools? Minimum viable: recipe search, recipe generation, meal plan read. Full scope: all CRUD + generation. Affects feature 001 and 006 APIs.
