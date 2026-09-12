# AI Enhancement Plan: Commise

## What the Current Spec Has vs. What the Market Demands

**Date**: June 6, 2026
**Status**: Draft — For Founder Review
**Input**: [Feature 005 spec](../specs/005-ai-integration/spec.md), competitive landscape research, cutting-edge AI cooking research (Sigma, TasteOS, recipe-api.com, Samsung AI Vision, GPT-4o Realtime, Vercel AI SDK)
**Related**: [Business Plan](./business-plan.md), [Competitive Analysis v2](./competitive-analysis-v2.md)

---

## 0. EXECUTIVE SUMMARY

Feature 005 spec covers the **basics** of AI integration: BYOK API keys, recipe generation from criteria, external agent OAuth, and instruction optimization. It's solid infrastructure — but it's 2024-era AI. The market has moved to:

1. **Multimodal cooking assistants** (voice + vision, real-time, hands-free)
2. **Taste personalization** (learning your palate, not just your pantry)
3. **Structured AI output** (validated recipes with USDA nutrition, not freeform text)
4. **Contextual intelligence** (camera sees your stove, suggests "flip it now")

**This document identifies 8 enhancement opportunities**, prioritized by competitive impact and implementation feasibility against your existing spec.

---

## 1. WHAT FEATURE 005 CURRENTLY SPECS

| Capability                                       | Spec'd?   | Details                                                |
| ------------------------------------------------ | --------- | ------------------------------------------------------ |
| BYOK API key storage (OpenAI, Anthropic, Gemini) | ✅ FR-015 | Encrypted in AWS Secrets Manager                       |
| Recipe generation from criteria                  | ✅ FR-016 | Ingredients, diet, cuisine, calories                   |
| Preview before save                              | ✅ FR-017 | Generated recipes are previewed, then optionally saved |
| External agent OAuth (ChatGPT, Gemini)           | ✅ FR-018 | Read/write scopes, explicit consent                    |
| Instruction optimization (premium)               | ✅ FR-019 | Simplify or streamline cooking steps                   |
| Private-by-default for AI recipes                | ✅ FR-020 | Agents can't set public visibility                     |
| Authorization revocation                         | ✅ FR-021 | Users can revoke agent access                          |
| Confidence indicator + guard message             | ✅ FR-022 | "AI-generated content may be inaccurate"               |

**What's NOT spec'd** (the gaps):

| Missing                              | Why It Matters                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Structured output validation         | AI returns freeform text → no guarantee it's a valid recipe. No nutrition. No USDA cross-check.                 |
| Taste profile / preference learning  | AI treats every user identically. No learning from ratings, cooking history, or preferences.                    |
| Multimodal input (photo → recipe)    | Users can't photograph ingredients and get recipe suggestions.                                                  |
| Real-time voice cooking assistant    | Cooking mode (Feature 008) is step-by-step UI. No voice interaction. No camera awareness.                       |
| Pantry-aware generation              | FR-016 says "based on criteria" but doesn't specify cross-referencing against pantry inventory (Feature 006).   |
| Ingredient substitution intelligence | No "I'm out of X, what can I use?" capability integrated with USDA data.                                        |
| Meal plan AI generation              | Feature 006 (Meal Planning) exists but doesn't spec AI generating a full week's plan from preferences + pantry. |
| YouTube/video → recipe extraction    | Sigma proved this works (Gemini watches video → extracts steps). Feature 004 imports from URLs but not video.   |

---

## 2. THE 8 AI ENHANCEMENTS

### Enhancement 1: Structured Recipe Output with USDA Validation 🔴 P0

**What**: Instead of letting the AI return freeform text, force structured JSON output via Vercel AI SDK's `generateObject()` with a Zod schema. Then cross-validate every ingredient against USDA food data (Feature 003).

**Why**: This is your **quality moat**. ChatGPT fails 12-36% of recipes (NSF study). Structured output + USDA validation = "recipes that actually work."

**How it changes the spec**:

```typescript
// BEFORE (current spec): Freeform text from AI
const response = await ai.chat('Generate an Italian dinner recipe');

// AFTER (enhanced): Structured output with Zod schema
import { generateObject } from 'ai';
import { z } from 'zod';

const RecipeSchema = z.object({
    name: z.string(),
    description: z.string(),
    cuisine: z.string(),
    difficulty: z.enum(['Easy', 'Intermediate', 'Advanced']),
    totalTimeMinutes: z.number(),
    servings: z.number(),
    ingredients: z.array(
        z.object({
            name: z.string(),
            amount: z.string(),
            unit: z.string(),
            usdaMatch: z.string().optional(), // FDC ID from Feature 003
            isOptional: z.boolean().default(false),
        }),
    ),
    steps: z.array(
        z.object({
            order: z.number(),
            instruction: z.string(),
            durationMinutes: z.number().optional(),
            temperature: z.string().optional(),
            technique: z.string().optional(), // "sauté", "braise", etc.
        }),
    ),
    nutritionPerServing: z
        .object({
            calories: z.number(),
            protein: z.number(),
            carbs: z.number(),
            fat: z.number(),
            fiber: z.number().optional(),
        })
        .optional(),
    tags: z.array(z.string()),
    confidence: z.number().min(0).max(1), // AI self-assessed confidence
});

const { object: recipe } = await generateObject({
    model: userProvider, // BYOK
    schema: RecipeSchema,
    prompt: `Generate a recipe for: ${userCriteria}
    Available pantry items: ${pantryIngredients}
    Dietary restrictions: ${dietaryRestrictions}
    USDA food database available for ingredient validation.`,
});
```

