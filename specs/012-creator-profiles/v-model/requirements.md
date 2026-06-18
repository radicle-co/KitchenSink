# V-Model Requirements Specification: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/012-creator-profiles/spec.md`, `specs/012-creator-profiles/research.md`, `specs/012-creator-profiles/product-spec/product-spec.md`

## Overview

Feature 012 establishes public creator identity on KitchenSink via canonical `@handle` pages, follow graph behavior, collections, embeddable widgets, analytics, and moderation/compliance controls, while explicitly delegating billing mechanics to feature 010. This requirements baseline converts FR/US/NFR intent into atomic `REQ-NNN` items that are testable and traceable through the full V-Model chain.

## Requirements

### Functional Requirements

| ID      | Description                                                                                                                                                                                                                                                                                    | Priority | Rationale                                                             | Verification Method | Source Traceability                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------- |
| REQ-001 | The system SHALL allow authenticated users to claim a unique `@handle` using lowercase alphanumeric or underscore characters (3–30 chars), disallow consecutive underscores, and disallow leading/trailing underscores.                                                                        | P1       | Establishes canonical creator identity namespace.                     | Test                | FR-001, US-001                                              |
| REQ-002 | The system SHALL allow profile owners to set `displayName` (<=80), `bio` (<=160), and avatar image (JPEG/PNG/WebP <=5 MB) stored in S3.                                                                                                                                                        | P1       | Defines profile editing baseline for creator presentation.            | Test                | FR-002, US-001                                              |
| REQ-003 | The system SHALL enforce global handle uniqueness at write time and return availability-check results in under 100 ms for indexed lookups.                                                                                                                                                     | P1       | Prevents namespace collisions and keeps claim UX responsive.          | Test                | FR-003                                                      |
| REQ-004 | The system SHALL support profile deactivation that hides the public page and removes discovery placement without deleting underlying recipe entities.                                                                                                                                          | P1       | Supports account control while preserving authored content integrity. | Test                | FR-004                                                      |
| REQ-005 | The system SHALL rate-limit handle changes to once every 30 days and reserve prior handles for 14 days before reuse.                                                                                                                                                                           | P2       | Reduces impersonation and handle-squatting abuse.                     | Test                | FR-005                                                      |
| REQ-006 | The system SHALL expose every active profile at canonical `commise.com/@{handle}` for unauthenticated access.                                                                                                                                                                                  | P1       | Delivers shareable public identity entrypoint.                        | Demonstration       | FR-006, US-004                                              |
| REQ-007 | The system SHALL server-render profile pages with SEO metadata (`<title>`, `<meta description>`, Open Graph) derived from creator profile fields.                                                                                                                                              | P1       | Improves discovery and share card quality.                            | Inspection          | FR-007                                                      |
| REQ-008 | The public profile surface SHALL render avatar, display name, bio, follower count, public collections, and paginated public recipes.                                                                                                                                                           | P1       | Defines minimum public information architecture for discovery.        | Test                | FR-008                                                      |
| REQ-009 | The system SHALL provide idempotent follow/unfollow operations and update `followerCount` / `followingCount` within 5 seconds.                                                                                                                                                                 | P1       | Ensures reliable graph operations with bounded consistency delay.     | Test                | FR-013, FR-015, US-003                                      |
| REQ-010 | Following a creator SHALL cause that creator's newly published public recipes to appear in the follower feed integration boundary.                                                                                                                                                             | P1       | Connects follow graph to downstream content discovery loop.           | Test                | FR-014                                                      |
| REQ-011 | The system SHALL support creator-owned public collections with ordering, enforcing max 20 collections per creator, name <=60 chars, description <=200 chars, and inclusion of only creator-owned public recipes.                                                                               | P1       | Enforces curation constraints and ownership boundaries.               | Test                | FR-017, FR-018, FR-019, US-002                              |
| REQ-012 | `GET /api/v1/creators/:handle/widget` SHALL return a static HTML fragment (no JavaScript) with avatar, display name, follower count, and 3 latest public recipes, including `Cache-Control: public, max-age=300` and cache-hit p95 under 50 ms.                                                | P1       | Provides low-friction embeddable creator surface.                     | Test                | FR-026, FR-027, US-005                                      |
| REQ-013 | The system SHALL compute daily aggregated analytics snapshots (profile views, follower delta, top recipes, collection clicks), expose them only to profile owners, and never store or surface individual visitor identity or IP address.                                                       | P1       | Delivers creator insight while preserving privacy posture.            | Test                | FR-023, FR-024, FR-025, US-006                              |
| REQ-014 | The system SHALL allow Support/Admin to suspend profiles (hiding page and blocking new follows), notify creators with reason and appeal path, and block profile reactivation until moderation release.                                                                                         | P1       | Supports moderation enforcement and creator due process.              | Test                | FR-020, FR-021                                              |
| REQ-015 | The system SHALL route DMCA takedown requests to Compliance Reviewer workflows and unpublish validly-noticed recipes within 24 hours with audit evidence.                                                                                                                                      | P1       | Meets legal response obligations for creator-published content.       | Test                | FR-022                                                      |
| REQ-016 | Tip jar, premium recipe gating, and paid follow flows SHALL be delegated to feature 010 billing surfaces; 012 SHALL not implement payment processing, subscription charging, or revenue settlement logic.                                                                                      | P1       | Preserves explicit cross-feature ownership boundary.                  | Inspection          | FR-006 monetization surface, US-007, US-008, US-010         |
| REQ-017 | All creator-profile endpoints SHALL be versioned under `/api/v1/`; owner-scoped operations SHALL require a Clerk session token whose `sub` matches profile `userId`; sensitive profile mutations SHALL require fresh session assurance to reduce stale OAuth takeover risk.                    | P1       | Maintains API consistency and account takeover resistance.            | Test                | FR-028, FR-029, FR-030                                      |
| REQ-018 | The system SHALL enforce blocked-user interaction restrictions on creator follow/engagement surfaces and execute GDPR right-to-erasure propagation for creator-profile PII (profile record, avatar object, widget cache) while preserving recipe entities with compliant attribution fallback. | P1       | Addresses abuse circumvention and privacy deletion obligations.       | Test                | Privacy + moderation constraints from product-spec/research |

## Assumptions

- Audience scope S-004 (`public-profile`) remains sibling to S-003 Circle and S-002 published-lesson.
- Billing and settlement remain out-of-scope for 012 and are handled by 010-subscriptions integration contracts.
- Verification badge issuance workflow is internal operations and not implemented as creator self-service in this feature.

## Dependencies

- `002-user-auth` for authenticated identity and JWT claim verification.
- `001-commise-recipe-app` for recipe ownership/visibility data used in profile and collections.
- `010-subscriptions` for monetization payment/subscription mechanics delegated by 012.

## Glossary

| Term                    | Definition                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------- |
| CreatorProfile          | Public creator identity entity owned by feature 012.                                   |
| S-004 public-profile    | Audience scope for unauthenticated visibility at `/@handle`.                           |
| Fresh session assurance | Additional recency check on OAuth-authenticated session for sensitive owner mutations. |

---

**Total Requirements**: 18
**By Priority**: P1: 16 | P2: 1 | P3: 0
**By Verification Method**: Test: 15 | Inspection: 2 | Analysis: 0 | Demonstration: 1
