# Acceptance Test Plan: Public Creator Profiles

**Feature Branch**: `012-creator-profiles`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/012-creator-profiles/v-model/requirements.md`

## Overview

Acceptance plan maps every requirement (`REQ-001..REQ-018`) to executable ATP/SCN coverage.

## ID Schema

- **Test Case**: `ATP-{NNN}-{X}`
- **Scenario**: `SCN-{NNN}-{X}{#}`

## Acceptance Tests

### Requirement Validation: REQ-001 (allow authenticated users to claim a unique `@handle` using lowercase al)

#### Test Case: ATP-001-A (Primary validation for REQ-001)

**Description:** Validates via **Test** that the system SHALL allow authenticated users to claim a unique `@handle` using lowercase alphanumeric or underscore characters (3–30 chars), disallow consecutive underscores, and disallow leading/trailing underscores.

- **User Scenario: SCN-001-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-002 (allow profile owners to set `displayName` (<=80), `bio` (<=160), and ava)

#### Test Case: ATP-002-A (Primary validation for REQ-002)

**Description:** Validates via **Test** that the system SHALL allow profile owners to set `displayName` (<=80), `bio` (<=160), and avatar image (JPEG/PNG/WebP <=5 MB) stored in S3.

- **User Scenario: SCN-002-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-003 (enforce global handle uniqueness at write time and return availability-c)

#### Test Case: ATP-003-A (Primary validation for REQ-003)

**Description:** Validates via **Test** that the system SHALL enforce global handle uniqueness at write time and return availability-check results in under 100 ms for indexed lookups.

- **User Scenario: SCN-003-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-004 (support profile deactivation that hides the public page and removes disc)

#### Test Case: ATP-004-A (Primary validation for REQ-004)

**Description:** Validates via **Test** that the system SHALL support profile deactivation that hides the public page and removes discovery placement without deleting underlying recipe entities.

- **User Scenario: SCN-004-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-005 (rate-limit handle changes to once every 30 days and reserve prior handle)

#### Test Case: ATP-005-A (Primary validation for REQ-005)

**Description:** Validates via **Test** that the system SHALL rate-limit handle changes to once every 30 days and reserve prior handles for 14 days before reuse.

- **User Scenario: SCN-005-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-006 (expose every active profile at canonical `commise.com/@{handle}` for un)

#### Test Case: ATP-006-A (Primary validation for REQ-006)

**Description:** Validates via **Demonstration** that the system SHALL expose every active profile at canonical `commise.com/@{handle}` for unauthenticated access.

- **User Scenario: SCN-006-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-007 (server-render profile pages with SEO metadata (`<title>`, `<meta descrip)

#### Test Case: ATP-007-A (Primary validation for REQ-007)

**Description:** Validates via **Inspection** that the system SHALL server-render profile pages with SEO metadata (`<title>`, `<meta description>`, Open Graph) derived from creator profile fields.

- **User Scenario: SCN-007-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-008 (render avatar, display name, bio, follower count, public collections, an)

#### Test Case: ATP-008-A (Primary validation for REQ-008)

**Description:** Validates via **Test** that the public profile surface SHALL render avatar, display name, bio, follower count, public collections, and paginated public recipes.

- **User Scenario: SCN-008-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-009 (provide idempotent follow/unfollow operations and update `followerCount`)

#### Test Case: ATP-009-A (Primary validation for REQ-009)

**Description:** Validates via **Test** that the system SHALL provide idempotent follow/unfollow operations and update `followerCount` / `followingCount` within 5 seconds.

- **User Scenario: SCN-009-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-010 (cause that creator's newly published public recipes to appear in the fol)

#### Test Case: ATP-010-A (Primary validation for REQ-010)

**Description:** Validates via **Test** that following a creator SHALL cause that creator's newly published public recipes to appear in the follower feed integration boundary.

- **User Scenario: SCN-010-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-011 (support creator-owned public collections with ordering, enforcing max 20)

#### Test Case: ATP-011-A (Primary validation for REQ-011)

**Description:** Validates via **Test** that the system SHALL support creator-owned public collections with ordering, enforcing max 20 collections per creator, name <=60 chars, description <=200 chars, and inclusion of only creator-owned public recipes.

- **User Scenario: SCN-011-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-012 (return a static HTML fragment (no JavaScript) with avatar, display name,)

#### Test Case: ATP-012-A (Primary validation for REQ-012)

**Description:** Validates via **Test** that `GET /api/v1/creators/:handle/widget` SHALL return a static HTML fragment (no JavaScript) with avatar, display name, follower count, and 3 latest public recipes, including `Cache-Control: public, max-age=300` and cache-hit p95 under 50 ms.

- **User Scenario: SCN-012-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-013 (compute daily aggregated analytics snapshots (profile views, follower de)

#### Test Case: ATP-013-A (Primary validation for REQ-013)

**Description:** Validates via **Test** that the system SHALL compute daily aggregated analytics snapshots (profile views, follower delta, top recipes, collection clicks), expose them only to profile owners, and never store or surface individual visitor identity or IP address.

- **User Scenario: SCN-013-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-014 (allow Support/Admin to suspend profiles (hiding page and blocking new fo)

#### Test Case: ATP-014-A (Primary validation for REQ-014)

**Description:** Validates via **Test** that the system SHALL allow Support/Admin to suspend profiles (hiding page and blocking new follows), notify creators with reason and appeal path, and block profile reactivation until moderation release.

- **User Scenario: SCN-014-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-015 (route DMCA takedown requests to Compliance Reviewer workflows and unpubl)

#### Test Case: ATP-015-A (Primary validation for REQ-015)

**Description:** Validates via **Test** that the system SHALL route DMCA takedown requests to Compliance Reviewer workflows and unpublish validly-noticed recipes within 24 hours with audit evidence.

- **User Scenario: SCN-015-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-016 (not implement payment processing, subscription charging, or revenue sett)

#### Test Case: ATP-016-A (Primary validation for REQ-016)

**Description:** Validates via **Inspection** that tip jar, premium recipe gating, and paid follow flows SHALL be delegated to feature 010 billing surfaces; 012 SHALL not implement payment processing, subscription charging, or revenue settlement logic.

- **User Scenario: SCN-016-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-017 (require fresh session assurance to reduce stale OAuth takeover risk)

#### Test Case: ATP-017-A (Primary validation for REQ-017)

**Description:** Validates via **Test** that all creator-profile endpoints SHALL be versioned under `/api/v1/`; owner-scoped operations SHALL require a Clerk session token whose `sub` matches profile `userId`; sensitive profile mutations SHALL require fresh session assurance to reduce stale OAuth takeover risk.

- **User Scenario: SCN-017-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

### Requirement Validation: REQ-018 (enforce blocked-user interaction restrictions on creator follow/engageme)

#### Test Case: ATP-018-A (Primary validation for REQ-018)

**Description:** Validates via **Test** that the system SHALL enforce blocked-user interaction restrictions on creator follow/engagement surfaces and execute GDPR right-to-erasure propagation for creator-profile PII (profile record, avatar object, widget cache) while preserving recipe entities with compliant attribution fallback.

- **User Scenario: SCN-018-A1**
    - **Given** preconditions and access context required by the requirement are satisfied
    - **When** the corresponding creator-profile API/workflow is executed
    - **Then** observed behavior matches the requirement contract and traceability evidence is recorded

---

## Coverage Summary

| Total Requirements (REQ) | 18 |
| Total Test Cases (ATP) | 18 |
| Total Scenarios (SCN) | 18 |
| Requirements with >=1 ATP | 18 / 18 (100%) |
| Test Cases with >=1 SCN | 18 / 18 (100%) |
| **Overall Coverage** | **100%** |
