# User Journeys: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)

---

## Journey Notation

Each journey covers one end-to-end flow per persona. Steps reference FR IDs in brackets. P1/P2/P3 markers correspond to story priority from spec.md.

---

## Persona 1: Home Cook (Alex) — Journey A: Capture and Revisit a Family Recipe

**Scenario**: Alex opens the mobile app, creates an account, and saves her grandmother's pasta recipe with nutrition data. She later finds it via search, scales the servings, and edits a step.

```mermaid
sequenceDiagram
    participant A as Alex (Mobile)
    participant API as Commise API
    participant DB as RDS PostgreSQL
    participant S3 as S3 (Version Archive)
    participant FoodDB as USDA Food DB

    Note over A, FoodDB: P1 — Create & Manage

    A->>API: Authenticated request (Clerk session token via hosted UI)
    API->>A: Verified principal (networkless via CLERK_JWT_KEY)

    A->>API: POST /recipes (title, description, ingredients[], steps[], times, servings, tags)
    Note right: FR-001, FR-001a, FR-007, FR-007a, FR-044, FR-045

    loop For each ingredient
        API->>FoodDB: Search ingredient by name
        FoodDB-->>API: Matched ingredient with nutrition data
    end

    API->>DB: BEGIN TRANSACTION
    API->>DB: INSERT recipe (atomically, independent of photo uploads)
    DB-->>API: recipe_id
    API->>DB: COMMIT TRANSACTION

    Note right: FR-001a: metadata persists even if photo fails

    API->>S3: Enqueue async version archive (SQS, DLQ retry)
    S3-->>API: 202 Accepted (non-blocking)

    API-->>A: 201 Created { recipe_id, version: 1 }

    Note over A, API: P2 — Search & Discover

    A->>API: GET /recipes?q=pasta&tags=Italian
    Note right: FR-006

    API-->>A: 200 OK { recipes[] }

    Note over A, API: P1 — Edit & Version

    A->>API: PUT /recipes/{id} (edit step text, update servings)
    Note right: FR-007b, FR-007c, FR-002

    API->>DB: Check version field (optimistic concurrency)
    alt version matches
        API->>DB: UPDATE recipe + INSERT new recipe_version row
        API->>S3: Enqueue new version archive
        API-->>A: 200 OK { version: 2 }
    else version stale
        API-->>A: 409 Conflict { server_version, client_version }
        Note right: FR-007c
        A->>A: Display conflict resolution UI
        A->>API: PUT /recipes/{id}?resolve=merge (user merged)
        API->>DB: UPDATE with merged fields + new version
        API-->>A: 200 OK { version: 3 }
    end
```

**Happy path assertions**:

- Recipe created with all fields and ingredient nutrition visible on detail view.
- Version counter increments on each save.
- Stale save triggers 409 with both versions displayed.

---

## Persona 2: Meal Planner (Jordan) — Journey B: Build a Themed Collection from Community Recipes

**Scenario**: Jordan uses the web app to search for keto recipes, clones three into a new collection called "Keto Week," then shares the collection publicly.

```mermaid
sequenceDiagram
    participant J as Jordan (Web)
    participant API as Commise API
    participant DB as RDS PostgreSQL

    Note over J, API: P2 — Search & Discover

    J->>API: GET /recipes?q=keto&dietary=low-carb&max_cook_time=30
    Note right: FR-006

    API-->>J: 200 OK { public_recipes[] }
    Note right: FR-004

    J->>J: Browse results, select 3 recipes

    Note over J, API: P3 — Share & Clone

    J->>API: POST /recipes/{id}/clone (for each of 3)
    Note right: FR-005

    API->>DB: INSERT cloned recipe with source_attribution
    Note right: FR-005: attribution retained, clone is public by default
    API-->>J: 201 Created { clone_id }

    Note over J, API: P3 — Collections

    J->>API: POST /collections (name: "Keto Week")
    Note right: FR-008

    J->>API: POST /collections/{id}/recipes (add clone_id x3)
    Note right: FR-009

    J->>API: PATCH /collections/{id} (visibility: public)
    Note right: FR-010

    API-->>J: 200 OK { collection }

    Note over J, API: P3 — Collection Clone with Pull

    J->>API: POST /collections/{id}/clone
    Note right: FR-011

    API->>DB: Clone collection snapshot, record source_collection_id
    API-->>J: 201 Created { cloned_collection_id }

    Note over J, API: Later: Pull Updates

    J->>API: POST /collections/{cloned_id}/pull-updates
    Note right: FR-011: opt-in reconcile, no overwrites

    API->>DB: Compare source public membership vs clone
    API->>DB: INSERT new public recipes not yet in clone
    API-->>J: 200 OK { added_recipes[], removed_recipes[] }
```

