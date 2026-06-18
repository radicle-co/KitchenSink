# Tech Stack Rationale

**Branch**: `005-ai-integration` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](../research.md), [spec.md](../spec.md)

---

## Overview

Feature 005 extends the Commise platform with AI capabilities in two directions:

1. In-app BYOK generation.
2. OAuth-protected external-agent integrations.

The stack choices below align to those constraints while preserving the existing NestJS + TypeScript architecture.

---

## Backend Orchestration: NestJS 11 + Vercel AI SDK

### Choice

NestJS service layer orchestrates generation flows; Vercel AI SDK provides provider abstraction and streaming helpers.

### Rationale

- Keeps API behavior consistent with existing backend architecture.
- Reduces provider-specific branching by normalizing OpenAI/Anthropic/Gemini interfaces.
- Supports incremental stream output for better UX.

### Trade-offs

| Trade-off                                       | Mitigation                                                    |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Abstraction can hide provider-specific controls | Expose advanced provider options in DTOs only where needed    |
| Streaming adds complexity                       | Use explicit generation state machine + structured SSE events |

---

## Credential Strategy: AWS Secrets Manager (BYOK)

### Choice

Store user BYOK API keys in AWS Secrets Manager; persist only metadata/ARN references in relational tables.

### Rationale

- Directly supports `FR-015` secure credential storage.
- Avoids plaintext key storage in app DB.
- Rotational and policy controls available at cloud boundary.

### Trade-offs

| Trade-off             | Mitigation                                                  |
| --------------------- | ----------------------------------------------------------- |
| Secret fetch latency  | Cache validated key metadata (never key values) where safe  |
| IAM policy complexity | Module-scoped least-privilege roles and audited access logs |

---

## External-Agent Access: OAuth 2.1 + PKCE + MCP JSON-RPC

### Choice

Use Clerk-backed OAuth 2.1 for consent and token issuance; expose MCP-compatible JSON-RPC tools via protected endpoint.

### Rationale

- Satisfies `FR-018` and `FR-021` consent/revocation model.
- Aligns with `research.md` MCP authorization findings and plan endpoint design.
- Audience-bound tokens reduce token misuse across resources.

### Trade-offs

| Trade-off                        | Mitigation                                         |
| -------------------------------- | -------------------------------------------------- |
| OAuth flow complexity for agents | Standards-compliant well-known discovery endpoints |
| Scope sprawl risk                | Minimal default scopes + explicit grant controls   |

---

## Data and Persistence

### Choice

Drizzle schema extensions for AI job records, prompt templates, BYOK key references, and OAuth consents.

### Rationale

- Maintains typed schema discipline with existing stack.
- Enables auditability and deterministic trace queries.

### Trade-offs

| Trade-off                       | Mitigation                                            |
| ------------------------------- | ----------------------------------------------------- |
| Schema growth                   | Keep AI tables modular and indexed by user/job/status |
| Prompt/history privacy concerns | Hash/sanitize prompt payloads before persistence      |

---

## Async and UX Delivery Layer

### Choice

Async generation endpoints (job id) with optional SSE stream for progressive UI updates.

### Rationale

- Supports SC-003 while preserving graceful fallback for long-running providers.
- Better user perception of responsiveness than opaque blocking calls.

### Trade-offs

| Trade-off                    | Mitigation                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| More frontend state handling | Canonical flow states documented in `research/ux-patterns.md` |
| Retry duplication risk       | Idempotency keys + job status persistence                     |

---

## Cross-Reference to FR Coverage

| FR     | Stack Element                                             |
| ------ | --------------------------------------------------------- |
| FR-015 | Secrets Manager + ByokModule                              |
| FR-016 | AiModule + Vercel AI SDK + streaming/non-stream endpoints |
| FR-017 | Preview-first UI + explicit save action                   |
| FR-018 | OAuth 2.1 discovery + MCP JSON-RPC endpoints              |
| FR-019 | Premium-gated optimization route in AiModule              |
| FR-020 | Recipe persistence ownership model in API/domain layer    |
| FR-021 | Consent management + revoke flows                         |