**USDA cross-validation step** (post-generation):

```typescript
// Cross-check each ingredient against USDA FDC database
for (const ing of recipe.ingredients) {
    const usdaMatch = await usdaService.search(ing.name);
    if (usdaMatch) {
        ing.usdaMatch = usdaMatch.fdcId;
        // Replace AI-estimated nutrition with USDA-calculated values
    } else {
        // Flag ingredient as unverified
        recipe.confidence *= 0.9; // Reduce confidence
    }
}
```

**Impact**: Every recipe Commise generates is **structured, parseable, and nutritionally verified**. No competitor does this. Recipe-API.com charges for this exact capability ($0.05/generation). Commise does it for free (BYOK).

**New FR**: "System MUST validate AI-generated recipe ingredients against USDA food data (Feature 003) and display a confidence score based on match rate. Recipes below 80% confidence MUST display a warning."

**Implementation effort**: Medium. Requires extending FR-016's generation pipeline. The Zod schema + `generateObject` pattern is well-documented in Vercel AI SDK. USDA cross-reference uses Feature 003's existing `usdaService.search()`.

**When**: Fold into M5 (Isengard) alongside Feature 005. This is the core of AI integration — it should ship with it, not after.

---

### Enhancement 2: Taste Profile / Preference Learning 🟡 P1