**Happy path assertions**:

- Cloned recipes appear in Jordan's collection with source attribution visible.
- Pull-updates adds only new source recipes; directly-added recipes are untouched.

---

## Persona 3: Recipe Sharer (Morgan) — Journey C: Publish, Track, and Protect an Original Recipe

**Scenario**: Morgan creates an original recipe, publishes it publicly, monitors its clone count via version history, and — after a stranger clones it and makes edits — verifies the version history still shows Morgan's original.

```mermaid
sequenceDiagram
    participant M as Morgan (Web)
    participant API as Commise API
    participant DB as RDS PostgreSQL
    participant S3 as S3 Archive

    Note over M, API: P1 — Create & Manage

    M->>API: Authenticated request (Clerk session token, premium tier in public_metadata)
    M->>API: POST /recipes (original recipe, all fields)
    Note right: FR-001, FR-001a, FR-007, FR-007a, FR-044, FR-045

    API-->>M: 201 Created { recipe_id, version: 1 }

    Note over M, API: P1 — Set Public Visibility

    M->>API: PATCH /recipes/{id} (visibility: public)
    Note right: FR-003, C-004

    API-->>M: 200 OK

    Note over M, API: P3 — Cloning by Stranger

    Stranger->>API: GET /recipes/{id} (public, unauthenticated blocked)
    Note right: FR-004: any authenticated user can view

    Stranger->>API: POST /recipes/{id}/clone
    Note right: FR-005

    API-->>Stranger: 201 Created { clone_id }

    Note over M, API: P1 — Version History

    M->>API: GET /recipes/{id}/versions
    Note right: FR-007b

    API-->>M: 200 OK { versions[] (last 10 in DB, all in S3) }

    Note over M, API: P1 — Soft Delete (GDPR path available)

    M->>API: DELETE /recipes/{id}
    Note right: FR-002 (soft delete / tombstone)

    API->>DB: SET deleted_at = now()
    Note right: C-007: immediate removal from listings

    API-->>M: 204 No Content

    Note right: DB rows + S3 archives retained indefinitely

    Note over M, API: GDPR Hard Purge (optional future action)

    M->>API: POST /api/v1/account/erasure
    Note right: C-007: hard purge, irreversible

    API-->>M: 202 Accepted { erasure_job_id }
```

**Happy path assertions**:

- Recipe is public and viewable by any authenticated user.
- Clone by stranger is attributed to Morgan's original.
- Version history shows full audit trail.
- Soft delete removes from all listings immediately; data retained.
- GDPR erasure (explicit only) triggers full DB + S3 purge.

---

## Cross-Persona Flows

### Flow X1: Concurrent Edit Conflict (all personas)

