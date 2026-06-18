# User Journeys: AI Integration

**Branch**: `005-ai-integration`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)

---

## Journey Notation

Each journey covers one end-to-end flow per persona. Steps reference FR IDs in brackets.

---

## Persona 1: AI Home Cook (Riley) — Journey A: Generate and Save a Recipe In-App

**Scenario**: Riley wants a low-carb Italian dinner for four and uses in-app AI generation.

```mermaid
sequenceDiagram
    participant U as Riley
    participant Web as Web/Mobile App
    participant API as Commise API
    participant BYOK as BYOK Config
    participant Provider as AI Provider

    U->>Web: Open AI generation
    Web->>API: POST /ai/generate/recipe (prompt + constraints)
    API->>BYOK: Resolve user provider credentials

    alt no provider configured
        API-->>Web: Setup required
        Note right of Web: FR-015
        U->>Web: Configure provider key
        Web->>API: POST /ai/byok/keys
        API-->>Web: Key stored
    end

    API->>Provider: Generate recipe request
    Provider-->>API: Streaming/complete response
    API-->>Web: Preview payload
    Note right of Web: FR-016, FR-017

    U->>Web: Save recipe
    Web->>API: POST /recipes (generated payload)
    API-->>Web: Saved as private user-owned recipe
    Note right of API: FR-020
```

---

## Persona 2: Premium Optimizer (Casey) — Journey B: Optimize Recipe Instructions

**Scenario**: Casey opens an existing recipe and asks AI to streamline instructions.

```mermaid
sequenceDiagram
    participant U as Casey
    participant App as App
    participant API as Commise API
    participant AI as AI Service

    U->>App: Open owned recipe
    U->>App: Select "Optimize instructions"
    App->>API: POST /ai/recipes/:id/optimize {mode}
    API->>AI: Request optimization
    AI-->>API: Optimized instructions preview
    API-->>App: Preview result
    Note right of App: FR-019

    U->>App: Accept and save
    App->>API: PUT /recipes/:id
    API-->>App: Updated recipe
    Note right of API: FR-020
```

---

## Persona 3: External-Agent Integrator (Jordan) — Journey C: Authorize Agent, Read Collection, Save Recipe

**Scenario**: Jordan authorizes an external agent (e.g., ChatGPT/Gemini-side integration) to query and save recipes.

```mermaid
sequenceDiagram
    participant U as Jordan
    participant Agent as External Agent
    participant Auth as Clerk OAuth
    participant MCP as Commise MCP API
    participant Data as Recipe Service

    Agent->>Auth: OAuth authorization request (scoped)
    U->>Auth: Consent grant
    Auth-->>Agent: Access token
    Note right of Agent: FR-018

    Agent->>MCP: recipes_list / recipe_get
    MCP->>Data: Fetch user recipes
    Data-->>MCP: Recipe data
    MCP-->>Agent: Response

    Agent->>MCP: recipe_save
    MCP->>Data: Create private recipe for user
    Data-->>MCP: Saved
    MCP-->>Agent: Success
    Note right of MCP: FR-020
```

---

## Cross-Persona Flows

### Flow X1: Low Confidence / Hallucination Guard Fallback

1. Generation returns low-confidence indicators.
2. UI highlights issues and blocks blind save.
3. User chooses: regenerate, adjust prompt, or manual fallback.

**FR linkage**: [FR-016](../spec.md#fr-016), [FR-017](../spec.md#fr-017), [FR-020](../spec.md#fr-020)

### Flow X2: External Agent Revocation

1. User opens account integrations.
2. User revokes agent access.
3. Subsequent MCP requests with revoked grant fail authorization.

**FR linkage**: [FR-021](../spec.md#fr-021)

---

## Journey Coverage Matrix

| Journey                           | FR-015 | FR-016 | FR-017 | FR-018 | FR-019 | FR-020 | FR-021 |
| --------------------------------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: |
| Journey A (In-app generate/save)  |     ✅ |     ✅ |     ✅ |      — |      — |     ✅ |      — |
| Journey B (Optimize instructions) |      — |      — |     ✅ |      — |     ✅ |     ✅ |      — |
| Journey C (External agent OAuth)  |      — |      — |      — |     ✅ |      — |     ✅ |     ✅ |
| Flow X1 (Confidence fallback)     |      — |     ✅ |     ✅ |      — |      — |     ✅ |      — |
| Flow X2 (Revocation)              |      — |      — |      — |     ✅ |      — |      — |     ✅ |