**What**: Build a "Taste Fingerprint" (TasteOS's term) — a vector representation of each user's flavor preferences, cuisine affinities, cooking skill level, and ingredient preferences. Every recipe rating, cooking session, and saved recipe feeds the profile. AI generation queries this profile.

**Why**: Every AI recipe app generates the same recipes for everyone. TasteOS is the only competitor doing personalization, and they're small. If Commise learns your palate, the recipes get better every week. ChatGPT can't do this — it has no taste memory.

**How it changes the spec**:

```
Current: AI generates recipe from criteria (ingredients, diet, cuisine)
Enhanced: AI generates recipe from criteria + taste profile + pantry state + cooking history
```

**New entities**:

| Entity           | Fields                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TasteProfile** | `userId`, `flavorVector` (embedding), `cuisineAffinities` (map), `excludedIngredients[]`, `preferredTechniques[]`, `spiceLevel`, `cookingSkill`, `lastUpdated` |
| **TasteSignal**  | `userId`, `recipeId`, `rating`, `cookedAt`, `wouldCookAgain`, `modifiedSteps[]`                                                                                |

**Signal sources**:

- Recipe ratings (1-5 stars) → cuisine/technique affinity
- Recipes cooked more than once → strong positive signal
- Recipes saved but never cooked → weak positive, possible aspirational bias
- Recipes started but abandoned → negative signal
- Substitutions made during cooking → ingredient preference data
- Dietary restrictions from Feature 006 (Meal Planning) → hard constraints

**Prompt enhancement**:

```typescript
const prompt = `Generate a recipe for: ${criteria}
  User's taste profile:
  - Preferred cuisines: ${profile.cuisineAffinities.top(3)}
  - Cooking skill: ${profile.cookingSkill}
  - Spice tolerance: ${profile.spiceLevel}/5
  - Recently cooked: ${recentRecipes.map((r) => r.name).join(', ')}
  - Available pantry: ${pantryItems}
  - Ingredients to prioritize (expiring soon): ${expiringItems}
  - Never suggest: ${profile.excludedIngredients}`;
```

**Impact**: Commise's recipes improve with every session. Competitors start from scratch every time.

**Implementation effort**: Medium-High. Requires a new `taste-profile` service, embedding generation, and integration into the AI prompt pipeline. The profile itself is relatively simple (a few database tables + vector). The complexity is in the signal processing.

**When**: v1.1 (post-1.0). The AI generation works without it. The taste profile makes it better. Ship the basic structure in M5, enhance signals post-launch.

---

### Enhancement 3: Pantry-Aware Recipe Generation 🔴 P0

**What**: When a user requests a recipe, the AI prompt automatically includes their pantry contents (from Feature 006/007) and prioritizes ingredients that are expiring soon. Generated recipes use what they already have.

**Why**: This is the **#1 reason** people use AI cooking apps — "what can I make with what I have?" The current spec (FR-016) says "based on criteria" but doesn't specify pantry integration. Without this, Commise generates recipes that require a grocery run — defeating the point.

**How it changes the spec**:

```typescript
// New FR: "System MUST query the user's pantry inventory (Feature 006)
// and include available ingredients in the AI generation prompt.
// Ingredients within 3 days of expiry MUST be prioritized.
// Generated recipes MUST indicate which ingredients come from pantry
// vs. need to be purchased."
```

**Prompt enhancement**:

```typescript
const prompt = `Generate a recipe using these available ingredients:
  IN PANTRY (use these first):
  ${pantryItems.filter((p) => p.expiresIn <= 3).map((i) => `${i.name} (expires ${i.expiresIn} days)`)}
  
  ALSO AVAILABLE:
  ${pantryItems.filter((p) => p.expiresIn > 3).map((i) => i.name)}
  
  DIETARY: ${dietaryRestrictions}
  CUISINE PREFERENCE: ${cuisinePreference}
  
  RULES:
  - Maximize use of expiring ingredients
  - If additional ingredients are needed, list them separately as "need to buy"
  - Include quantities needed vs. quantities available`;
```

**Output enhancement**: Structured recipe includes `ingredients[].source: 'pantry' | 'need-to-buy'` so the UI can highlight what the user already has and auto-build a grocery list for what they don't.

**Impact**: This connects Feature 005 (AI) + Feature 006 (Pantry) + Feature 007 (Grocery Lists) into one seamless flow. It's the core loop: pantry → AI recipe → grocery list → Instacart order.

**Implementation effort**: Low. It's prompt engineering + one pantry query before AI generation. The hard part (pantry tracking) is already specced in Feature 006.

**When**: Fold into M5 (Isengard). This is essential, not optional.

---

### Enhancement 4: AI Meal Plan Generation 🟡 P1

**What**: One-click "plan my week" that generates a full 7-day meal plan from pantry state + taste profile + dietary targets + budget constraints. Each meal is a structured recipe that auto-populates the grocery list.

**Why**: Feature 006 (Meal Planning) exists but doesn't spec AI generation. It's a manual drag-and-drop calendar. Every competitor that does meal planning requires manual selection. AI-generated weekly plans = "tell me what to eat all week" in one button.

**How it changes the spec**:

```typescript
// New endpoint or extension of FR-016
POST /api/v1/ai/meal-plan
{
  days: 7,
  mealsPerDay: ["dinner"],  // or ["breakfast", "lunch", "dinner"]
  pantryAware: true,
  budgetPerMeal: 10,  // USD
  dietaryTargets: { calories: 2000, protein: 150, carbs: 200 },
  cuisineVariety: true,  // don't repeat cuisines
  leftoverReuse: true,   // Monday's dinner becomes Tuesday's lunch component
}

// Returns: structured meal plan with 7 recipes, each validated,
// with a consolidated grocery list (deduped, aisle-grouped)
```

**Leftover reuse** is the key differentiator: Monday's roasted chicken → Tuesday's chicken salad → Wednesday's chicken stock. No competitor does this. It requires the AI to understand ingredient yield across recipes.

**Impact**: This turns Commise from "recipe app" into "personal chef who plans your week." Massive time savings for busy professionals.

**Implementation effort**: Medium. It's a single AI prompt that generates multiple recipes in sequence, with a consolidation step for the grocery list. The structured output from Enhancement 1 makes this reliable.

**When**: v1.1 (post-1.0), or v1.0 if Feature 006's meal planning can be extended to include AI generation as a "smart suggest" button.

---

### Enhancement 5: Real-Time Voice Cooking Assistant (Phase 2) 🟢 P2

**What**: During cooking mode (Feature 008), enable a real-time voice conversation with the AI. User says "next step," "how long do I cook this?," "I'm out of butter, what can I use?" — AI responds via voice. Optional: camera feed for visual awareness ("is this golden brown enough?").

**Why**: The [Sigma project](https://github.com/juliobellano/Sigma) proved this works using Gemini Live API. It's the future of cooking apps. Samsung is building it into refrigerators. Commise's BYOK model means users can use GPT-4o Realtime or Gemini Live — whichever they have a key for.

**Key capabilities from Sigma's implementation**:

| Tool              | Trigger                   | What Happens                                  |
| ----------------- | ------------------------- | --------------------------------------------- |
| `set_timer`       | "set a 5 minute timer"    | Countdown in Cooking Mode                     |
| `find_substitute` | "I'm out of lemongrass"   | AI suggests substitute + checks pantry        |
| `how_to`          | "how do I dice an onion?" | AI generates a technique guide                |
| `check_step`      | "what step am I on?"      | AI reads current step from Cooking Mode state |
| `next_step`       | "I'm done with this"      | Advances Cooking Mode                         |

**Technical architecture**:

```
User voice → WebRTC/WebSocket → BYOK provider (GPT-4o Realtime / Gemini Live)
                                         ↓
                              Tool calls back to Commise API
                              (pantry query, step navigation, timer)
                                         ↓
                              Voice response + Cooking Mode UI update
```

**Impact**: This is the "holy shit" feature. Nothing in the App Store does voice + pantry + recipe awareness. Samsung does it on a $4,000 refrigerator. Commise does it on a phone.

**Implementation effort**: HIGH. Requires real-time audio pipeline (WebRTC or WebSocket), tool-calling integration with Commise's API, and significant mobile engineering. Sigma's code is open-source and provides a reference architecture.

**When**: v2.0 (post-1.0, likely Month 8-12). Ship Cooking Mode (Feature 008) with basic step-by-step UI first, then add voice as an enhancement.

---

### Enhancement 6: Photo-to-Recipe AI (Extend Feature 004/011) 🟡 P1

**What**: User photographs ingredients on their counter → AI identifies what's there → suggests recipes using exactly those ingredients. Extends Feature 011 (Recipe Digitization) from "photo of a written recipe" to "photo of ingredients → recipe suggestion."

**Why**: Samsung's AI Vision does this on their refrigerators. Clove AI does "scan your pantry" with the camera. But nobody does "photograph your ingredients → generate a recipe from them" in one step.

**How**: Use GPT-4o's vision capabilities (already supported in BYOK model):

```typescript
const result = await generateObject({
    model: userProvider, // GPT-4o supports vision
    schema: IngredientListSchema,
    messages: [
        {
            role: 'user',
            content: [
                { type: 'image', image: photoBase64 },
                {
                    type: 'text',
                    text: 'Identify all food ingredients in this photo. Return each with name, estimated quantity, and estimated freshness.',
                },
            ],
        },
    ],
});

// Then feed identified ingredients into recipe generation
const recipe = await generateObject({
    model: userProvider,
    schema: RecipeSchema,
    prompt: `Generate a recipe using: ${result.ingredients.join(', ')}
    Dietary restrictions: ${user.dietary}
    Cooking skill: ${user.skill}`,
});
```

**Impact**: "Point your camera at the counter and get dinner" is the most intuitive cooking app UX possible. Reduces friction to zero.

**Implementation effort**: Low-Medium. Vision API calls are straightforward. The hard part is ingredient identification accuracy, which GPT-4o handles well.

**When**: v1.1 or fold into Feature 011 (M2 Moria) as an extension of the photo pipeline.

---

### Enhancement 7: Ingredient Substitution Intelligence 🟡 P1

**What**: "I don't have buttermilk" → AI suggests "1 cup milk + 1 tablespoon lemon juice. Let sit 5 minutes." Integrated with USDA food data (Feature 003) to ensure substitutions are nutritionally equivalent where possible.

**Why**: This is the #2 use case for AI in cooking (after "what can I make?"). MealThinker called it "recipe substitution roulette" — ChatGPT patches in substitutes that don't work. Commise can do better because it has USDA data to validate substitutes.

**How**: New endpoint or extension of the AI generation pipeline:

```typescript
POST /api/v1/ai/substitute
{
  ingredient: "buttermilk",
  amount: "1 cup",
  context: "pancakes",  // recipe context affects the best substitute
  pantryItems: ["milk", "lemon", "yogurt"],  // check user's pantry first
  usdaValidated: true,  // only suggest substitutes with similar nutrition
}
```

**Response**:

```json
{
    "substitutes": [
        {
            "substitute": "1 cup milk + 1 tablespoon lemon juice",
            "instructions": "Add lemon juice to milk. Let sit 5 minutes until curdled.",
            "confidence": 0.95,
            "pantryAvailable": true,
            "nutritionMatch": 0.92
        },
        {
            "substitute": "3/4 cup yogurt + 1/4 cup water",
            "instructions": "Thin yogurt with water until buttermilk consistency.",
            "confidence": 0.9,
            "pantryAvailable": true,
            "nutritionMatch": 0.88
        }
    ]
}
```

**Impact**: Substitution is the "oh, I don't have that" moment that kills cooking momentum. Solving it intelligently (with pantry awareness) is a retention driver.

**Implementation effort**: Low. It's a targeted AI prompt with structured output. The USDA cross-check is the value-add that competitors don't have.

**When**: Fold into M5 (Isengard) as part of Feature 005. Can be a new FR or extension of FR-016.

---

### Enhancement 8: YouTube/Video → Recipe Extraction 🟢 P2

**What**: User pastes a YouTube URL → AI watches the video → extracts structured recipe (ingredients, steps, timing). Sigma proved this works with Gemini.

**Why**: The Android Police test showed that TikTok/Instagram import apps (ReciMe, Flavorish, etc.) are inconsistent and error-prone. If Commise can extract from video with structured output + USDA validation, it leapfrogs all of them.

**How**:

```typescript
// 1. Fetch YouTube transcript (or use vision if no transcript)
const transcript = await youtubeService.getTranscript(videoUrl);

// 2. Extract structured recipe from transcript
const recipe = await generateObject({
    model: userProvider,
    schema: RecipeSchema,
    prompt: `Extract a complete recipe from this cooking video transcript:
    ${transcript}
    
    RULES:
    - Extract exact ingredient quantities where stated
    - Infer reasonable quantities where not stated (mark as "estimated")
    - Preserve the cooking technique and order of steps
    - Include any tips or warnings mentioned by the chef`,
});
```

**Impact**: This turns every YouTube cooking video into a saveable recipe. The content pool is infinite.

**Implementation effort**: Medium. YouTube transcript extraction is straightforward. The challenge is accuracy on videos without precise measurements. The structured output schema (Enhancement 1) helps enforce consistency.

**When**: v1.1 or v2.0. Feature 004 (Recipe Importing) already handles URL-based import. This extends it to video URLs specifically.

---

### Enhancement 9: AI → Grocery Fulfillment Pipeline 🔴 P0

**What**: The full pipeline from AI-generated recipe → pantry-aware grocery list → user-chosen fulfiller checkout in one tap. The AI generates a recipe with structured output, cross-references against pantry (what you have vs. need), auto-builds a grocery list of only the missing items, and sends it to the user's preferred grocery fulfiller for checkout — all in a single user flow.

**Users choose their fulfiller**: Commise presents available fulfillers (Instacart, Walmart, Amazon Fresh, local options) and the user picks their preferred one. Some users already have Instacart Express. Others have Walmart+. Some want the cheapest option. The fulfiller adapter pattern lets each user choose what works for them.

**Why this is the revenue engine**: The business plan projects **$100K/month from Instacart commissions at Month 12** (5% of cart value). Without this pipeline, there's no commission revenue. Feature 007 (Grocery Lists) currently specs a generic "store adapter" pattern with **"No partner API access is confirmed at spec time"** and prioritizes Walmart. The adapter pattern is right — the assumption about partner access is outdated. Multiple fulfillers now have public APIs:

| Fulfiller        | API Status                             | Commission                   | Coverage         | Notes                                                               |
| ---------------- | -------------------------------------- | ---------------------------- | ---------------- | ------------------------------------------------------------------- |
| **Instacart**    | ✅ Live Developer Platform (May 2026)  | **5%** of cart, 7-day window | 1,400+ retailers | Recipe pages, shopping lists, MCP server. Affiliate program active. |
| **Walmart**      | ✅ Affiliate API (public, key-based)   | **4%** via Impact            | ~4,700 US stores | Well-documented. No OAuth required — simpler to build.              |
| **Amazon Fresh** | ⚠️ Limited (Amazon SP-API)             | Variable (category-based)    | Select US cities | Requires seller account. Not a priority for v1.                     |
| **Kroger**       | ⚠️ API exists, partner approval needed | Unknown                      | 2,800+ stores    | Good for Midwest/South coverage. Follow-up adapter.                 |

**The full flow (what the user experiences)**:

```
1. User: "Generate a low-carb Italian dinner for 4"
2. AI generates structured recipe (Enhancement 1)
3. System cross-references against pantry (Enhancement 3)
   → "You have olive oil, garlic, chicken breasts. Need: zucchini, cherry tomatoes, mozzarella."
4. User taps "Order groceries"
5. System shows fulfiller picker:
   ┌─────────────────────────────────────────────┐
   │  🥕 Order missing ingredients               │
   │                                             │
   │  ● Instacart     $12.40  (5% off first     │
   │                           order, 30 min)    │
   │  ○ Walmart       $11.85  (pickup tomorrow)  │
   │  ○ Amazon Fresh  $13.10  (Prime, 2hr)       │
   │                                             │
   │  [Set as default fulfiller]                 │
   │  [Order Now →]                              │
   └─────────────────────────────────────────────┘
6. User selects fulfiller → adapter sends ingredients → returns checkout URL
7. User reviews cart in fulfiller app → checkout → groceries delivered
8. Commise earns commission on the cart total
```

**The same flow in ChatGPT (Custom GPT)**:

```
1. User: "@Commise, plan dinner for tonight, I have chicken and garlic"
2. Commise GPT (OAuth Actions) → calls Commise API → checks pantry → generates recipe
3. GPT responds: "How about Chicken Piccata? You have everything except lemons and capers."
4. User: "Sounds good, order the missing ingredients"
5. GPT → calls Commise API → uses user's default fulfiller → returns checkout link
6. User clicks → fulfiller cart → checkout → done
```

**Technical implementation (what needs building)**:

**1. Fulfiller Adapter Interface** (extends FR-030/FR-031 in Feature 007):

```typescript
/**
 * Every grocery fulfiller implements this interface.
 * Users choose their preferred adapter; the system uses their default
 * unless they explicitly pick another.
 */
interface GroceryFulfillerAdapter {
    readonly id: string; // "instacart" | "walmart" | "amazon-fresh"
    readonly name: string; // "Instacart"
    readonly logoUrl: string;
    readonly supportsDelivery: boolean;
    readonly supportsPickup: boolean;

    /**
     * Search for nearby stores/retailers by postal code.
     * Returns availability + estimated delivery windows.
     */
    findStores(postalCode: string): Promise<FulfillerStore[]>;

    /**
     * Send a grocery list to the fulfiller.
     * Maps ingredient names → fulfiller product IDs.
     * Returns a checkout URL the user opens in their browser.
     */
    createShoppingList(params: {
        storeId: string;
        lineItems: GroceryLineItem[];
        affiliateId?: string; // for commission tracking
    }): Promise<FulfillerCheckoutResult>;

    /**
     * Generate a recipe page (if the fulfiller supports it).
     * Instacart has this; Walmart does not.
     */
    createRecipePage?(params: { storeId: string; recipe: StructuredRecipe }): Promise<FulfillerCheckoutResult>;
}

interface GroceryLineItem {
    name: string; // "cherry tomatoes" (USDA-normalized)
    quantity: number;
    unit: string; // "pint", "lbs", "count"
}

interface FulfillerCheckoutResult {
    checkoutUrl: string; // User opens this to complete order
    lineItems: {
        name: string;
        matched: boolean; // Did the fulfiller find this product?
        productId?: string;
        price?: number; // Estimated price if fulfiller returns it
        matchConfidence: number; // 0-1
    }[];
    estimatedTotal?: number; // Estimated cart total
    deliveryWindow?: string; // "30-45 min", "Tomorrow 9am-10am"
}

interface FulfillerStore {
    id: string;
    name: string; // "Safeway (Mission St)"
    retailer: string; // "safeway"
    supportsDelivery: boolean;
    supportsPickup: boolean;
    estimatedDeliveryWindow?: string;
}
```

**2. Instacart adapter** (first adapter, highest commission):

| API                       | Purpose                                       | Docs                                                                                                                   |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/retailers`      | Find nearby stores by postal code             | [Instacart Retailer API](https://docs.instacart.com/developer_platform_api/api_references/retailers)                   |
| `POST /v1/recipes`        | Create recipe page with ingredient matching   | [Instacart Recipe Pages](https://docs.instacart.com/developer_platform_api/api_references/shopping/create_recipe_page) |
| `POST /v1/shopping_lists` | Create shopping list from ingredients         | [Instacart Shopping Lists](https://docs.instacart.com/developer_platform_api/api_references/shopping/shopping_lists)   |
| MCP Server                | For AI assistant integration (Claude, Gemini) | [Instacart MCP](https://docs.instacart.com/mcp_servers)                                                                |

**3. Walmart adapter** (second adapter, simplest integration):

| API                   | Purpose                                     | Docs                                                |
| --------------------- | ------------------------------------------- | --------------------------------------------------- |
| Walmart Affiliate API | Product search + add-to-cart URL generation | [Walmart Affiliate](https://affiliate.walmart.com/) |
| Walmart Product API   | Search products by keyword, get prices      | Public, key-based                                   |

Walmart doesn't have a recipe page API or shopping list API, so the adapter uses product search + affiliate links. Simpler but less integrated.

**4. User fulfiller preferences**:

```typescript
// Stored per-user, editable in settings
interface UserFulfillerPreferences {
    defaultFulfillerId: string; // "instacart" | "walmart"
    defaultStoreId?: string; // Pre-selected store
    postalCode: string; // For store availability
    hasSeenFulfillerOnboarding: boolean;
}
```

First time a user taps "Order groceries", they see the fulfiller picker with available options for their zip code. They pick one, optionally set it as default. On subsequent orders, their default is pre-selected but they can switch.

**5. Affiliate tracking** (revenue attribution):

```typescript
// Each adapter appends its own affiliate parameters
// Instacart
const affiliateUrl = `${shoppingListUrl}?utm_campaign=instacart-idp&utm_medium=affiliate&utm_source=instacart_idp&utm_term=partnertype-mediapartner&utm_content=campaignid-20313_partnerid-${COMMISE_PARTNER_ID}`;

// Walmart (Impact affiliate)
const affiliateUrl = `https://affil.walmart.com/cart?adid=${WALMART_AFFILIATE_ID}&items=${productIds.join(',')}`;
```

From Instacart's docs: **"You will receive 5% commission of the total value of the cart from all orders completed from your app/website within a 7 day window."**

**6. Custom GPT → fulfiller chain** (extends FR-018 in Feature 005):

The Commise Custom GPT needs two Actions:

| Action              | Endpoint                                 | Purpose                                                            |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `generate_recipe`   | `POST /api/v1/ai/recipes`                | Generate structured recipe with pantry awareness                   |
| `order_ingredients` | `POST /api/v1/grocery-lists/:id/fulfill` | Send grocery list to user's default fulfiller, return checkout URL |

The GPT's OpenAPI schema exposes both actions. ChatGPT's conversation handles the flow naturally — user asks for dinner, GPT generates recipe, user approves, GPT orders via their preferred fulfiller.

**Impact on existing specs**:

| Spec                             | Change Required                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature 005** (AI Integration) | Add `order_ingredients` as an external agent action. GPT can trigger fulfiller ordering via Commise API.                                                                                                                                                                                                                                                                                  |
| **Feature 007** (Grocery Lists)  | **Update assumptions**: Instacart and Walmart both have live APIs. The adapter pattern from FR-030 is correct — just needs real adapters instead of hypothetical ones. Instacart is the first adapter (highest commission, best UX with recipe pages). Walmart is the second (simpler, broader US coverage). Add fulfiller picker UI, user preference storage, and multi-adapter support. |
| **Feature 010** (Subscriptions)  | Online ordering is currently premium (FR-031). **Recommend making fulfiller ordering free** — the commission revenue (5% of cart) is worth more than gating it behind a subscription. Free ordering = more orders = more commission. Premium keeps nutrition tracking, taste profiles, and advanced AI features.                                                                          |
| **Business Plan**                | Revenue projections assume Instacart commission. Multi-fulfiller support expands revenue — Walmart adds another 4% commission channel for users who prefer it.                                                                                                                                                                                                                            |

**Implementation effort**: Medium. The adapter interface is clean and each fulfiller is isolated. Instacart adapter is ~1 week (well-documented REST API + OAuth). Walmart adapter is ~3 days (simpler affiliate API, no OAuth). Fulfiller picker UI is ~2 days. User preferences + onboarding is ~1 day.

**Adapter build order**:

1. **Instacart** — highest commission (5%), best UX (recipe pages, shopping lists), widest retailer coverage. Build first.
2. **Walmart** — simplest integration (key-based, no OAuth), 4,700 stores. Build second. Good fallback for users without Instacart in their area.
3. **Kroger / Amazon Fresh** — follow-up adapters based on user demand and geographic coverage gaps.

**When**: 🔴 P0. Ship Instacart adapter with M3 (Rohan) for the basic grocery list → checkout flow. Ship Walmart adapter in M4. Ship the full AI → fulfiller pipeline in M5 (Isengard). The Custom GPT ordering ships when the GPT launches (Month 4-5).

---

## 3. IMPLEMENTATION PRIORITY

| Priority | Enhancement                                    | When                                                  | Effort      | Competitive Impact                                                                    |
| -------- | ---------------------------------------------- | ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| 🔴 P0    | **Structured Output + USDA Validation**        | M5 (v1.0)                                             | Medium      | This IS the quality moat. Ship with Feature 005.                                      |
| 🔴 P0    | **Pantry-Aware Generation**                    | M5 (v1.0)                                             | Low         | Connects the core loop: pantry → AI → grocery. Essential.                             |
| 🔴 P0    | **AI → Grocery Fulfillment Pipeline**          | M3 (Instacart) / M4 (Walmart) / M5 (full AI pipeline) | Medium      | The revenue engine. Multi-fulfiller support = more users can order = more commission. |
| 🟡 P1    | **Ingredient Substitution**                    | M5 (v1.0) or v1.1                                     | Low         | High-frequency use case. Easy to implement.                                           |
| 🟡 P1    | **Taste Profile / Preference Learning**        | v1.1                                                  | Medium-High | The "gets better over time" moat. Start collecting signals at launch, enhance later.  |
| 🟡 P1    | **AI Meal Plan Generation**                    | v1.1                                                  | Medium      | "Plan my week in one click" = massive time savings.                                   |
| 🟡 P1    | **Photo → Recipe (ingredient identification)** | v1.1                                                  | Low-Medium  | Intuitive UX. Uses vision capabilities already in BYOK providers.                     |
| 🟢 P2    | **Real-Time Voice Cooking Assistant**          | v2.0                                                  | High        | "Holy shit" feature but requires significant engineering.                             |
| 🟢 P2    | **YouTube → Recipe Extraction**                | v2.0                                                  | Medium      | Extends Feature 004. Nice-to-have, not essential.                                     |

## 4. RECOMMENDED v1.0 SCOPE (M3-M5)

Ship these four AI enhancements across M3–M5:

1. **Structured Recipe Output** (Enhancement 1) — Zod schema + `generateObject` + USDA cross-validation + confidence scores
2. **Pantry-Aware Generation** (Enhancement 3) — Pantry query + expiry prioritization + "need to buy" separation
3. **Ingredient Substitution** (Enhancement 7) — Targeted AI prompt + pantry-first suggestions + USDA nutrition matching
4. **AI → Grocery Fulfillment Pipeline** (Enhancement 9) — Multi-fulfiller adapter pattern (Instacart + Walmart + future). Users choose their preferred provider. Instacart adapter in M3, Walmart in M4, full AI-driven pipeline in M5.

These four transform Feature 005 from "basic AI wrapper" into "intelligent cooking engine" **with a revenue channel**.

## 5. RECOMMENDED v1.1 SCOPE (Post-1.0)

Ship these three as the first post-launch AI updates:

5. **Taste Profile** (Enhancement 2) — Start collecting signals at launch, activate profile-based generation in v1.1
6. **AI Meal Plan Generation** (Enhancement 4) — "Plan my week" button with leftover reuse
7. **Photo → Recipe** (Enhancement 6) — Camera-first recipe generation

## 6. RECOMMENDED v2.0 SCOPE

8. **Real-Time Voice Assistant** (Enhancement 5) — The ambitious play. Requires WebRTC + tool-calling + BYOK real-time models.
9. **YouTube → Recipe** (Enhancement 8) — Extends video import capability.

## 7. TECHNICAL NOTES

### Vercel AI SDK

All structured output should use [Vercel AI SDK](https://github.com/vercel/ai) (`ai` package). It's provider-agnostic (OpenAI, Anthropic, Gemini — matching BYOK), supports `generateObject()` with Zod schemas, and handles streaming. Already the standard for Next.js AI integration.

### BYOK Provider Capability Matrix

| Capability               | OpenAI (GPT-4o)      | Anthropic (Claude) | Gemini           |
| ------------------------ | -------------------- | ------------------ | ---------------- |
| Structured output (JSON) | ✅                   | ✅                 | ✅               |
| Vision (image input)     | ✅                   | ✅                 | ✅               |
| Real-time voice          | ✅ (GPT-4o Realtime) | ❌                 | ✅ (Gemini Live) |
| Tool calling             | ✅                   | ✅                 | ✅               |
| Video understanding      | ❌                   | ❌                 | ✅ (Gemini 2.5)  |

**Implication**: Enhancement 5 (voice) and Enhancement 8 (video) only work with Gemini and OpenAI, not Anthropic. The UI should indicate capability availability based on the user's configured provider.

### recipe-api.com — Build vs. Buy

[recipe-api.com](https://recipe-api.com/generate) offers a commercial API that does structured recipe generation with USDA-verified nutrition. Pricing: ~$0.05/generation.

**Recommendation**: Build, don't buy. Your BYOK model means users pay for their own AI inference. Adding a third-party API cost per recipe undermines the cost advantage. The structured output + USDA validation is achievable with your own implementation + Feature 003's USDA data.

**Exception**: Consider recipe-api.com as a **fallback provider** for users who don't have BYOK keys (the hosted tier mentioned in the business plan at $2.99/mo).

---

## 8. NEW FUNCTIONAL REQUIREMENTS (Proposed additions to Feature 005 & 007)

### Feature 005 (AI Integration) — New FRs

| ID         | Requirement                                                                                                                                                                                                                | Priority |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **FR-023** | System MUST return AI-generated recipes as structured JSON conforming to a Zod-validated schema (name, ingredients with amounts/units, steps with order/duration/temperature, nutrition per serving, confidence score).    | P0       |
| **FR-024** | System MUST cross-validate each AI-generated ingredient against USDA food data (Feature 003) and calculate a confidence score based on match rate. Recipes below 80% confidence MUST display a warning.                    | P0       |
| **FR-025** | System MUST query the user's pantry inventory (Feature 006) before AI generation and include available ingredients in the prompt. Ingredients expiring within 3 days MUST be prioritized.                                  | P0       |
| **FR-026** | System MUST separate generated recipe ingredients into "from pantry" and "need to buy" categories, enabling automatic grocery list generation.                                                                             | P0       |
| **FR-027** | System SHOULD provide an ingredient substitution endpoint that suggests alternatives for a missing ingredient, prioritizing substitutes available in the user's pantry, with USDA nutritional equivalence where available. | P1       |
| **FR-028** | System SHOULD collect implicit and explicit taste signals (recipe ratings, cook frequency, substitutions made, saved-but-uncooked) for future taste-profile-based personalization.                                         | P1       |

### Feature 007 (Grocery Lists) — Fulfiller Adapter Additions

> **Note**: FR-028 through FR-033 already exist in Feature 007's spec. The FRs below extend the fulfiller integration beyond what's currently specced.

| ID         | Requirement                                                                                                                                                                                                                                 | Priority |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **FR-034** | System MUST implement a `GroceryFulfillerAdapter` interface that all grocery fulfillers (Instacart, Walmart, etc.) implement, supporting store search, shopping list creation, and checkout URL generation.                                 | P0       |
| **FR-035** | System MUST present a fulfiller picker UI when the user initiates grocery ordering, showing available fulfillers for their location with estimated totals and delivery windows. The user's selected default fulfiller MUST be pre-selected. | P0       |
| **FR-036** | System MUST store per-user fulfiller preferences (default fulfiller, default store, postal code) and use them for subsequent orders and Custom GPT integrations.                                                                            | P0       |
| **FR-037** | System MUST implement an Instacart adapter supporting retailer search, recipe page generation, shopping list creation, and affiliate tracking via the Instacart Developer Platform API.                                                     | P0       |
| **FR-038** | System MUST implement a Walmart adapter supporting product search, add-to-cart URL generation, and affiliate tracking via the Walmart Affiliate API.                                                                                        | P0       |
| **FR-039** | System MUST append affiliate tracking parameters to all fulfiller checkout URLs for commission attribution, and record order events for revenue tracking per fulfiller.                                                                     | P0       |
| **FR-040** | System MUST expose an `order_ingredients` action via the Custom GPT OAuth integration (Feature 005 FR-018), using the user's default fulfiller to generate a checkout URL.                                                                  | P0       |
| **FR-041** | System SHOULD make fulfiller ordering available to all users regardless of subscription tier (commission revenue > subscription gate). Premium features remain behind the paywall.                                                          | P1       |
| **FR-042** | System SHOULD support adding new fulfiller adapters without modifying the grocery list generation or AI pipeline code (open/closed principle).                                                                                              | P1       |