```mermaid
sequenceDiagram
    participant U as User (Device A)
    participant U2 as User (Device B)
    participant API as Commise API
    participant DB as RDS PostgreSQL

    U->>API: GET /recipes/{id} (version: 5)
    U2->>API: GET /recipes/{id} (version: 5)

    U->>API: PUT /recipes/{id} (version: 5, changes)
    API->>DB: UPDATE ... WHERE version = 5
    DB-->>API: 1 row updated
    API-->>U: 200 OK { version: 6 }

    U2->>API: PUT /recipes/{id} (version: 5, changes)
    Note right: FR-007c: optimistic concurrency

    API->>DB: UPDATE ... WHERE version = 5
    DB-->>API: 0 rows updated
    API-->>U2: 409 Conflict { server_version: 6, client_version: 5 }

    Note over U2: Side-by-side conflict UI
    U2->>U2: Choose "Keep server version"
    U2->>API: GET /recipes/{id}
    API-->>U2: 200 OK { recipe, version: 6 }
```

### Flow X2: Photo Upload Failure with Atomic Save

```mermaid
sequenceDiagram
    participant U as User
    participant API as Commise API
    participant DB as DB (atomic)
    participant S3 as S3

    U->>API: POST /recipes (metadata only, 2 photos)

    API->>DB: BEGIN
    API->>DB: INSERT recipe (metadata persisted)
    DB-->>API: recipe_id
    API->>DB: COMMIT

    Note right: FR-001a: recipe persists independent of photo result

    par
        API->>S3: PUT photo-1 (valid JPEG, 2MB)
        S3-->>API: 200 OK
    and
        API->>S3: PUT photo-2 (valid PNG, 6MB — oversized)
        Note right: Client-side validation should have caught this
        S3-->>API: 413 Payload Too Large
    end

    API->>API: Per-file retry for photo-2
    Note right: User retries with correctly sized file

    API->>S3: PUT photo-2-retry (2MB)
    S3-->>API: 200 OK

    API-->>U: 201 Created { recipe_id, failed_uploads: [photo-2-id] }
    Note right: Per-file error surfaced; no broken reference persisted
```

### Flow X3: S3 Version Archive Failure with Pending-Archive Retry

```mermaid
sequenceDiagram
    participant U as User
    participant API as Commise API
    participant DB as DB
    participant SQS as SQS Queue
    participant DLQ as SQS DLQ
    participant S3 as S3

    U->>API: PUT /recipes/{id} (save)

    API->>DB: Update recipe + INSERT new version row
    API->>DB: INSERT pending_archive record
    DB-->>API: version saved

    Note right: FR-007b-i: user save succeeds independently

    API->>SQS: Send message (version payload)
    SQS-->>API: 202 Accepted

    SQS->>S3: PUT version-archive
    S3-->>SQS: 500 Internal Error (S3 unavailable)

    SQS->>DLQ: Message moved to DLQ after 3 retries

    Note right: FR-007b-i: CloudWatch alarm fires if pending_archives > 100

    Note over DLQ, S3: Async operator or自动重试 eventually succeeds
    DLQ->>S3: PUT version-archive (retry)
    S3-->>DLQ: 200 OK

    DLQ->>DB: DELETE pending_archive record (confirmed)
```

---

## Journey Coverage Matrix

| Persona                | Journey                  | P1  | P2  | P3  | FRs covered                                                                        |
| ---------------------- | ------------------------ | --- | --- | --- | ---------------------------------------------------------------------------------- |
| Alex (Home Cook)       | Capture family recipe    | Yes | Yes | No  | FR-001, FR-001a, FR-007, FR-007a, FR-007b, FR-007c, FR-002, FR-006, FR-044, FR-045 |
| Jordan (Meal Planner)  | Build themed collection  | No  | Yes | Yes | FR-006, FR-004, FR-005, FR-008, FR-009, FR-010, FR-011                             |
| Morgan (Recipe Sharer) | Publish and protect      | Yes | No  | Yes | FR-001, FR-001a, FR-003, FR-005, FR-007b, FR-002, FR-011, C-004, C-007             |
| All                    | Concurrent edit conflict | Yes | No  | No  | FR-007c                                                                            |
| All                    | Photo upload failure     | Yes | No  | No  | FR-001a                                                                            |
| All                    | S3 archive failure       | Yes | No  | No  | FR-007b-i                                                                          |
