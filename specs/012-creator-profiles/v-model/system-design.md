# System Design: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/012-creator-profiles/v-model/requirements.md`

## Overview

Feature 012 decomposes into creator lifecycle, public read/discovery, social graph, collection curation, embed delivery, analytics, moderation/compliance, monetization delegation, and security/privacy controls. Each `SYS-NNN` is independently testable through API contracts, scheduled jobs, or control-plane workflows and together provides full coverage of `REQ-001..REQ-018`.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier, never renumbered.
- **Parent Requirements**: comma-separated `REQ-NNN` list per component (many-to-many).

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                                  | Description                                                                                                       | Parent Requirements                         | Type      |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------- |
| SYS-001 | Profile Lifecycle Service             | Creates, updates, deactivates, and renames `CreatorProfile` records including handle cooldown/reservation checks. | REQ-001, REQ-002, REQ-004, REQ-005, REQ-017 | Service   |
| SYS-002 | Handle Uniqueness & Availability      | Executes indexed uniqueness enforcement and low-latency availability reads.                                       | REQ-003                                     | Service   |
| SYS-003 | Public Profile Read Surface           | Builds unauthenticated profile payloads and canonical metadata-backed page data.                                  | REQ-006, REQ-007, REQ-008                   | Subsystem |
| SYS-004 | Follow Graph Command Path             | Handles idempotent follow/unfollow writes and bounded counter consistency.                                        | REQ-009                                     | Service   |
| SYS-005 | Follow Feed Projection Bridge         | Publishes follow-driven projection events for downstream feed integration.                                        | REQ-010                                     | Adapter   |
| SYS-006 | Collections Curation Service          | Manages creator collections, ordering, ownership validation, and public-only recipe constraints.                  | REQ-011                                     | Service   |
| SYS-007 | Embed Widget Delivery                 | Renders static widget fragment responses with CDN cache semantics and latency targets.                            | REQ-012                                     | Service   |
| SYS-008 | Creator Analytics Pipeline            | Computes daily aggregate snapshots and serves owner-only analytics reads without visitor PII.                     | REQ-013                                     | Subsystem |
| SYS-009 | Moderation & Compliance Workflow      | Executes profile suspension, creator notification/appeal state, and DMCA takedown SLA handling.                   | REQ-014, REQ-015                            | Subsystem |
| SYS-010 | Monetization Delegation Gateway       | Exposes thin delegation endpoints for tip/earnings requests to feature 010 contracts.                             | REQ-016                                     | Adapter   |
| SYS-011 | Security, Abuse, and Privacy Controls | Enforces owner JWT checks, fresh-session protections, blocked-user restrictions, and GDPR erasure propagation.    | REQ-017, REQ-018                            | Subsystem |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                         |
| ------- | ------- | ------------ | ---------------------------------------------------------------------- |
| SYS-001 | SYS-002 | Calls        | Handle claim/update fails with conflict or validation error.           |
| SYS-003 | SYS-001 | Reads        | Public pages return 404/410 for missing or deactivated profiles.       |
| SYS-004 | SYS-003 | Reads        | Follow actions fail for non-existent or suspended creators.            |
| SYS-005 | SYS-004 | Subscribes   | Feed projection lags if follow event stream is unavailable.            |
| SYS-006 | SYS-003 | Reads        | Collection pages cannot render creator context fields.                 |
| SYS-007 | SYS-003 | Reads        | Widget falls back to temporary unavailable fragment.                   |
| SYS-008 | SYS-001 | Reads        | Analytics snapshots miss profile metadata joins.                       |
| SYS-009 | SYS-001 | Writes       | Suspension state cannot be applied consistently.                       |
| SYS-010 | SYS-001 | Reads        | Delegation endpoints reject unresolved creator handles.                |
| SYS-011 | SYS-001 | Guards       | Unauthorized or blocked interactions may bypass policy if unavailable. |

## Interface View (IEEE 1016 §5.3)

| Component | Interface                                                                   | Contract                                                                |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| SYS-001   | `POST/PUT /api/v1/creators`, `PUT /api/v1/creators/:handle`                 | Owner-authenticated lifecycle mutations with handle policy enforcement. |
| SYS-003   | `GET /api/v1/creators/:handle`                                              | Public read model for canonical profile and SEO payloads.               |
| SYS-004   | `POST/DELETE /api/v1/creators/:handle/follow`                               | Idempotent graph mutation APIs with conflict-safe counters.             |
| SYS-006   | `/api/v1/creators/:handle/collections*`                                     | Owner-scoped collection CRUD + public read boundaries.                  |
| SYS-007   | `GET /api/v1/creators/:handle/widget`                                       | Static fragment response with explicit cache-control policy.            |
| SYS-008   | `GET /api/v1/creators/:handle/analytics` + daily job trigger                | Owner-only aggregate analytics retrieval.                               |
| SYS-009   | Admin moderation and compliance queue interfaces                            | Suspension and DMCA processing within operational SLA.                  |
| SYS-010   | `POST /api/v1/creators/:handle/tip` and premium/follow delegation contracts | Pass-through integration to 010 payment surfaces.                       |
| SYS-011   | Auth policy guard + erasure workflow interfaces                             | JWT/recency checks, block policy checks, and GDPR erasure execution.    |

## Data Design View (IEEE 1016 §5.4)

| Store                                               | Owned By | Purpose                                                  |
| --------------------------------------------------- | -------- | -------------------------------------------------------- |
| `creator_profiles`                                  | SYS-001  | Profile identity fields and lifecycle state.             |
| `creator_follows`                                   | SYS-004  | Follower graph relationships and timestamps.             |
| `creator_collections`, `creator_collection_recipes` | SYS-006  | Curated collection metadata and ordering.                |
| `creator_analytics_snapshots`                       | SYS-008  | Daily aggregate analytics facts.                         |
| moderation/compliance case store                    | SYS-009  | Suspension + DMCA workflow state and audit evidence.     |
| erasure job ledger                                  | SYS-011  | GDPR erasure request status and propagation checkpoints. |
