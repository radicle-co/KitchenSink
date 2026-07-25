# Module Design — Commise Recipe App

**Feature**: `001-commise-recipe-app`
**Standards Basis**: DO-178C §6.3.3 (Low-Level Requirements) · ISO 26262-6 §7 (Software Unit Design) · IEC 62304 §5.4 (Software Detailed Design)
**Parent Architecture**: [`architecture-design.md`](./architecture-design.md) (36 ARCH modules, ARCH-001 … ARCH-036)
**Generated**: 2026-05-08 (PRF-MOD-001 remediation: added stateless confirmation to MOD-004, MOD-008, MOD-010, MOD-012, MOD-013, MOD-016)

---

## Overview

### Purpose

This document decomposes every architecture module (ARCH-NNN) from `architecture-design.md` into one or more **low-level modules (MOD-NNN)** with sufficient detail for unit-level test generation, code review, and certification audit. Each MOD defines:

- **Interface View** — exact signatures and error codes (must match parent ARCH contract).
- **Algorithmic / Logic View** — pseudocode of the runtime behavior.
- **State Machine View** — explicit states / transitions where the module is stateful.
- **Internal Data Structures** — typed shapes used by the module's logic.
- **Error Handling & Return Codes** — exhaustive error matrix for the unit-test generator.

### Module Inventory & ARCH Mapping

| MOD-ID  | Module Name                      | Parent ARCH | Type      | Notes                                                                           |
| ------- | -------------------------------- | ----------- | --------- | ------------------------------------------------------------------------------- |
| MOD-001 | Clerk Auth Service               | ARCH-001    | Library   |                                                                                 |
| MOD-002 | Owner & Tier Authorization Guard | ARCH-002    | Library   |                                                                                 |
| MOD-003 | Recipe HTTP Controller           | ARCH-003    | Component |                                                                                 |
| MOD-004 | Recipe Command Service           | ARCH-004    | Service   |                                                                                 |
| MOD-005 | Recipe DTO Validator             | ARCH-005    | Library   |                                                                                 |
| MOD-006 | Visibility Policy Engine         | ARCH-006    | Library   | Pure function                                                                   |
| MOD-007 | Substantive Edit Detector        | ARCH-007    | Library   | Pure function                                                                   |
| MOD-008 | Ingredient Resolver Service      | ARCH-008    | Service   |                                                                                 |
| MOD-009 | Nutrition Calculator             | ARCH-009    | Library   |                                                                                 |
| MOD-010 | Recipe Search Service            | ARCH-010    | Service   |                                                                                 |
| MOD-011 | Search Query Builder             | ARCH-011    | Library   |                                                                                 |
| MOD-012 | Photo Presign Service            | ARCH-012    | Service   |                                                                                 |
| MOD-013 | Photo Confirm Service            | ARCH-013    | Service   |                                                                                 |
| MOD-014 | Photo Processing Lambda Handler  | ARCH-014    | Service   |                                                                                 |
| MOD-015 | Version Snapshot Writer          | ARCH-015    | Service   |                                                                                 |
| MOD-016 | Optimistic Concurrency Guard     | ARCH-016    | Library   |                                                                                 |
| MOD-017 | Archive Queue Producer           | ARCH-017    | Adapter   |                                                                                 |
| MOD-018 | Archive Worker Lambda            | ARCH-018    | Service   |                                                                                 |
| MOD-019 | Pending Archive Reconciler       | ARCH-019    | Service   |                                                                                 |
| MOD-020 | Collection Service               | ARCH-020    | Service   |                                                                                 |
| MOD-021 | Collection Clone & Pull Service  | ARCH-021    | Service   |                                                                                 |
| MOD-022 | GDPR Erasure Orchestrator        | ARCH-022    | Service   |                                                                                 |
| MOD-023 | Erasure Storage Purger           | ARCH-023    | Service   |                                                                                 |
| MOD-024 | Drizzle Repository Layer         | ARCH-024    | Adapter   |                                                                                 |
| MOD-025 | S3 & CloudFront Adapter          | ARCH-025    | Adapter   | `[EXTERNAL]` — wraps AWS SDK                                                    |
| MOD-026 | Web Recipe & Collection UI       | ARCH-026    | Component |                                                                                 |
| MOD-027 | Mobile Recipe & Collection UI    | ARCH-027    | Component |                                                                                 |
| MOD-028 | API Error Mapper                 | ARCH-028    | Library   |                                                                                 |
| MOD-029 | Config Loader                    | ARCH-029    | Library   |                                                                                 |
| MOD-030 | Telemetry & Logger               | ARCH-030    | Library   | `[CROSS-CUTTING]`                                                               |
| MOD-031 | Archive Backlog Alarm            | ARCH-031    | Utility   | `[CROSS-CUTTING]` — infra-as-code                                               |
| MOD-032 | CI & Test Governance Harness     | ARCH-032    | Utility   | `[CROSS-CUTTING]`                                                               |
| MOD-033 | NestJS Module Wiring             | ARCH-033    | Utility   | `[CROSS-CUTTING]` — DI composition root                                         |
| MOD-034 | Home Widget Contract & Registry  | ARCH-034    | Library   | Low-level design delegated to `research/home-widget-architecture.md` (DECISION) |
| MOD-035 | curateHomeWidgets Composition Fn | ARCH-035    | Library   | Low-level design delegated to `research/home-widget-architecture.md` (DECISION) |
| MOD-036 | Home Widget Host Render          | ARCH-036    | Component | Low-level design delegated to `research/home-widget-architecture.md` (DECISION) |

**Coverage**: 36 / 36 ARCH modules → at least one MOD each (100% forward coverage).

---

### Module: MOD-001 (Clerk Auth Service)

**Parent Architecture Modules**: ARCH-001
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/auth/clerk-auth.service.ts`

#### Interface View

| Direction | Name            | Type   | Format                                                       | Constraints                                                                                                                                                                                |
| --------- | --------------- | ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Input     | `bearerToken`   | string | JWT compact serialization                                    | Required; non-empty; valid Clerk session token; signature verifies against `CLERK_JWT_KEY`; `azp` in `CLERK_AUTHORIZED_PARTIES`; not expired                                               |
| Output    | `principal`     | object | `{ userId, sub, email, tier, roles, permissions, iat, exp }` | `userId` non-empty (app-user ULID from the `external_id` claim — THE owner key); `sub` retained for trace/audit only; `tier ∈ {"free","premium"}` read from `public_metadata`; `exp` > now |
| Exception | `INVALID_TOKEN` | 401    | `{ code, message }`                                          | Signature/claim/expiry/`azp` failure (networkless — no JWKS fetch)                                                                                                                         |

#### Algorithmic / Logic View

```text
function verify(bearerToken):
  if !bearerToken or bearerToken is empty:
    throw INVALID_TOKEN("missing")
  # Networkless verification: CLERK_JWT_KEY is a local PEM public key — no JWKS round trip.
  payload ← verifyToken(bearerToken, {
    jwtKey: config.clerkJwtKey,                 # CLERK_JWT_KEY (public PEM)
    authorizedParties: config.clerkAuthorizedParties  # CLERK_AUTHORIZED_PARTIES (azp allowlist)
  })  # @clerk/backend; throws on bad signature / azp mismatch / expiry
  if payload.exp ≤ now():
    throw INVALID_TOKEN("expired")
  # app-user ULID is THE owner key — read it networklessly from the external_id claim (REQ-IF-007).
  userId ← payload.external_id
  if !userId or userId is empty:
    throw INVALID_TOKEN("external_id (app ULID) claim missing")   # prerequisite, not optional (A2)
  tier ← payload.public_metadata?.tier
  if tier not in ["free","premium"]:
    throw INVALID_TOKEN("tier claim missing/invalid")
  roles       ← payload.public_metadata?.roles ?? []
  permissions ← payload.public_metadata?.permissions ?? []
  return Principal{
    userId: userId,                             # app-user ULID from external_id — THE owner key
    sub: payload.sub,                           # Clerk subject — trace/audit only, NOT for ownership
    email: payload.email,
    tier: tier,                                 # read from public_metadata
    roles: roles,                               # from public_metadata (admin checks use these)
    permissions: permissions,                   # from public_metadata
    iat: payload.iat,
    exp: payload.exp
  }
```

#### State Machine View

Stateless. Photo-row completion (`pending → complete | failed`) is performed by the Fargate `photo-processed` SQS consumer after MOD-014 renders derivatives to S3 (MOD-014 is S3-only and touches no DB — D1); the service itself holds no mutable state. Concurrency safety is ensured by optimistic locking at the repository level (see MOD-016).

#### Internal Data Structures

```ts
type Principal = {
    userId: string; // app-user ULID — THE owner key; read from the verified token's `external_id` claim
    sub: string; // Clerk subject — retained for trace/audit only, NOT for ownership
    email: string;
    tier: 'free' | 'premium';
    roles: string[]; // from token public_metadata (admin checks use these)
    permissions: string[]; // from token public_metadata
    iat: number;
    exp: number;
};
type VerifiedClerkClaims = {
    external_id: string; // app-user ULID (owner key) — surfaced as Principal.userId
    sub: string;
    email: string;
    public_metadata: { tier?: 'free' | 'premium'; roles?: string[]; permissions?: string[] };
    azp?: string;
    iat: number;
    exp: number;
};
```

#### Error Handling & Return Codes

| Trigger                                      | Error Code      | HTTP | Recovery                                                         |
| -------------------------------------------- | --------------- | ---- | ---------------------------------------------------------------- |
| Missing/empty bearer token                   | `INVALID_TOKEN` | 401  | Caller returns 401 to client                                     |
| Bad signature / `azp` not authorized         | `INVALID_TOKEN` | 401  | Caller returns 401                                               |
| Expired token                                | `INVALID_TOKEN` | 401  | Caller returns 401; client refreshes session                     |
| `external_id` (app ULID) claim missing/empty | `INVALID_TOKEN` | 401  | Caller returns 401; feature 002 must emit the claim (REQ-IF-007) |
| `tier` claim missing or unknown value        | `INVALID_TOKEN` | 401  | Caller returns 401; `public_metadata` config error               |

---

### Module: MOD-002 (Owner & Tier Authorization Guard)

**Parent Architecture Modules**: ARCH-002
**Type**: Library (NestJS Guard)
**Target Source File(s)**: `packages/services/recipe-service/src/auth/owner-tier.guard.ts`

#### Interface View

| Direction | Name              | Type   | Format                           | Constraints                                                              |
| --------- | ----------------- | ------ | -------------------------------- | ------------------------------------------------------------------------ |
| Input     | `principal`       | object | Principal from MOD-001           | Required                                                                 |
| Input     | `resourceRef`     | object | `{ kind, id, action }`           | `kind ∈ {recipe,collection,photo}`; `action ∈ {read,write,delete,clone}` |
| Output    | `decision`        | object | `{ allowed: true }`              | Returned only when allowed                                               |
| Exception | `FORBIDDEN_OWNER` | 403    | `{ code, ruleId }`               | Principal is not owner and resource is not public                        |
| Exception | `FORBIDDEN_TIER`  | 403    | `{ code, ruleId, requiredTier }` | Principal tier insufficient for action                                   |

#### Algorithmic / Logic View

```text
function authorize(principal, resourceRef):
  resource ← repository.loadByKind(resourceRef.kind, resourceRef.id)
  if resource is null:
    throw NOT_FOUND  # surfaced by controller as 404
  isOwner  ← (resource.ownerId == principal.userId)
  isPublic ← (resource.visibility == "public")

  if resourceRef.action in {write, delete}:
    if not isOwner:
      throw FORBIDDEN_OWNER(ruleId="OWNER_ONLY_WRITE")
  elif resourceRef.action == read:
    if not (isOwner or isPublic):
      throw FORBIDDEN_OWNER(ruleId="PRIVATE_READ_OWNER_ONLY")
  elif resourceRef.action == clone:
    if not isPublic:
      throw FORBIDDEN_OWNER(ruleId="CLONE_REQUIRES_PUBLIC")

  required ← TIER_REQUIREMENTS[resourceRef.kind][resourceRef.action]
  if required == "premium" and principal.tier != "premium":
    throw FORBIDDEN_TIER(ruleId="PREMIUM_FEATURE", requiredTier="premium")

  return { allowed: true }
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type ResourceRef = {
    kind: 'recipe' | 'collection' | 'photo';
    id: string;
    action: 'read' | 'write' | 'delete' | 'clone';
};
const TIER_REQUIREMENTS: Record<Kind, Record<Action, 'free' | 'premium'>>;
```

#### Error Handling & Return Codes

| Trigger                                | Error Code        | HTTP | Notes                            |
| -------------------------------------- | ----------------- | ---- | -------------------------------- |
| Resource missing                       | `NOT_FOUND`       | 404  | Re-thrown to controller          |
| Write/delete by non-owner              | `FORBIDDEN_OWNER` | 403  | `ruleId=OWNER_ONLY_WRITE`        |
| Read of private resource by non-owner  | `FORBIDDEN_OWNER` | 403  | `ruleId=PRIVATE_READ_OWNER_ONLY` |
| Clone of non-public resource           | `FORBIDDEN_OWNER` | 403  | `ruleId=CLONE_REQUIRES_PUBLIC`   |
| Free user invoking premium-only action | `FORBIDDEN_TIER`  | 403  | `ruleId=PREMIUM_FEATURE`         |

---

### Module: MOD-003 (Recipe HTTP Controller)

**Parent Architecture Modules**: ARCH-003
**Type**: Component (NestJS Controller)
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.controller.ts`

#### Interface View

| Direction | Name               | Type | Format                         | Constraints                                         |
| --------- | ------------------ | ---- | ------------------------------ | --------------------------------------------------- |
| Input     | HTTP request       | HTTP | NestJS controller route + body | Bearer token required; body matches DTO             |
| Output    | HTTP response      | HTTP | JSON resource view + status    | 2xx on success; pagination headers on lists         |
| Exception | mapped via MOD-028 | HTTP | `{ code, message, details? }`  | All thrown domain errors traverse the global filter |

#### Algorithmic / Logic View

```text
@Controller("/v1/recipes")
class RecipesController:
  @Post("/")
  create(@Body raw, @Principal p):
    dto  ← MOD-005.validateCreate(raw)
    view ← MOD-004.execute({ kind:"create", payload: dto, principal: p })
    return 201, view

  @Patch("/:id")
  update(@Param id, @Body raw, @Header("If-Match") rowVersion, @Principal p):
    dto  ← MOD-005.validateUpdate(raw)
    view ← MOD-004.execute({ kind:"update",
                             payload:{...dto, id, expectedRowVersion: rowVersion},
                             principal: p })
    return 200, view

  @Delete("/:id")
  delete(@Param id, @Header("If-Match") rowVersion, @Principal p):
    MOD-004.execute({ kind:"delete",
                      payload:{ id, expectedRowVersion: rowVersion },
                      principal: p })
    return 204

  @Post("/:id/clone")
  clone(@Param id, @Principal p):
    view ← MOD-004.execute({ kind:"clone", payload:{ sourceId: id }, principal: p })
    return 201, view

  @Get("/")
  list(@Query q, @Principal p):
    page ← MOD-010.search(q, p)
    return 200, page, headers={ "X-Total-Pages": page.totalPages }
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type RecipeRouteParams = { id: string };
type RecipeListQuery = {
    q?: string;
    ingredients?: string[];
    visibility?: 'private' | 'public' | 'any';
    ownerScope: 'mine' | 'public' | 'all';
    page: number;
    pageSize: number;
};
type IfMatchHeaderBinding = { expectedRowVersion: string };
type CreateRecipeDto = CreateRecipeRequest; // from MOD-005
type UpdateRecipeDto = UpdateRecipeRequest; // from MOD-005
```

#### Error Handling & Return Codes

The controller never throws domain errors itself — it delegates and lets MOD-028 map.

| Source                         | Mapped HTTP |
| ------------------------------ | ----------- |
| MOD-005 `VALIDATION_FAILED`    | 400         |
| MOD-002 `FORBIDDEN_*`          | 403         |
| MOD-016 `CONCURRENCY_CONFLICT` | 409         |
| MOD-006 `POLICY_DENIED`        | 403         |
| MOD-024 `NOT_FOUND`            | 404         |

---

### Module: MOD-004 (Recipe Command Service)

**Parent Architecture Modules**: ARCH-004
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.command.service.ts`

#### Interface View

| Direction | Name                   | Type   | Format                                          | Constraints                              |
| --------- | ---------------------- | ------ | ----------------------------------------------- | ---------------------------------------- |
| Input     | `command`              | object | `Create\|Update\|Delete\|Clone RecipeCommand`   | Validated; principal attached            |
| Output    | `result`               | object | `RecipeView` with `versionNumber`, `rowVersion` | New `versionNumber` monotonic per recipe |
| Exception | `CONCURRENCY_CONFLICT` | 409    | `{ code, currentRowVersion, currentSnapshot }`  | Raised by MOD-016                        |
| Exception | `POLICY_DENIED`        | 403    | `{ code, ruleId, reason }`                      | Raised by MOD-006                        |
| Exception | `VALIDATION_FAILED`    | 400    | `{ code, fieldErrors[] }`                       | Raised by MOD-005 before service entry   |

#### Algorithmic / Logic View

```text
function execute(command):
  match command.kind:
    case "create":
      MOD-002.authorize(command.principal, { kind:"recipe", id:"*", action:"write" })
      decision ← MOD-006.evaluate({
        tier: command.principal.tier,
        source: "owned",
        currentVisibility: null,
        targetVisibility: command.payload.visibility,
        isSubstantiveEdit: false
      })
      if !decision.allowed: throw POLICY_DENIED(decision)
      resolved  ← MOD-008.resolve(command.payload.ingredients)
      nutrition ← (command.principal.tier == "premium")
                  ? MOD-009.calculate(resolved) : null
      return repository.transaction(tx ⇒ {
        recipeRow ← MOD-024.recipes.insert(tx, build(command.payload, resolved, nutrition))
        snap      ← buildSnapshot(recipeRow, resolved, nutrition)
        { versionNumber } ← MOD-015.write({ recipeId: recipeRow.id, snapshot: snap, txn: tx })
        return toRecipeView(recipeRow, versionNumber)
      })

    case "update":
      before ← MOD-024.recipes.loadById(command.payload.id)
      MOD-002.authorize(command.principal, { kind:"recipe", id:before.id, action:"write" })
      after  ← merge(before, command.payload)
      edit   ← MOD-007.detect(before, after)
      decision ← MOD-006.evaluate({
        tier: command.principal.tier,
        source: before.source,
        currentVisibility: before.visibility,
        targetVisibility: after.visibility,
        isSubstantiveEdit: edit.isSubstantive
      })
      if !decision.allowed: throw POLICY_DENIED(decision)
      resolved  ← MOD-008.resolve(after.ingredients)
      nutrition ← (command.principal.tier == "premium")
                  ? MOD-009.calculate(resolved) : before.nutrition
      return repository.transaction(tx ⇒ {
        MOD-016.guard({ table:"recipes", id: before.id,
                        expectedRowVersion: command.payload.expectedRowVersion })
        updated ← MOD-024.recipes.update(tx, before.id, after, resolved, nutrition)
        snap    ← buildSnapshot(updated, resolved, nutrition)
        { versionNumber } ← MOD-015.write({ recipeId: updated.id, snapshot: snap, txn: tx })
        # VERSION_WRITE_FAILED propagates to caller; transaction is aborted by MOD-024.
        return toRecipeView(updated, versionNumber)
      })

    case "delete":
      before ← MOD-024.recipes.loadById(command.payload.id)
      MOD-002.authorize(command.principal, { kind:"recipe", id:before.id, action:"delete" })
      repository.transaction(tx ⇒ {
        MOD-016.guard({ table:"recipes", id:before.id,
                        expectedRowVersion: command.payload.expectedRowVersion })
        MOD-024.recipes.softDelete(tx, before.id)
      })
      return { id: before.id, deleted: true }

    case "clone":
      source ← MOD-024.recipes.loadById(command.payload.sourceId)
      MOD-002.authorize(command.principal, { kind:"recipe", id:source.id, action:"clone" })
      cloned ← buildClone(source, owner=command.principal.userId)
      return execute({ kind:"create", payload: cloned, principal: command.principal })
```

#### State Machine View

Per-command state lives only in the DB transaction.

#### Internal Data Structures

```ts
type RecipeCommand =
    | { kind: 'create'; payload: CreateRecipeRequest; principal: Principal }
    | {
          kind: 'update';
          payload: UpdateRecipeRequest & { id: string; expectedRowVersion: string };
          principal: Principal;
      }
    | { kind: 'delete'; payload: { id: string; expectedRowVersion: string }; principal: Principal }
    | { kind: 'clone'; payload: { sourceId: string }; principal: Principal };
type RecipeView = { id: string; versionNumber: number; rowVersion: string /* …fields… */ };
```

#### Error Handling & Return Codes

| Trigger                              | Error Code             | HTTP |
| ------------------------------------ | ---------------------- | ---- |
| Bad DTO                              | `VALIDATION_FAILED`    | 400  |
| Visibility / substantive edit denied | `POLICY_DENIED`        | 403  |
| `If-Match` mismatch                  | `CONCURRENCY_CONFLICT` | 409  |
| Recipe not found                     | `NOT_FOUND`            | 404  |
| DB write failure                     | `VERSION_WRITE_FAILED` | 500  |

---

### Module: MOD-005 (Recipe DTO Validator)

**Parent Architecture Modules**: ARCH-005
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.dto.ts`

#### Interface View

| Direction | Name                | Type   | Format                                     | Constraints                                                |
| --------- | ------------------- | ------ | ------------------------------------------ | ---------------------------------------------------------- |
| Input     | `rawBody`           | object | unsanitized JSON                           | Any object                                                 |
| Output    | `dto`               | object | typed `CreateRecipeRequest` etc.           | Strict whitelist; trimmed strings; numeric ranges enforced |
| Exception | `VALIDATION_FAILED` | 400    | `{ fieldErrors[]: {path, code, message} }` | Aggregates all rule violations                             |

#### Algorithmic / Logic View

```text
function validateCreate(raw):
  dto    ← class-transformer.plainToInstance(CreateRecipeRequest, raw,
                                              { excludeExtraneousValues: true })
  errors ← class-validator.validateSync(dto, { whitelist: true,
                                                forbidNonWhitelisted: true })
  if errors.length > 0:
    throw VALIDATION_FAILED(flatten(errors))
  return dto

# validateUpdate / validatePatch: identical, with their own DTO classes.
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
class CreateRecipeRequest {
    @IsString() @Length(1, 200) title!: string;
    @IsArray() @ValidateNested({ each: true }) @Type(() => IngredientItem) ingredients!: IngredientItem[];
    @IsArray() @IsString({ each: true }) @ArrayMaxSize(50) instructions!: string[];
    @IsIn(['private', 'public']) visibility!: 'private' | 'public';
    @IsOptional() @IsInt() @Min(1) @Max(100) servings?: number;
}
class IngredientItem {
    @IsIn(['linked', 'freeform']) kind!: 'linked' | 'freeform';
    @IsOptional() @IsUUID() id?: string;
    @IsOptional() @IsString() @Length(1, 200) text?: string;
    @IsNumber() @Min(0) quantity!: number;
    @IsString() unit!: string;
}
```

#### Error Handling & Return Codes

| Trigger                                           | Error Code          | HTTP |
| ------------------------------------------------- | ------------------- | ---- |
| Unknown / extra field                             | `VALIDATION_FAILED` | 400  |
| Wrong type / out-of-range numeric                 | `VALIDATION_FAILED` | 400  |
| `linked` without `id` / `freeform` without `text` | `VALIDATION_FAILED` | 400  |

---

### Module: MOD-006 (Visibility Policy Engine)

**Parent Architecture Modules**: ARCH-006
**Type**: Library (pure function)
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/visibility.policy.ts`

#### Interface View

| Direction | Name              | Type   | Format                                                                     | Constraints                                                   |
| --------- | ----------------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Input     | `context`         | object | `{ tier, source, currentVisibility, targetVisibility, isSubstantiveEdit }` | All required; values from enums                               |
| Output    | `decision`        | object | `{ allowed: boolean, reason: string, ruleId: string }`                     | Deterministic                                                 |
| Exception | `POLICY_INTERNAL` | 500    | `{ code, ruleId? }`                                                        | Thrown only on enum mismatch (programming error); fail-closed |

#### Algorithmic / Logic View

```text
function evaluate(ctx):
  if ctx.targetVisibility not in ["private","public"]:
    throw POLICY_INTERNAL(ruleId="ENUM_TARGET_VISIBILITY")
  if ctx.tier not in ["free","premium"]:
    throw POLICY_INTERNAL(ruleId="ENUM_TIER")

  # Rule R2: cloned recipes cannot be made public until substantively edited.
  if ctx.source == "cloned"
     and ctx.targetVisibility == "public"
     and not ctx.isSubstantiveEdit:
    return { allowed:false, ruleId:"R2_CLONED_NEEDS_SUBSTANTIVE_EDIT",
             reason:"Cloned recipes must be substantively edited before going public" }

  return { allowed:true, ruleId:"ALLOW", reason:"ok" }
```

#### State Machine View

Stateless. All state transitions are delegated to the persistence layer (ARCH-004 via MOD-024) and the module itself holds no mutable state. Concurrency safety is ensured by optimistic locking at the repository level (see MOD-016).

#### Internal Data Structures

```ts
type PolicyContext = {
    tier: 'free' | 'premium';
    source: 'owned' | 'cloned';
    currentVisibility: 'private' | 'public' | null;
    targetVisibility: 'private' | 'public';
    isSubstantiveEdit: boolean;
};
type PolicyDecision = { allowed: boolean; reason: string; ruleId: string };
```

#### Error Handling & Return Codes

| Trigger                           | Error Code                                             | HTTP |
| --------------------------------- | ------------------------------------------------------ | ---- |
| Enum mismatch (programming error) | `POLICY_INTERNAL`                                      | 500  |
| Disallowed transition             | returns `allowed=false`; caller throws `POLICY_DENIED` | 403  |

---

### Module: MOD-007 (Substantive Edit Detector)

**Parent Architecture Modules**: ARCH-007
**Type**: Library (pure function)
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/substantive-edit.detector.ts`

#### Interface View

| Direction | Name           | Type   | Format                                                | Constraints                                                             |
| --------- | -------------- | ------ | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Input     | `beforeRecipe` | object | `RecipeSnapshot`                                      | Required                                                                |
| Input     | `afterRecipe`  | object | `RecipeSnapshot`                                      | Required                                                                |
| Output    | `result`       | object | `{ isSubstantive: boolean, changedFields: string[] }` | `isSubstantive=true` iff ingredients or instructions materially changed |
| Exception | none           | —      | —                                                     | Pure function                                                           |

#### Algorithmic / Logic View

```text
function detect(before, after):
  changed ← []
  if normalizeIngredients(before.ingredients) ≠ normalizeIngredients(after.ingredients):
    changed.push("ingredients")
  if normalizeInstructions(before.instructions) ≠ normalizeInstructions(after.instructions):
    changed.push("instructions")
  if before.title.trim() ≠ after.title.trim():
    changed.push("title")          # not substantive on its own
  isSubstantive ← changed.includes("ingredients") or changed.includes("instructions")
  return { isSubstantive, changedFields: changed }

function normalizeIngredients(items):
  return items
    .map(i ⇒ { kind:i.kind, ref: i.id ?? i.text.toLowerCase().trim(),
               qty: roundTo3(i.quantity), unit: i.unit })
    .sort(by ref)

function roundTo3(n):
  return Math.round(n * 1000) / 1000

function normalizeInstructions(steps):
  return steps.map(s ⇒ s.toLowerCase().replace(/\s+/g," ").trim())
```

#### State Machine View

Stateless. Pure function over the two supplied snapshots; holds no mutable state and performs no I/O.

#### Internal Data Structures

```ts
type RecipeSnapshot = {
    title: string;
    ingredients: { kind: 'linked' | 'freeform'; foodId?: string; text?: string; quantity: number; unit: string }[];
    instructions: string[];
};
type EditResult = { isSubstantive: boolean; changedFields: string[] };
```

#### Error Handling & Return Codes

| Trigger                                            | Error Code | HTTP |
| -------------------------------------------------- | ---------- | ---- |
| none — pure function; total over well-formed input | —          | —    |

---

### Module: MOD-008 (Ingredient Resolver Service)

**Parent Architecture Modules**: ARCH-008
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/ingredients/ingredient-resolver.service.ts`

**Food resolution is asynchronous (003).** This module owns the `ingredients` / `recipe_ingredients` link plus a `foodResolutionStatus` field and a separate `isUserEntered` boolean; it resolves linked references against the source-agnostic food service (003) via `@kitchensink/food-service-client` (`FoodServiceClient`) using an **opaque food `foodId` ULID** and never stores the source `fdcId`. A just-added food may still be `PENDING` / `UNRESOLVED`; `NOT_FOUND` / `FAILED` are terminal.

#### Interface View

| Direction | Name                   | Type  | Format                                                                                          | Constraints                                                                                                                                                                                                                         |
| --------- | ---------------------- | ----- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input     | `items`                | array | `[{ kind: "linked"\|"freeform", foodId?, text?, quantity, unit }]`                              | `linked` requires an opaque food `foodId` (ULID from `@kitchensink/food-service-client`, never the source `fdcId`); `freeform` requires `text`                                                                                      |
| Output    | `resolved`             | array | `[{ inputIndex, ingredientId?, foodId?, foodResolutionStatus?, isUserEntered, normalizedQty }]` | Stable order matching input; `foodResolutionStatus ∈ {PENDING, UNRESOLVED, RESOLVED, NOT_FOUND, FAILED}` (UPPER_SNAKE); freeform / user-supplied entry is the **separate** `isUserEntered` boolean, never a resolution-status value |
| Exception | `INGREDIENT_NOT_FOUND` | 404   | `{ code, inputIndex, attemptedFoodId }`                                                         | Linked `foodId` unknown to the food service                                                                                                                                                                                         |
| Exception | `UNIT_INCONVERTIBLE`   | 422   | `{ code, inputIndex, fromUnit, toUnit }`                                                        | Quantity unit cannot normalize to the canonical unit                                                                                                                                                                                |

#### Algorithmic / Logic View

```text
function resolve(items):
  resolved ← []
  linkedIds ← items.filter(i ⇒ i.kind == "linked").map(i ⇒ i.foodId)
  foods     ← MOD-024.ingredients.loadByIds(linkedIds)   # link rows + current foodResolutionStatus
  for (i, idx) in items:
    if i.kind == "freeform":
      resolved.push({ inputIndex: idx, isUserEntered: true,
                      normalizedQty: normalize(i.quantity, i.unit) })
      continue
    link ← foods.get(i.foodId)
    if !link:
      throw INGREDIENT_NOT_FOUND({ code:"INGREDIENT_NOT_FOUND", inputIndex: idx, attemptedFoodId: i.foodId })
    resolved.push({ inputIndex: idx, ingredientId: link.ingredientId, foodId: i.foodId,
                    foodResolutionStatus: link.foodResolutionStatus,   # PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED
                    isUserEntered: false, normalizedQty: normalize(i.quantity, i.unit) })
  return resolved

# normalize(quantity, fromUnit) → { quantity, unit } in a canonical unit; UNIT_INCONVERTIBLE on unknown unit.
function normalize(quantity, fromUnit):
  if fromUnit in MASS_TO_G:   return { quantity: quantity * MASS_TO_G[fromUnit], unit: "g" }
  if fromUnit in VOLUME_TO_ML: return { quantity: quantity * VOLUME_TO_ML[fromUnit], unit: "ml" }
  throw UNIT_INCONVERTIBLE({ code:"UNIT_INCONVERTIBLE", fromUnit, toUnit: "g|ml" })
```

#### State Machine View

Stateless service. The `foodResolutionStatus` lifecycle (`PENDING`/`UNRESOLVED` → `RESOLVED` | `NOT_FOUND` | `FAILED`) is advanced **asynchronously by the food service (003)** and read through the persistence layer (MOD-024); this module holds no mutable state and issues no status transition itself.

#### Internal Data Structures

```ts
type ResolvedItem = {
    inputIndex: number;
    ingredientId?: string;
    foodId?: string;
    foodResolutionStatus?: 'PENDING' | 'UNRESOLVED' | 'RESOLVED' | 'NOT_FOUND' | 'FAILED';
    isUserEntered: boolean;
    normalizedQty: { quantity: number; unit: string };
};
type UnitConversionMap = Record<string, number>;
const MASS_TO_G: UnitConversionMap = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const VOLUME_TO_ML: UnitConversionMap = { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, cup: 236.588 };
```

#### Error Handling & Return Codes

| Trigger                                                     | Error Code                 | HTTP |
| ----------------------------------------------------------- | -------------------------- | ---- |
| Linked `foodId` unknown to the food service                 | `INGREDIENT_NOT_FOUND`     | 404  |
| Ingredient quantity unit cannot normalize to canonical unit | `UNIT_INCONVERTIBLE`       | 422  |
| DB unavailable                                              | `DB_UNAVAILABLE` (MOD-024) | 503  |

---

### Module: MOD-009 (Nutrition Calculator)

**Parent Architecture Modules**: ARCH-009
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/nutrition/nutrition.calculator.ts`

#### Interface View

| Direction | Name                 | Type   | Format                                      | Constraints                                |
| --------- | -------------------- | ------ | ------------------------------------------- | ------------------------------------------ |
| Input     | `resolvedItems`      | array  | output of MOD-008                           | Required                                   |
| Output    | `nutrition`          | object | `{ perServing, perRecipe, missingItems[] }` | Numeric ≥ 0; rounded to 1 decimal          |
| Exception | `UNIT_INCONVERTIBLE` | 422    | `{ code, inputIndex, fromUnit, toUnit }`    | Quantity unit cannot be converted to grams |

#### Algorithmic / Logic View

```text
function calculate(resolvedItems):
  perRecipe  ← { kcal:0, proteinG:0, fatG:0, carbsG:0 }
  missingItems ← []
  ids     ← resolvedItems.filter(r ⇒ r.ingredientId).map(r ⇒ r.ingredientId)
  facts   ← MOD-024.nutritionFacts.loadByIds(ids)
  for r in resolvedItems:
    if r.freeform or !facts.has(r.ingredientId):
      missingItems.push(r.inputIndex); continue
    f      ← facts.get(r.ingredientId)
    grams  ← convertToGrams(r.normalizedQty.quantity, r.normalizedQty.unit, f.density)
    if grams is null:
      throw UNIT_INCONVERTIBLE({ code:"UNIT_INCONVERTIBLE", inputIndex:r.inputIndex,
                                 fromUnit:r.normalizedQty.unit, toUnit:"g" })
    factor ← grams / 100
    perRecipe.kcal     += f.kcalPer100g     * factor
    perRecipe.proteinG += f.proteinGPer100g * factor
    perRecipe.fatG     += f.fatGPer100g     * factor
    perRecipe.carbsG   += f.carbsGPer100g   * factor
  round1(perRecipe)
  servings ← inferServings(resolvedItems) ?? 1
  perServing ← round1({
    kcal: perRecipe.kcal / servings,
    proteinG: perRecipe.proteinG / servings,
    fatG: perRecipe.fatG / servings,
    carbsG: perRecipe.carbsG / servings
  })
  return { perServing, perRecipe, missingItems }

function convertToGrams(quantity, unit, density):
  if unit in MASS_TO_G:
    return quantity * MASS_TO_G[unit]
  if unit in VOLUME_TO_ML:
    ml ← quantity * VOLUME_TO_ML[unit]
    return ml * density      # grams = quantity_in_ml * density
  return null
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type NutritionTotals = { kcal: number; proteinG: number; fatG: number; carbsG: number };
type NutritionResult = { perServing: NutritionTotals; perRecipe: NutritionTotals; missingItems: number[] };
type UnitConversionMap = Record<string, number>;
const MASS_TO_G: UnitConversionMap = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const VOLUME_TO_ML: UnitConversionMap = { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, cup: 236.588 };
```

#### Error Handling & Return Codes

| Trigger                                    | Error Code           | HTTP | Behavior                                                |
| ------------------------------------------ | -------------------- | ---- | ------------------------------------------------------- |
| Freeform item                              | —                    | —    | Skipped; `inputIndex` added to `missingItems`           |
| Linked id with no nutrition fact row       | —                    | —    | Skipped; `inputIndex` added to `missingItems`           |
| Unit not convertible to grams              | `UNIT_INCONVERTIBLE` | 422  | Throw to caller with `inputIndex`, `fromUnit`, `toUnit` |
| DB unavailable from nutrition facts lookup | `DB_UNAVAILABLE`     | 503  | Propagated from MOD-024; caller receives 503            |

---

### Module: MOD-010 (Recipe Search Service)

**Parent Architecture Modules**: ARCH-010
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.search.service.ts`

#### Interface View

| Direction | Name             | Type   | Format                                                          | Constraints                                |
| --------- | ---------------- | ------ | --------------------------------------------------------------- | ------------------------------------------ |
| Input     | `query`          | object | `{ q?, ingredients?, visibility?, ownerScope, page, pageSize }` | `pageSize ≤ 100`; `page ≥ 1`               |
| Input     | `principal`      | object | Principal                                                       | Required                                   |
| Output    | `page`           | object | `{ items: RecipeListItem[], page, totalPages, totalCount }`     | Items respect visibility + ownership rules |
| Exception | `BAD_QUERY`      | 400    | `{ code, fieldErrors[] }`                                       | Pagination/filter validation failure       |
| Exception | `SEARCH_TIMEOUT` | 504    | `{ code, queryHash }`                                           | Search call exceeded configured timeout    |

#### Algorithmic / Logic View

```text
function search(query, principal):
  if query.pageSize > 100 or query.page < 1: throw BAD_QUERY(...)
  spec ← MOD-011.build(query, principal)
  deadlineMs ← config.searchTimeoutMs
  try:
    rows ← withDeadline(MOD-024.recipes.searchPage(spec), deadlineMs)
    total ← withDeadline(MOD-024.recipes.searchCount(spec), deadlineMs)
  catch e:
    if isDeadlineExceeded(e):
      throw SEARCH_TIMEOUT({ code:"SEARCH_TIMEOUT", queryHash: hash(spec) })
    throw e
  return {
    items: rows.map(toListItem),
    page: query.page,
    totalPages: ceil(total / query.pageSize),
    totalCount: total
  }
```

#### State Machine View

Stateless. All state transitions are delegated to the persistence layer (ARCH-010 via MOD-024) and the module itself holds no mutable state. Concurrency safety is ensured by optimistic locking at the repository level (see MOD-016).

#### Internal Data Structures

```ts
type SearchQuery = {
    q?: string;
    ingredients?: string[];
    visibility?: 'private' | 'public' | 'any';
    ownerScope: 'mine' | 'public' | 'all';
    page: number;
    pageSize: number;
};
type RecipeListItem = {
    id: string;
    title: string;
    visibility: 'private' | 'public';
    thumbnailUrl?: string;
    rowVersion: string;
};
```

#### Error Handling & Return Codes

| Trigger                           | Error Code       | HTTP |
| --------------------------------- | ---------------- | ---- |
| Bad pagination / filter conflict  | `BAD_QUERY`      | 400  |
| Query execution exceeded deadline | `SEARCH_TIMEOUT` | 504  |
| DB unavailable                    | `DB_UNAVAILABLE` | 503  |

---

### Module: MOD-011 (Search Query Builder)

**Parent Architecture Modules**: ARCH-011
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/search-query.builder.ts`

#### Interface View

| Direction | Name             | Type   | Format                                      | Constraints                                      |
| --------- | ---------------- | ------ | ------------------------------------------- | ------------------------------------------------ |
| Input     | `query`          | object | `SearchQuery`                               | Validated by MOD-010                             |
| Input     | `principal`      | object | Principal                                   | Required                                         |
| Output    | `spec`           | object | `{ where, params, orderBy, limit, offset }` | Parameterized; no string interpolation of inputs |
| Exception | `INVALID_FILTER` | 400    | `{ code, field }`                           | Filter outside whitelist                         |

#### Algorithmic / Logic View

```text
function build(q, p):
  allowedKeys ← {"q","ingredients","visibility","ownerScope","page","pageSize"}
  for key in keys(q):
    if key not in allowedKeys:
      throw INVALID_FILTER({ code:"INVALID_FILTER", field:key })
  where  ← []
  params ← {}
  if q.ownerScope == "mine":
    where.push("owner_id = :uid"); params.uid = p.userId
    if q.visibility: where.push("visibility = :v"); params.v = q.visibility
  elif q.ownerScope == "public":
    where.push("visibility = 'public'")
  else:                                         # "all"
    where.push("(visibility = 'public' OR owner_id = :uid)")
    params.uid = p.userId
  if q.q:
    where.push("search_tsv @@ plainto_tsquery('english', :q)")
    params.q = q.q
  if q.ingredients and q.ingredients.length > 0:
    where.push("recipe_id IN (SELECT recipe_id FROM recipe_ingredients " +
               "WHERE ingredient_id = ANY(:ings))")
    params.ings = q.ingredients
  return {
    where: where.join(" AND "),
    params,
    orderBy: "updated_at DESC",
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize
  }
```

#### State Machine View

Stateless. All state transitions are delegated to the persistence layer (ARCH-010 via MOD-024) and the module itself holds no mutable state. Concurrency safety is ensured by optimistic locking at the repository level (see MOD-016).

#### Internal Data Structures

```ts
type QuerySpec = { where: string; params: Record<string, unknown>; orderBy: string; limit: number; offset: number };
```

#### Error Handling & Return Codes

| Trigger                            | Error Code       | HTTP |
| ---------------------------------- | ---------------- | ---- |
| Unknown filter key in query object | `INVALID_FILTER` | 400  |

---

### Module: MOD-012 (Photo Presign Service)

**Parent Architecture Modules**: ARCH-012
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/photos/photo.presign.service.ts`

#### Interface View

| Direction | Name                    | Type   | Format                                         | Constraints                                                            |
| --------- | ----------------------- | ------ | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Input     | `request`               | object | `{ recipeId, contentType, byteSize }`          | `contentType ∈ {image/jpeg, image/png, image/webp}`; `byteSize ≤ 10MB` |
| Input     | `principal`             | object | Principal                                      | Required                                                               |
| Output    | `presigned`             | object | `{ uploadUrl, objectKey, expiresAt, headers }` | URL valid 5 min                                                        |
| Exception | `INVALID_PHOTO`         | 400    | `{ code, fieldErrors[] }`                      | Bad content-type / size                                                |
| Exception | `UPLOAD_QUOTA_EXCEEDED` | 429    | `{ code, retryAfter }`                         | Per-user pending upload quota exceeded                                 |
| Exception | `FORBIDDEN_OWNER`       | 403    | from MOD-002                                   |                                                                        |

#### Algorithmic / Logic View

```text
function presign(req, principal):
  validate(req)                                # type + size whitelist
  MOD-002.authorize(principal, { kind:"recipe", id:req.recipeId, action:"write" })
  if MOD-024.photoUploads.countPendingForUser(principal.userId) >= QUOTA_LIMIT:
    throw UPLOAD_QUOTA_EXCEEDED({ code:"UPLOAD_QUOTA_EXCEEDED", retryAfter: 60 })
  objectKey ← `recipes/${req.recipeId}/photos/${uuidv7()}.${extOf(req.contentType)}`
  url       ← MOD-025.getPresignedPutUrl({
                key: objectKey,
                contentType: req.contentType,
                contentLength: req.byteSize,
                expiresInSec: 300
              })
  MOD-024.photoUploads.insertPending({ key: objectKey,
                                       recipeId: req.recipeId,
                                       ownerId: principal.userId })
  return { uploadUrl: url, objectKey, expiresAt: now()+300s,
           headers: { "Content-Type": req.contentType } }
```

#### State Machine View

Stateless service; pending upload row is in `pending` state until MOD-013 confirms.

#### Internal Data Structures

```ts
type PresignRequest = { recipeId: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp'; byteSize: number };
type PresignResponse = { uploadUrl: string; objectKey: string; expiresAt: string; headers: Record<string, string> };
const QUOTA_LIMIT = 25;
```

#### Error Handling & Return Codes

| Trigger                             | Error Code              | HTTP |
| ----------------------------------- | ----------------------- | ---- |
| Disallowed content-type / over size | `INVALID_PHOTO`         | 400  |
| Pending upload quota exceeded       | `UPLOAD_QUOTA_EXCEEDED` | 429  |
| Non-owner of target recipe          | `FORBIDDEN_OWNER`       | 403  |
| S3 sign failure                     | `S3_UNAVAILABLE`        | 503  |

---

### Module: MOD-013 (Photo Confirm Service)

**Parent Architecture Modules**: ARCH-013
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/photos/photo.confirm.service.ts`

#### Interface View

| Direction | Name               | Type   | Format                          | Constraints                                                 |
| --------- | ------------------ | ------ | ------------------------------- | ----------------------------------------------------------- |
| Input     | `confirmation`     | object | `{ objectKey, etag }`           | `objectKey` must match a pending row owned by the principal |
| Input     | `principal`        | object | Principal                       | Required                                                    |
| Output    | `photo`            | object | `{ photoId, recipeId, status }` | `status="pending_processing"`                               |
| Exception | `UPLOAD_NOT_FOUND` | 404    | `{ code, key }`                 | No matching pending upload                                  |
| Exception | `UPLOAD_INVALID`   | 422    | `{ code, reason }`              | ETag mismatch or object missing                             |

#### Algorithmic / Logic View

```text
function confirm(c, principal):
  pending ← MOD-024.photoUploads.findPendingByKey(c.objectKey)
  if !pending:                              throw UPLOAD_NOT_FOUND({ code:"UPLOAD_NOT_FOUND", key:c.objectKey })
  if pending.ownerId != principal.userId:      throw FORBIDDEN_OWNER
  meta ← MOD-025.headObject(c.objectKey)
  if !meta:                                 throw UPLOAD_INVALID({ code:"UPLOAD_INVALID", reason:"object missing" })
  if meta.etag != c.etag:                   throw UPLOAD_INVALID({ code:"UPLOAD_INVALID", reason:"etag mismatch" })
  return repository.transaction(tx ⇒ {
    photo ← MOD-024.photos.insert(tx, {
              recipeId: pending.recipeId,
              ownerId:  pending.ownerId,
              objectKey: c.objectKey,
              status: "pending_processing",
              sizeBytes: meta.contentLength,
              contentType: meta.contentType
            })
    MOD-024.photoUploads.markConfirmed(tx, c.objectKey, photo.id)
    return { photoId: photo.id, recipeId: pending.recipeId, status: "pending_processing" }
  })
```

#### State Machine View

Stateless. Photo-row completion (`pending → complete | failed`) is performed by the Fargate `photo-processed` SQS consumer after MOD-014 renders derivatives to S3 (MOD-014 is S3-only and touches no DB — D1); the service itself holds no mutable state. Concurrency safety is ensured by optimistic locking at the repository level (see MOD-016).

#### Internal Data Structures

```ts
type PhotoConfirmation = { objectKey: string; etag: string };
type PhotoView = { photoId: string; recipeId: string; status: 'pending_processing' | 'ready' | 'failed' };
```

#### Error Handling & Return Codes

| Trigger              | Error Code         | HTTP |
| -------------------- | ------------------ | ---- |
| Pending row missing  | `UPLOAD_NOT_FOUND` | 404  |
| Object missing in S3 | `UPLOAD_INVALID`   | 422  |
| ETag mismatch        | `UPLOAD_INVALID`   | 422  |
| Non-owner            | `FORBIDDEN_OWNER`  | 403  |

---

### Module: MOD-014 (Photo Processing Lambda Handler)

**Parent Architecture Modules**: ARCH-014
**Type**: Service (Lambda)
**Target Source File(s)**: `packages/services/recipe-workers/src/photo-processor/handler.ts`

**Topology (D1 / ADR-0004)**: This Lambda is **S3-only and NOT VPC-attached** — it **touches no DB**. It reads the original from S3, renders WebP derivatives back to S3, and emits an SQS **`photo-processed`** message. The `recipe_photos` completion `UPDATE` is performed downstream by the in-VPC **Fargate `photo-processed` consumer** (see below), never by this Lambda.

#### Interface View

| Direction | Name          | Type   | Format                                                       | Constraints                                         |
| --------- | ------------- | ------ | ------------------------------------------------------------ | --------------------------------------------------- |
| Input     | `s3Event`     | object | S3 ObjectCreated event                                       | Triggered by S3 PutObject in `uploads/*/original.*` |
| Output    | (side-effect) | —      | Writes S3 derivatives + emits `photo-processed` SQS          | No DB access; idempotent on re-delivery             |
| Exception | (logged)      | —      | Emits `photo-processed` with `status:"failed"` and re-throws | Routed to Lambda DLQ after retries                  |

#### Algorithmic / Logic View

```text
function handle(event):
  for record in event.Records:
    key           ← record.s3.object.key             # uploads/{uuid}/original.{ext}
    recipePhotoId ← parsePhotoId(record)             # from object key / S3 object metadata
    try:
      bytes    ← MOD-025.getObject(key)
      orig     ← Sharp(bytes).rotate()               # honor EXIF
      stripped ← orig.withMetadata(false)            # strip GPS/EXIF
      thumb    ← stripped.clone().resize(150,150,{fit:"cover"}).webp({quality:80}).toBuffer()
      card     ← stripped.clone().resize(400,400,{fit:"cover"}).webp({quality:82}).toBuffer()
      full     ← stripped.clone().resize(1200,1200,{fit:"inside",withoutEnlargement:true}).webp({quality:82}).toBuffer()
      MOD-025.putObject(renditionKey(key,"thumb"), thumb, "image/webp")
      MOD-025.putObject(renditionKey(key,"card"),  card,  "image/webp")
      MOD-025.putObject(renditionKey(key,"full"),  full,  "image/webp")
      # S3-only: signal completion via SQS; the Fargate consumer writes the DB row.
      MOD-025.sqs.sendMessage({
        queueUrl: config.photoProcessedQueueUrl,
        messageBody: JSON.stringify({
          recipePhotoId,
          s3_key_thumb: renditionKey(key,"thumb"),
          s3_key_card:  renditionKey(key,"card"),
          s3_key_full:  renditionKey(key,"full"),
          status: "complete"
        })
      })
      # Optional: delete the original from S3 after successful processing.
    catch e:
      # Never writes the DB; reports the failure downstream via SQS.
      MOD-025.sqs.sendMessage({
        queueUrl: config.photoProcessedQueueUrl,
        messageBody: JSON.stringify({ recipePhotoId, status: "failed", error: e.message })
      })
      throw e                                         # let Lambda retry → DLQ
```

**Downstream completion — Fargate `photo-processed` consumer.** The `recipe_photos` completion `UPDATE` is performed by an **in-VPC SQS consumer inside the Fargate recipe API** (`packages/services/recipe-service`, Photos module domain), which reaches RDS. On each `photo-processed` message it runs (idempotent):

```text
UPDATE recipe_photos SET
    s3_key_thumb = msg.s3_key_thumb, s3_key_card = msg.s3_key_card, s3_key_full = msg.s3_key_full,
    processing_status = msg.status            -- 'complete' | 'failed'
WHERE id = msg.recipePhotoId
```

This split preserves ADR-0004: the processor Lambda stays S3-only / not VPC-attached, and only the Fargate service touches the DB.

#### State Machine View

The Lambda is stateless and holds no DB state; it renders S3 derivatives and emits a `photo-processed` message. The `recipe_photos.processing_status` transition (`pending → complete | failed`) is owned by the Fargate `photo-processed` consumer, never by this Lambda.

#### Internal Data Structures

```ts
type RenditionKey = `photos/${string}/${'thumb' | 'card' | 'full'}.webp`;
type PhotoProcessedMessage = {
    recipePhotoId: string;
    s3_key_thumb?: string;
    s3_key_card?: string;
    s3_key_full?: string;
    status: 'complete' | 'failed';
    error?: string;
};
```

#### Error Handling & Return Codes

| Trigger                | Behavior                                                            |
| ---------------------- | ------------------------------------------------------------------- |
| Object not found in S3 | Emit `photo-processed` `status:"failed"`; throw → DLQ (no DB write) |
| Sharp decode failure   | Emit `photo-processed` `status:"failed"`; throw → DLQ (no DB write) |
| Repeated delivery      | Re-render + re-emit; the Fargate consumer's `UPDATE` is idempotent  |

---

### Module: MOD-015 (Version Snapshot Writer)

**Parent Architecture Modules**: ARCH-015
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/version-snapshot.writer.ts`

#### Interface View

| Direction | Name                   | Type   | Format                                           | Constraints                                       |
| --------- | ---------------------- | ------ | ------------------------------------------------ | ------------------------------------------------- |
| Input     | `request`              | object | `{ recipeId, snapshot, txn }`                    | Must be invoked inside an open transaction        |
| Output    | `result`               | object | `{ versionNumber, versionId, pendingArchiveId }` | `versionNumber` strictly increases per `recipeId` |
| Exception | `VERSION_WRITE_FAILED` | 500    | `{ code, recipeId }`                             | DB write failure inside transaction               |

#### Algorithmic / Logic View

```text
function write(req):
  next ← MOD-024.recipeVersions.nextNumber(req.txn, req.recipeId)   # SELECT … FOR UPDATE
  row  ← MOD-024.recipeVersions.insert(req.txn, {
           recipeId: req.recipeId,
           versionNumber: next,
           snapshotJson: req.snapshot,
           createdAt: now()
         })
  # D6: the pending-archive row carries NO snapshot column — the replay payload IS
  # recipe_versions.snapshot (the same-transaction row just inserted above).
  pending ← MOD-024.recipeVersionPendingArchives.insert(req.txn, {
              recipeVersionId: row.id,        # FK → recipe_versions(id)
              recipeId: req.recipeId,
              versionNumber: next,
              status: "pending"               # attempts, next_attempt_at, timestamps default
            })
  return { versionNumber: next, versionId: row.id, pendingArchiveId: pending.id }
```

#### State Machine View

Stateless within a single transaction.

#### Internal Data Structures

```ts
type RecipeSnapshotJson = {
    title: string;
    ingredients: ResolvedItem[];
    instructions: string[];
    visibility: 'private' | 'public';
    nutrition?: NutritionTotals;
};
type VersionWriteResult = { versionNumber: number; versionId: string; pendingArchiveId: string };
```

#### Error Handling & Return Codes

| Trigger                       | Error Code                                          | HTTP |
| ----------------------------- | --------------------------------------------------- | ---- |
| Insert failure inside txn     | `VERSION_WRITE_FAILED`                              | 500  |
| Counter contention (deadlock) | Re-thrown to caller; transaction retried by MOD-024 |

---

### Module: MOD-016 (Optimistic Concurrency Guard)

**Parent Architecture Modules**: ARCH-016
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/persistence/concurrency.guard.ts`

#### Interface View

| Direction | Name                   | Type   | Format                                         | Constraints                                                |
| --------- | ---------------------- | ------ | ---------------------------------------------- | ---------------------------------------------------------- |
| Input     | `request`              | object | `{ table, id, expectedRowVersion }`            | `expectedRowVersion` sourced from client `If-Match` header |
| Output    | `ok`                   | bool   | `true` only if rowVersion matches              |                                                            |
| Exception | `CONCURRENCY_CONFLICT` | 409    | `{ code, currentRowVersion, currentSnapshot }` | Row was modified since client read it                      |
| Exception | `NOT_FOUND`            | 404    |                                                | Row no longer exists                                       |

#### Algorithmic / Logic View

```text
function guard(req):
  current ← MOD-024[req.table].loadRowVersion(req.id)
  if !current:                                  throw NOT_FOUND
  if current.rowVersion != req.expectedRowVersion:
      snap ← MOD-024[req.table].loadById(req.id)
      throw CONCURRENCY_CONFLICT(currentRowVersion: current.rowVersion,
                                  currentSnapshot:   snap)
  return true
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type ConcurrencyRequest = { table: 'recipes' | 'collections' | 'photos'; id: string; expectedRowVersion: string };
```

#### Error Handling & Return Codes

| Trigger                            | Error Code             | HTTP |
| ---------------------------------- | ---------------------- | ---- |
| Client `If-Match` stale            | `CONCURRENCY_CONFLICT` | 409  |
| Row deleted between read and write | `NOT_FOUND`            | 404  |

---

### Module: MOD-017 (Archive Queue Producer)

**Parent Architecture Modules**: ARCH-017
**Type**: Adapter
**Target Source File(s)**: `packages/services/recipe-service/src/archive/archive-queue.producer.ts`

#### Interface View

| Direction | Name                | Type   | Format                                                 | Constraints                                               |
| --------- | ------------------- | ------ | ------------------------------------------------------ | --------------------------------------------------------- |
| Input     | `job`               | object | `{ jobId, recipeId, versionId, snapshotKey, attempt }` | `jobId` UUIDv7; `attempt ≥ 1`                             |
| Output    | `enqueued`          | object | `{ messageId }`                                        |                                                           |
| Exception | `QUEUE_UNAVAILABLE` | 503    | `{ code, retryAfter }`                                 | SQS unavailable after retries — caller writes pending row |

#### Algorithmic / Logic View

```text
function enqueue(job):
  body ← JSON.stringify(job)
  dedupId ← `${job.jobId}-attempt-${job.attempt}`
  try:
    res ← MOD-025.sqs.sendMessage({
            queueUrl: config.archiveQueueUrl,
            messageBody: body,
            messageDeduplicationId: dedupId,
            messageGroupId: job.recipeId
          })
    return { messageId: res.MessageId }
  catch e:
    if isTransient(e):
      backoffRetry(2 attempts)
      throw QUEUE_UNAVAILABLE(retryAfter=30)
    throw e
```

SQS FIFO note: queue deduplication window is 5 minutes. Re-enqueue operations from MOD-019 MUST use an attempt-specific `messageDeduplicationId` (`${job.jobId}-attempt-${job.attempt}`) to avoid silent drops inside the deduplication window.

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type ArchiveJob = { jobId: string; recipeId: string; versionId: string; snapshotKey: string; attempt: number };
```

#### Error Handling & Return Codes

| Trigger                         | Error Code           | HTTP |
| ------------------------------- | -------------------- | ---- |
| SQS 5xx / network after retries | `QUEUE_UNAVAILABLE`  | 503  |
| Bad job shape                   | thrown as `INTERNAL` | 500  |

---

### Module: MOD-018 (Archive Worker Lambda)

**Parent Architecture Modules**: ARCH-018
**Type**: Service (Lambda)
**Target Source File(s)**: `packages/services/recipe-workers/src/version-archive-worker/handler.ts`

#### Interface View

| Direction | Name          | Type   | Format                                         | Constraints                      |
| --------- | ------------- | ------ | ---------------------------------------------- | -------------------------------- |
| Input     | `sqsEvent`    | object | SQS event with archive jobs                    | One or more `ArchiveJob` records |
| Output    | (side-effect) | —      | Writes snapshot to S3 + marks DB row archived  | Idempotent on `jobId`            |
| Exception | (per-record)  | —      | Failed records returned in `batchItemFailures` | Lambda partial-batch response    |

#### Algorithmic / Logic View

```text
function handle(sqsEvent):
  failures ← []
  for record in sqsEvent.Records:
    job ← JSON.parse(record.body)
    try:
      if MOD-024.archiveJobs.isAlreadyArchived(job.jobId): continue   # idempotent
      snapshot ← MOD-024.recipeVersions.loadSnapshot(job.versionId)
      MOD-025.putObject(job.snapshotKey,
                        JSON.stringify(snapshot),
                        "application/json",
                        storageClass="GLACIER_IR")
      MOD-024.recipeVersions.markArchived(job.versionId, job.snapshotKey)
      MOD-024.archiveJobs.markCompleted(job.jobId)
    catch e:
      MOD-024.archiveJobs.recordFailure(job.jobId, e.message, attempt=job.attempt)
      failures.push({ itemIdentifier: record.messageId })
  return { batchItemFailures: failures }
```

#### State Machine View

Job: `enqueued → in_flight → completed | failed_retryable → DLQ`.

#### Internal Data Structures

```ts
type SqsBatchResponse = { batchItemFailures: { itemIdentifier: string }[] };
type ArchiveJob = { jobId: string; recipeId: string; versionId: string; snapshotKey: string; attempt: number };
```

#### Error Handling & Return Codes

| Trigger                   | Behavior                               |
| ------------------------- | -------------------------------------- |
| Snapshot already archived | Skip (idempotent)                      |
| S3 write failure          | Add to `batchItemFailures` → SQS retry |
| Repeated failures         | Routed to DLQ; observed by MOD-031     |

---

### Module: MOD-019 (Pending Archive Reconciler)

**Parent Architecture Modules**: ARCH-019
**Type**: Service (cron)
**Target Source File(s)**: `packages/services/recipe-service/src/archive/pending-archive.reconciler.ts`

#### Interface View

| Direction | Name        | Type   | Format                                | Constraints                             |
| --------- | ----------- | ------ | ------------------------------------- | --------------------------------------- |
| Input     | (cron tick) | —      | Scheduled every 1 min                 |                                         |
| Output    | `report`    | object | `{ scanned, requeued, deadLettered }` | Recorded via MOD-030                    |
| Exception | logged      | —      | Never throws to scheduler             | Each row processed in its own try/catch |

#### Algorithmic / Logic View

```text
function tick():
  rows ← MOD-024.recipeVersionPendingArchives.findPending(olderThan=2min, limit=500)
  report ← { scanned: rows.length, requeued: 0, deadLettered: 0 }
  for row in rows:
    if row.attempts >= MAX_ATTEMPTS:
      MOD-024.recipeVersionPendingArchives.markDeadLettered(row.id)   # status='dlq'
      report.deadLettered++
      continue
    try:
      # D6: the pending row stores no snapshot key — derive the S3 destination from
      # recipe_id + version_number; the worker loads the payload from recipe_versions.snapshot.
      MOD-017.enqueue({
        jobId: row.id,
        recipeId: row.recipeId,
        versionId: row.recipeVersionId,
        snapshotKey: `versions/${row.recipeId}/v${row.versionNumber}.json`,
        attempt: row.attempts + 1
      })
      MOD-024.recipeVersionPendingArchives.bumpAttempt(row.id)
      report.requeued++
    catch e:
      MOD-030.warn("requeue_failed", { pendingArchiveId: row.id, err: e.message })
  MOD-030.metric("archive_reconciler_run", report)
  return report
```

#### State Machine View

Stateless per tick; modifies job rows.

#### Internal Data Structures

```ts
type ReconcilerReport = { scanned: number; requeued: number; deadLettered: number };
// D6: mirrors the `recipe_version_pending_archives` FK-design columns — no snapshot column.
type PendingArchiveRow = {
    id: string;
    recipeVersionId: string; // FK → recipe_versions(id)
    recipeId: string;
    versionNumber: number;
    status: 'pending' | 'in_flight' | 'failed' | 'dlq';
    attempts: number;
    nextAttemptAt: Date;
    lastError?: string;
    createdAt: Date;
};
const MAX_ATTEMPTS = 8;
```

#### Error Handling & Return Codes

| Trigger                    | Behavior                                   |
| -------------------------- | ------------------------------------------ |
| `attempts >= MAX_ATTEMPTS` | Move to dead-letter state (`status='dlq'`) |
| Requeue failure            | Logged; retried next tick                  |

---

### Module: MOD-020 (Collection Service)

**Parent Architecture Modules**: ARCH-020
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/collections/collections.service.ts`

#### Interface View

| Direction | Name                   | Type   | Format                                                          | Constraints                   |
| --------- | ---------------------- | ------ | --------------------------------------------------------------- | ----------------------------- |
| Input     | `command`              | object | `Create\|Update\|Delete\|AddItem\|RemoveItem CollectionCommand` | Validated; principal attached |
| Output    | `view`                 | object | `CollectionView` with `rowVersion`                              |                               |
| Exception | `CONCURRENCY_CONFLICT` | 409    | `{ code, currentRowVersion, currentSnapshot }`                  | via MOD-016                   |
| Exception | `FORBIDDEN_OWNER`      | 403    | `{ code, ruleId }`                                              | via MOD-002                   |
| Exception | `VALIDATION_FAILED`    | 400    |                                                                 |                               |
| Exception | `NOT_FOUND`            | 404    | `{ code, id }`                                                  | Collection or member missing  |
| Exception | `POLICY_DENIED`        | 403    | `{ code, ruleId }`                                              | Visibility/tier rejected      |

#### Algorithmic / Logic View

```text
function execute(cmd):
  match cmd.kind:
    case "create":
      MOD-002.authorize(cmd.principal, { kind:"collection", id:"*", action:"write" })
      return MOD-024.collections.insert(cmd.payload, ownerId=cmd.principal.userId)

    case "update":
      before ← MOD-024.collections.loadById(cmd.payload.id)
      MOD-002.authorize(cmd.principal, { kind:"collection", id:before.id, action:"write" })
      return repository.transaction(tx ⇒ {
        MOD-016.guard({ table:"collections", id:before.id,
                        expectedRowVersion: cmd.payload.expectedRowVersion })
        MOD-024.collections.update(tx, before.id, cmd.payload)
      })

    case "delete":
      before ← MOD-024.collections.loadById(cmd.payload.id)
      MOD-002.authorize(cmd.principal, { kind:"collection", id:before.id, action:"delete" })
      repository.transaction(tx ⇒ {
        MOD-016.guard({ table:"collections", id:before.id,
                        expectedRowVersion: cmd.payload.expectedRowVersion })
        MOD-024.collections.softDelete(tx, before.id)
      })
      return { id: before.id, deleted: true }

    case "addItem":
      coll ← MOD-024.collections.loadById(cmd.payload.collectionId)
      MOD-002.authorize(cmd.principal, { kind:"collection", id:coll.id, action:"write" })
      recipe ← MOD-024.recipes.loadById(cmd.payload.recipeId)
      MOD-002.authorize(cmd.principal, { kind:"recipe",     id:recipe.id, action:"read" })
      return MOD-024.collections.addItem(coll.id, recipe.id)

    case "removeItem":
      coll ← MOD-024.collections.loadById(cmd.payload.collectionId)
      MOD-002.authorize(cmd.principal, { kind:"collection", id:coll.id, action:"write" })
      return MOD-024.collections.removeItem(coll.id, cmd.payload.recipeId)
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type CollectionCommand =
    | { kind: 'create'; payload: CreateCollectionRequest; principal: Principal }
    | {
          kind: 'update';
          payload: UpdateCollectionRequest & { id: string; expectedRowVersion: string };
          principal: Principal;
      }
    | { kind: 'delete'; payload: { id: string; expectedRowVersion: string }; principal: Principal }
    | { kind: 'addItem'; payload: { collectionId: string; recipeId: string }; principal: Principal }
    | { kind: 'removeItem'; payload: { collectionId: string; recipeId: string }; principal: Principal };
```

#### Error Handling & Return Codes

| Command      | Trigger                                                            | Error Code             | HTTP Status | Propagated From |
| ------------ | ------------------------------------------------------------------ | ---------------------- | ----------- | --------------- |
| `create`     | DTO/schema validation fails (`name`, `visibility`, payload shape)  | `VALIDATION_FAILED`    | 400         | —               |
| `create`     | Principal missing/invalid token context                            | `INVALID_TOKEN`        | 401         | MOD-002         |
| `create`     | Principal lacks write permission for collection creation           | `FORBIDDEN_OWNER`      | 403         | MOD-002         |
| `create`     | Insert fails due to uniqueness/domain constraint conflict          | `UNIQUE_VIOLATION`     | 409         | MOD-024         |
| `create`     | Repository/transaction failure during insert                       | `INTERNAL`             | 500         | MOD-024         |
| `update`     | DTO/schema validation fails (`id`, `expectedRowVersion`, payload)  | `VALIDATION_FAILED`    | 400         | —               |
| `update`     | Collection id not found during `loadById`                          | `NOT_FOUND`            | 404         | MOD-024         |
| `update`     | Principal lacks write permission for target collection             | `FORBIDDEN_OWNER`      | 403         | MOD-002         |
| `update`     | Optimistic concurrency guard fails (`expectedRowVersion` mismatch) | `CONCURRENCY_CONFLICT` | 409         | MOD-016         |
| `update`     | Visibility or tier policy rejected                                 | `POLICY_DENIED`        | 403         | MOD-006         |
| `update`     | Repository/transaction failure during update                       | `INTERNAL`             | 500         | MOD-024         |
| `delete`     | DTO/schema validation fails (`id`, `expectedRowVersion`)           | `VALIDATION_FAILED`    | 400         | —               |
| `delete`     | Collection id not found during `loadById`                          | `NOT_FOUND`            | 404         | MOD-024         |
| `delete`     | Principal lacks delete permission for target collection            | `FORBIDDEN_OWNER`      | 403         | MOD-002         |
| `delete`     | Optimistic concurrency guard fails (`expectedRowVersion` mismatch) | `CONCURRENCY_CONFLICT` | 409         | MOD-016         |
| `delete`     | Repository/transaction failure during soft delete                  | `INTERNAL`             | 500         | MOD-024         |
| `addItem`    | DTO/schema validation fails (`collectionId`, `recipeId`)           | `VALIDATION_FAILED`    | 400         | —               |
| `addItem`    | Collection or recipe id not found during `loadById`                | `NOT_FOUND`            | 404         | MOD-024         |
| `addItem`    | Principal lacks collection write or recipe read permission         | `FORBIDDEN_OWNER`      | 403         | MOD-002         |
| `addItem`    | Duplicate collection-recipe link / constraint conflict             | `UNIQUE_VIOLATION`     | 409         | MOD-024         |
| `addItem`    | Repository failure while persisting link                           | `INTERNAL`             | 500         | MOD-024         |
| `removeItem` | DTO/schema validation fails (`collectionId`, `recipeId`)           | `VALIDATION_FAILED`    | 400         | —               |
| `removeItem` | Collection id not found during `loadById`                          | `NOT_FOUND`            | 404         | MOD-024         |
| `removeItem` | Principal lacks collection write permission                        | `FORBIDDEN_OWNER`      | 403         | MOD-002         |
| `removeItem` | Remove operation conflicts with current collection-item state      | `INTEGRITY_ERROR`      | 409         | MOD-024         |
| `removeItem` | Repository failure while deleting link                             | `INTERNAL`             | 500         | MOD-024         |

---

### Module: MOD-021 (Collection Clone & Pull Service)

**Parent Architecture Modules**: ARCH-021
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/collections/collections.clone.service.ts`

#### Interface View

| Direction | Name             | Type   | Format                                                         | Constraints                                                |
| --------- | ---------------- | ------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| Input     | `command`        | object | `{ kind:'clone'\|'pull', sourceId, targetId? }`                | Source collection must be public for `clone`; target owned |
| Input     | `principal`      | object | Principal                                                      | Required                                                   |
| Output    | `view`           | object | `{ targetCollectionId, addedRecipeIds[], skippedRecipeIds[] }` | Recipes user already owns are skipped                      |
| Exception | `PULL_LOCK_HELD` | 409    | `{ code, targetCollectionId }`                                 | Concurrent pull already in flight                          |
| Exception | `FORBIDDEN_*`    | 403    | from MOD-002                                                   |                                                            |
| Exception | `NOT_FOUND`      | 404    |                                                                | Source collection missing                                  |

#### Algorithmic / Logic View

```text
function execute(cmd, principal):
  source ← MOD-024.collections.loadById(cmd.sourceId)
  if !source: throw NOT_FOUND
  MOD-002.authorize(principal, { kind:"collection", id:source.id, action:"clone" })

  lockHeld ← false
  lockTargetId ← null

  if cmd.kind == "clone":
    target ← MOD-024.collections.insert({
               name: source.name + " (cloned)",
               description: source.description,
               visibility: "private"
              }, ownerId=principal.userId)
  else:                                # pull into existing
    lockAcquired ← MOD-024.collections.acquireAdvisoryLock(cmd.targetId)
    if !lockAcquired:
      throw PULL_LOCK_HELD({ code:"PULL_LOCK_HELD", targetCollectionId: cmd.targetId })
    lockHeld ← true
    lockTargetId ← cmd.targetId

  try:
    if cmd.kind == "pull":
      target ← MOD-024.collections.loadById(cmd.targetId)
      MOD-002.authorize(principal, { kind:"collection", id:target.id, action:"write" })

    added   ← []
    skipped ← []
    for srcRecipeId in MOD-024.collections.listRecipeIds(source.id):
      srcRecipe ← MOD-024.recipes.loadById(srcRecipeId)
      if srcRecipe.visibility != "public":
        skipped.push(srcRecipeId); continue           # private item from public list
      if MOD-024.recipes.userHasClonedFrom(principal.userId, srcRecipeId):
        skipped.push(srcRecipeId); continue
      cloneCmd ← { kind:"clone", payload:{ sourceId: srcRecipeId }, principal }
      cloned   ← MOD-004.execute(cloneCmd)
      MOD-024.collections.addItem(target.id, cloned.id)
      added.push(cloned.id)
    return { targetCollectionId: target.id, addedRecipeIds: added, skippedRecipeIds: skipped }
  finally:
    if lockHeld:
      MOD-024.collections.releaseAdvisoryLock(lockTargetId)
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
type CollectionCloneCommand = { kind: 'clone' | 'pull'; sourceId: string; targetId?: string };
```

#### Error Handling & Return Codes

| Trigger                         | Error Code        | HTTP |
| ------------------------------- | ----------------- | ---- |
| Concurrent pull for same target | `PULL_LOCK_HELD`  | 409  |
| Source not public               | `FORBIDDEN_OWNER` | 403  |
| Source missing                  | `NOT_FOUND`       | 404  |
| Target not owned                | `FORBIDDEN_OWNER` | 403  |

---

### Module: MOD-022 (GDPR Erasure Orchestrator)

**Parent Architecture Modules**: ARCH-022
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/gdpr/erasure.orchestrator.ts`

#### Interface View

| Direction | Name              | Type   | Format                                                             | Constraints                                                                                                                                                                                                    |
| --------- | ----------------- | ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input     | `request`         | object | `{ subjectUserId, requestedBy }`                                   | `requestedBy` (the principal's app-user ULID) must be the subject or admin                                                                                                                                     |
| Input     | `principal`       | object | Principal from MOD-001                                             | Required; admin is derived from its `roles` (no `users` lookup — D2)                                                                                                                                           |
| Output    | `report`          | object | `{ erasureId, status, recipeCount, photoKeys[], collectionCount }` | 202 Accepted; idempotent per spec C-007 — a duplicate while a job is `queued`/`running` returns the **existing** `erasureId` (no second enqueue); a fresh retry after a `failed` job returns a new `erasureId` |
| Exception | `FORBIDDEN_OWNER` | 403    |                                                                    | Non-subject, non-admin                                                                                                                                                                                         |
| Exception | `ALREADY_ERASED`  | 410    | `{ code, message }`                                                | A prior erasure job `completed` (idempotent C-007; **not** a 409)                                                                                                                                              |

#### Algorithmic / Logic View

```text
function erase(req, principal):
  # requestedBy is the verified principal's app-user ULID (principal.userId).
  if req.requestedBy != req.subjectUserId and !isAdmin(principal):
    throw FORBIDDEN_OWNER
  # Idempotency per spec C-007 — account_erasure_jobs.status ∈ {queued, running, completed, failed}.
  existing ← MOD-024.erasures.findLatest(req.subjectUserId)
  if existing and existing.status in ["queued","running"]:
    return { erasureId: existing.id, status: existing.status }   # 202; no second enqueue
  if existing and existing.status == "completed":
    throw ALREADY_ERASED                                          # 410; account already erased
  # No prior job, or the prior job "failed" → enqueue a fresh 'queued' job (202).

  return repository.transaction(tx ⇒ {
    erasureId ← MOD-024.erasures.start(tx, req.subjectUserId, req.requestedBy)   # status='queued'
    photoKeys ← MOD-024.photos.collectKeysForUser(tx, req.subjectUserId)
    counts    ← MOD-024.applyErasureMutations(tx, req.subjectUserId)   # tombstones + nullouts
    MOD-024.erasures.markDbDone(tx, erasureId)
    MOD-023.purge({ erasureId, photoKeys })           # async S3 + cache purge
    return { erasureId, status: "queued", recipeCount: counts.recipes,
             collectionCount: counts.collections, photoKeys }
  })

# Admin is derived from the verified Principal's roles (from the session token's public_metadata) —
# there is no `users` table/accessor (D2). No DB lookup.
function isAdmin(principal):
  return principal.roles.includes("admin")   # role from session token public_metadata claim
```

#### State Machine View

Persisted `account_erasure_jobs.status` (canonical enum, single authoritative source): `queued → running → completed | failed`. The db-purge and storage-purge steps run within `running`. Terminal states: `completed` (a subsequent POST → **410** `ALREADY_ERASED`) and `failed` (a subsequent POST → a fresh `queued` retry, **202**).

#### Internal Data Structures

```ts
type ErasureJobStatus = 'queued' | 'running' | 'completed' | 'failed';
type ErasureRequest = { subjectUserId: string; requestedBy: string };
type ErasureReport = {
    erasureId: string;
    status: ErasureJobStatus;
    recipeCount: number;
    collectionCount: number;
    photoKeys: string[];
};
// Admin is read from the verified Principal (MOD-001) `roles` — there is no `users` accessor (D2).
```

#### Error Handling & Return Codes

| Trigger                                                                      | Error Code        | HTTP |
| ---------------------------------------------------------------------------- | ----------------- | ---- |
| Non-subject non-admin requester                                              | `FORBIDDEN_OWNER` | 403  |
| Duplicate while `queued`/`running` → existing `erasureId`, no second enqueue | — (idempotent)    | 202  |
| Prior job `completed` (already erased; C-007, **not** 409)                   | `ALREADY_ERASED`  | 410  |
| Prior job `failed` → fresh `queued` retry                                    | — (idempotent)    | 202  |
| DB mutation failure                                                          | `INTERNAL`        | 500  |

---

### Module: MOD-023 (Erasure Storage Purger)

**Parent Architecture Modules**: ARCH-023
**Type**: Service
**Target Source File(s)**: `packages/services/recipe-service/src/gdpr/erasure.storage-purger.ts`

#### Interface View

| Direction | Name      | Type   | Format                                  | Constraints                                 |
| --------- | --------- | ------ | --------------------------------------- | ------------------------------------------- |
| Input     | `request` | object | `{ erasureId, photoKeys[] }`            | Invoked by MOD-022                          |
| Output    | `report`  | object | `{ deleted: number, failed: string[] }` | Best-effort; failures retried by reconciler |
| Exception | logged    | —      | Never throws to caller                  | Each key isolated                           |

#### Algorithmic / Logic View

```text
function purge(req):
  deleted ← 0; failed ← []
  for batch in chunk(req.photoKeys, 1000):
    keysWithDerivatives ← batch.flatMap(k ⇒ [k, derivedKey(k,"thumb"), derivedKey(k,"display")])
    res ← MOD-025.deleteObjects(keysWithDerivatives)
    deleted += res.Deleted.length
    for err in res.Errors: failed.push(err.Key)
  try:
    MOD-025.cloudFront.invalidate(req.photoKeys.map(toCdnPath))
  catch e:
    failed.push(...req.photoKeys.map(toCdnPath))
    MOD-030.warn("CDN_INVALIDATION_FAILED", { erasureId: req.erasureId, err: e.message })
  if failed.length == 0:
    MOD-024.erasures.markStorageDone(req.erasureId)
  else:
    MOD-024.erasures.recordPartial(req.erasureId, failed)
  return { deleted, failed }
```

#### State Machine View

Stateless; updates erasure row.

#### Internal Data Structures

```ts
type StoragePurgeRequest = { erasureId: string; photoKeys: string[] };
```

#### Error Handling & Return Codes

| Trigger                         | Behavior                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Per-key S3 delete failure       | Recorded in `failed`; retried later                                                                            |
| CloudFront invalidation failure | `CDN_INVALIDATION_FAILED`: Logged at warn level; recorded in `failed` list; retried by reconciler on next tick |

---

### Module: MOD-024 (Drizzle Repository Layer)

**Parent Architecture Modules**: ARCH-024
**Type**: Adapter
**Target Source File(s)**: `packages/services/recipe-service/src/persistence/*.repository.ts`

#### Interface View

| Direction | Name               | Type  | Format                 | Constraints                                    |
| --------- | ------------------ | ----- | ---------------------- | ---------------------------------------------- |
| Input     | (per-method)       | mixed | typed Drizzle queries  | All inputs typed; no string SQL with user data |
| Output    | (per-method)       | mixed | typed rows / counts    | Returns plain objects, never ORM proxies       |
| Exception | `DB_UNAVAILABLE`   | 503   | `{ code, retryAfter }` | Connection pool exhausted / network error      |
| Exception | `NOT_FOUND`        | 404   |                        | `loadById` miss                                |
| Exception | `UNIQUE_VIOLATION` | 409   | `{ code, constraint }` | Postgres `23505`                               |

#### Algorithmic / Logic View

```text
class RecipesRepository:
  loadById(id):           SELECT … FROM recipes WHERE id = $1 AND deleted_at IS NULL
  loadRowVersion(id):     SELECT row_version FROM recipes WHERE id = $1
  insert(tx, row):        INSERT … RETURNING * ; row_version = uuidv7()
  update(tx, id, …):      UPDATE … SET …, row_version = uuidv7(), updated_at = now() WHERE id = $1 RETURNING *
  softDelete(tx, id):     UPDATE recipes SET deleted_at = now(), row_version = uuidv7() WHERE id = $1
  searchPage(spec):       SELECT … FROM recipes WHERE {spec.where} ORDER BY {spec.orderBy} LIMIT {spec.limit} OFFSET {spec.offset}
  searchCount(spec):      SELECT count(*) FROM recipes WHERE {spec.where}
  userHasClonedFrom(uid, srcId): SELECT 1 FROM recipes WHERE owner_id = $1 AND cloned_from = $2 LIMIT 1

class RecipeVersionsRepository:
  nextNumber(tx, recipeId): SELECT coalesce(max(version_number),0)+1 FROM recipe_versions WHERE recipe_id = $1 FOR UPDATE
  insert(tx, row):          INSERT … RETURNING *
  loadSnapshot(versionId):  SELECT snapshot_json FROM recipe_versions WHERE id = $1
  markArchived(versionId, key): UPDATE recipe_versions SET archived_at = now(), archive_key = $2 WHERE id = $1

# Similar repositories: collections, photos, photoUploads, ingredients,
# nutritionFacts, archiveJobs, erasures.

# Cross-cutting:
applyErasureMutations(tx, userId):
  # explicit dependency order to satisfy FK constraints
  UPDATE recipe_version_pending_archives
    SET owner_id = null, snapshot_key = null
    WHERE owner_id = userId
  UPDATE recipe_versions
    SET archived_by = null, snapshot_json = jsonb_set(snapshot_json, '{ownerId}', 'null'::jsonb)
    WHERE owner_id = userId
  DELETE FROM recipe_ingredients
    WHERE recipe_id IN (SELECT id FROM recipes WHERE owner_id = userId)
  UPDATE recipes
    SET title = '[erased]', description = null, owner_id = null, deleted_at = now()
    WHERE owner_id = userId
  UPDATE collections
    SET name = '[erased]', description = null, owner_id = null, deleted_at = now()
    WHERE owner_id = userId
  UPDATE photos
    SET owner_id = null, object_key = null, thumb_key = null, display_key = null, status = 'erased'
    WHERE owner_id = userId
  # strategy: explicit ordered mutations; rely on FK RESTRICT/NO ACTION, no cascade deletes
transaction(fn):                   pool.connect → BEGIN → fn(tx) → COMMIT / ROLLBACK
```

#### State Machine View

Connection pool: `idle → in_use → idle | broken → recreated`. Repositories are stateless wrappers.

#### Internal Data Structures

Drizzle schema types live in `packages/services/recipe-service/src/persistence/schema/*.ts`. Repositories return inferred row types.

#### Error Handling & Return Codes

| Trigger                             | Error Code         | HTTP |
| ----------------------------------- | ------------------ | ---- |
| Pool exhausted / connection refused | `DB_UNAVAILABLE`   | 503  |
| `loadById` miss                     | `NOT_FOUND`        | 404  |
| Unique constraint violation         | `UNIQUE_VIOLATION` | 409  |
| FK violation                        | `INTEGRITY_ERROR`  | 409  |

---

### Module: MOD-025 (S3 & CloudFront Adapter `[EXTERNAL]`)

**Parent Architecture Modules**: ARCH-025
**Type**: Adapter (wraps AWS SDK)
**Target Source File(s)**: `packages/services/recipe-service/src/aws/s3-cloudfront.adapter.ts`

#### Interface View

| Direction | Name                | Type  | Format                                                                                               | Constraints                         |
| --------- | ------------------- | ----- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Input     | (per-method)        | mixed | thin wrappers around `@aws-sdk/client-s3`, `client-sqs`, `client-cloudfront`, `s3-request-presigner` |                                     |
| Output    | (per-method)        | mixed | typed responses                                                                                      | Errors normalized to internal codes |
| Exception | `S3_UNAVAILABLE`    | 503   | `{ code, retryAfter }`                                                                               | After bounded retries               |
| Exception | `S3_OBJECT_MISSING` | 404   |                                                                                                      | `headObject` returns 404            |

#### Algorithmic / Logic View

External boundary; behavior is defined by AWS SDK contracts. Adapter responsibilities:

- Centralize client construction (region, credentials, retry config).
- Translate AWS error codes (`NoSuchKey`, `SlowDown`, `RequestTimeout`) into stable internal codes.
- Apply bounded retry with jitter on transient errors: 3 attempts, exponential backoff base 200 ms, full jitter, max delay 2 s.
- Emit metrics via MOD-030.

```text
methods:
  getPresignedPutUrl({key, contentType, contentLength, expiresInSec})
  getObject(key) / putObject(key, body, contentType, storageClass?)
  headObject(key) → { etag, contentLength, contentType } | null
  deleteObjects(keys) → { Deleted[], Errors[] }
  cloudFront.invalidate(paths)
  sqs.sendMessage({ queueUrl, messageBody, messageDeduplicationId, messageGroupId })
```

#### State Machine View

Stateless beyond AWS SDK client lifecycle.

#### Internal Data Structures

Re-exports SDK input/output types where stable; otherwise re-shapes to internal types.

#### Error Handling & Return Codes

| AWS Code          | Internal Code               |
| ----------------- | --------------------------- |
| `NoSuchKey` (404) | `S3_OBJECT_MISSING`         |
| `SlowDown` (503)  | retry → `S3_UNAVAILABLE`    |
| `AccessDenied`    | `S3_FORBIDDEN`              |
| `Throttling`      | retry → `QUEUE_UNAVAILABLE` |

---

### Module: MOD-026 (Web Recipe & Collection UI)

**Parent Architecture Modules**: ARCH-026
**Type**: Component (Next.js App Router)
**Target Source File(s)**: `packages/apps/commise/web/src/app/(recipes)/**`, `…/(collections)/**`

#### Interface View

| Direction | Name              | Type  | Format                                     | Constraints                                            |
| --------- | ----------------- | ----- | ------------------------------------------ | ------------------------------------------------------ |
| Input     | route + session   | mixed | Next.js route params + Clerk session       | Session token attached server-side via `@clerk/nextjs` |
| Input     | API responses     | mixed | JSON from `/v1/recipes`, `/v1/collections` | Includes `rowVersion`                                  |
| Output    | rendered HTML     | HTML  | server + client components                 | Uses Tailwind v4 + Radix UI per `frontend-ux-engineer` |
| Exception | UI error boundary | —     | Renders typed error component              | All API errors shown by `code`                         |

#### Algorithmic / Logic View

```text
loaders (server components):
  loadRecipe(id):       fetch `/v1/recipes/{id}` with bearer; on 401 redirect /login
  searchRecipes(query): fetch `/v1/recipes?…`

mutations (server actions):
  saveRecipe(form, rowVersion):
     send PATCH with `If-Match: rowVersion`
     on 409 → re-fetch latest, render conflict resolver
  uploadPhoto(file):
     POST /v1/recipes/{id}/photos/upload-url
     PUT to presigned URL
     POST /v1/recipes/{id}/photos/confirm
     poll status until ready|failed

UI invariants:
  every form preserves `rowVersion` in a hidden field
  premium-gated UI hidden when principal.tier == "free"

offline:
  web client does not support offline mutations
  network errors surface via error boundary with retry affordance
```

#### State Machine View

Photo client widget: `idle → presigning → uploading → confirming → processing → ready | failed`.
Conflict resolver: `clean → editing → conflict_detected → resolved`.

#### Internal Data Structures

```ts
type RecipeFormState = { values: RecipeView; rowVersion: string; conflict?: RecipeView };
```

#### Error Handling & Return Codes

| API Code               | UI Behavior                              |
| ---------------------- | ---------------------------------------- |
| `VALIDATION_FAILED`    | Inline field errors                      |
| `CONCURRENCY_CONFLICT` | Show conflict resolver with current snap |
| `FORBIDDEN_TIER`       | Show upgrade prompt                      |
| `INVALID_TOKEN`        | Force re-auth via Clerk                  |

---

### Module: MOD-027 (Mobile Recipe & Collection UI)

**Parent Architecture Modules**: ARCH-027
**Type**: Component (Expo / React Native)
**Target Source File(s)**: `packages/apps/commise/mobile/src/screens/**`

#### Interface View

| Direction | Name                | Type  | Format                          | Constraints                                              |
| --------- | ------------------- | ----- | ------------------------------- | -------------------------------------------------------- |
| Input     | navigation params   | mixed | Expo Router routes              | Session token from `expo-secure-store` via `@clerk/expo` |
| Input     | API responses       | mixed | identical to MOD-026            |                                                          |
| Output    | rendered screens    | RN    | uses Tamagui v2 + Reanimated v4 |                                                          |
| Exception | screen error states | —     | Per-screen retry component      |                                                          |

#### Algorithmic / Logic View

Mirrors MOD-026 with mobile-specific concerns:

```text
authBootstrap():
  token ← SecureStore.getItem("clerk_session_token")
  if !token or expired: trigger `@clerk/expo` hosted UI login
  attach Authorization: Bearer <token> to all fetches

photoCapture():
  ImagePicker → POST /v1/recipes/{id}/photos/upload-url → PUT → POST /v1/recipes/{id}/photos/confirm → poll status

offline:
  TanStack Query with `cacheTime` and persisted query cache (read-only)
  mutations require online; queued mutations are NOT supported in v1
```

#### State Machine View

Same as MOD-026. Additional auth state: `bootstrapping → authenticated | needs_login`.

#### Internal Data Structures

Shared types imported from `@kitchensink/recipe-core` package.

#### Error Handling & Return Codes

| API Code               | UI Behavior                  |
| ---------------------- | ---------------------------- |
| `INVALID_TOKEN`        | Clear secure store; re-login |
| `CONCURRENCY_CONFLICT` | Refresh-and-retry sheet      |
| `S3_UNAVAILABLE`       | Toast + retry button         |

---

### Module: MOD-028 (API Error Mapper)

**Parent Architecture Modules**: ARCH-028
**Type**: Library (NestJS exception filter)
**Target Source File(s)**: `packages/services/recipe-service/src/errors/api-error.filter.ts`

#### Interface View

| Direction | Name          | Type   | Format                                   | Constraints                                 |
| --------- | ------------- | ------ | ---------------------------------------- | ------------------------------------------- |
| Input     | thrown error  | object | any `Error` subclass                     | Domain errors carry `.code`                 |
| Output    | HTTP response | HTTP   | `{ code, message, details?, requestId }` | Stable codes; no stack traces in production |
| Exception | none          | —      | Filter swallows internally               |                                             |

#### Algorithmic / Logic View

```text
function catch(err, host):
  req ← host.getRequest()
  reqId ← req.headers["x-request-id"] ?? uuidv7()
  if err is DomainError:
    body ← { code: err.code, message: err.message,
             details: err.details, requestId: reqId }
    res.status(STATUS_FOR[err.code]).json(body)
  elif err is HttpException:
    res.status(err.getStatus()).json({ ...normalize(err), requestId: reqId })
  else:
    MOD-030.error("unhandled", { err, reqId })
    res.status(500).json({ code:"INTERNAL", message:"Internal error",
                            requestId: reqId })

const STATUS_FOR = {
  VALIDATION_FAILED: 400, INVALID_PHOTO: 400, BAD_QUERY: 400,
  INVALID_FILTER: 400,
  INVALID_TOKEN: 401,
  FORBIDDEN_OWNER: 403, FORBIDDEN_TIER: 403, POLICY_DENIED: 403,
  NOT_FOUND: 404, PHOTO_NOT_FOUND: 404, UPLOAD_NOT_FOUND: 404, INGREDIENT_NOT_FOUND: 404,
  CONCURRENCY_CONFLICT: 409, UNIQUE_VIOLATION: 409,
  S3_OBJECT_MISSING: 409, INTEGRITY_ERROR: 409,
  ALREADY_ERASED: 410,
  UPLOAD_QUOTA_EXCEEDED: 429,
  UPLOAD_INVALID: 422, UNIT_INCONVERTIBLE: 422,
  INTERNAL: 500, VERSION_WRITE_FAILED: 500, POLICY_INTERNAL: 500,
  SEARCH_TIMEOUT: 504,
  DB_UNAVAILABLE: 503, S3_UNAVAILABLE: 503, QUEUE_UNAVAILABLE: 503
};
```

#### State Machine View

Stateless.

#### Internal Data Structures

```ts
class DomainError extends Error {
    code!: string;
    details?: unknown;
}
type ApiErrorBody = { code: string; message: string; details?: unknown; requestId: string };
```

#### Error Handling & Return Codes

The mapper is itself the error contract. Unknown errors map to `INTERNAL` (500) and are logged at `error` level.

---

### Module: MOD-029 (Config Loader)

**Parent Architecture Modules**: ARCH-029
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/config/config.module.ts`, `…/config.schema.ts`

#### Interface View

| Direction | Name             | Type   | Format               | Constraints              |
| --------- | ---------------- | ------ | -------------------- | ------------------------ |
| Input     | `process.env`    | object | Strings              | Required keys per schema |
| Output    | `Config`         | object | Strongly typed       | Frozen at boot           |
| Exception | `CONFIG_INVALID` | (boot) | aggregated zod error | App refuses to start     |

#### Algorithmic / Logic View

```text
schema (zod):
  NODE_ENV          ∈ {development, test, production}
  PORT              number ≥ 1
  DATABASE_URL      url
  CLERK_JWT_KEY              string (PEM public key, non-secret)
  CLERK_AUTHORIZED_PARTIES   string (comma-separated azp allowlist, non-secret)
  S3_BUCKET         string
  CLOUDFRONT_DOMAIN hostname
  ARCHIVE_QUEUE_URL url
  SENTRY_DSN        url (optional)

function load():
  parsed ← schema.safeParse(process.env)
  if !parsed.success:
    print(parsed.error.format()); process.exit(1)
  return Object.freeze(parsed.data)
```

#### State Machine View

Singleton; `unloaded → loaded`.

#### Internal Data Structures

```ts
type Config = z.infer<typeof schema>;
```

#### Error Handling & Return Codes

| Trigger              | Behavior                    |
| -------------------- | --------------------------- |
| Missing required env | Print errors; exit non-zero |
| Wrong type / format  | Print errors; exit non-zero |

---

### Module: MOD-030 (Telemetry & Logger `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-030
**Type**: Library
**Target Source File(s)**: `packages/services/recipe-service/src/observability/logger.ts`, `…/metrics.ts`

#### Interface View

| Direction | Name          | Type   | Format                                | Constraints                                          |
| --------- | ------------- | ------ | ------------------------------------- | ---------------------------------------------------- |
| Input     | `event`       | object | `{ level, message, fields }`          | `level ∈ {debug,info,warn,error}`; structured fields |
| Input     | `metric`      | object | `{ name, value, unit?, dimensions? }` | Cardinality bounded                                  |
| Output    | (side-effect) | —      | stdout JSON + Sentry / CloudWatch EMF |                                                      |
| Exception | swallowed     | —      | Logger never throws                   |                                                      |

#### Algorithmic / Logic View

```text
logger uses @aws-lambda-powertools/logger and @sentry/aws-serverless.
PII redaction:
  emails, tokens, S3 presigned URLs, JWTs are masked before emission.

correlation:
  request handler attaches { requestId, userId? } to logger context.
  every error log MUST include requestId.
```

#### State Machine View

Logger context is request-scoped via NestJS interceptor.

#### Internal Data Structures

```ts
type LogFields = Record<string, unknown>;
```

#### Error Handling & Return Codes

Errors inside logger/metrics paths are caught and dropped; never propagate.

---

### Module: MOD-031 (Archive Backlog Alarm `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-031
**Type**: Utility (CDK construct)
**Target Source File(s)**: `packages/infra/cdk/lib/archive-backlog-alarm.ts`

#### Interface View

| Direction | Name         | Type   | Format                     | Constraints                |
| --------- | ------------ | ------ | -------------------------- | -------------------------- |
| Input     | `props`      | object | `{ queue, dlq, snsTopic }` | All required at synth time |
| Output    | `alarms`     | array  | `cloudwatch.Alarm[]`       |                            |
| Exception | (synth-time) | —      | CDK validation errors      |                            |

#### Algorithmic / Logic View

```text
new ArchiveBacklogAlarm(scope, "ArchiveBacklog", {
  queue: archiveQueue, dlq: archiveDlq, snsTopic: opsTopic
})

internally:
  ApproximateAgeOfOldestMessage > 600s  for 5 min   → page on-call
  ApproximateNumberOfMessagesVisible > 1000 for 5 min → warn
  DLQ NumberOfMessagesReceived > 0 (1 datapoint)    → page on-call
each alarm.addAlarmAction(SnsAction(opsTopic))
```

#### State Machine View

CloudWatch alarms: `OK ↔ ALARM ↔ INSUFFICIENT_DATA`.

#### Internal Data Structures

Pure CDK construct properties.

#### Error Handling & Return Codes

CDK synth fails fast on invalid props.

---

### Module: MOD-032 (CI & Test Governance Harness `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-032
**Type**: Utility
**Target Source File(s)**: `.github/workflows/ci.yml`, `turbo.json`, `packages/tools/test-governance/*`
**Verification Method**: **Inspection** (reconciled 2026-07-25 — CI/CD pipeline configuration is verified by reading and running the workflow/pipeline definitions themselves, not by an executable unit test of the harness. Evidence artifact: `.github/workflows/{ci-pr,ci-main,ci-full,_ci}.yml`, `turbo.json`, `packages/tools/*`. Previously implied Test-verified by the pre-implementation `traceability-matrix.md` (Matrix D, superseded per `verify-report.md` WARNING W3); this note is the correction.)

#### Interface View

| Direction | Name             | Type  | Format                                  | Constraints |
| --------- | ---------------- | ----- | --------------------------------------- | ----------- |
| Input     | repository state | mixed | git refs + workspace graph              |             |
| Output    | check results    | mixed | GH status checks + JUnit + coverage XML |             |
| Exception | non-zero exit    | —     | Fails the PR check                      |             |

#### Algorithmic / Logic View

```text
pipeline (per PR):
  install (npm ci)
  turbo run lint typecheck test build --filter=…[origin/main]
  upload coverage (cobertura) and junit XML
  speckit v-model: validate-module-coverage.sh, validate-traceability.sh
  fail if any matrix coverage < threshold or traceability gap is CRITICAL

merge gate:
  required checks: lint, typecheck, unit, integration, v-model-traceability
```

#### State Machine View

Pipeline run: `queued → in_progress → success | failure | cancelled`.

#### Internal Data Structures

```ts
type CoverageReport = { threshold: number; actual: number; passed: boolean };
type TraceabilityGap = { id: string; severity: 'CRITICAL' | 'WARNING'; description: string };
```

#### Error Handling & Return Codes

| Trigger                     | Behavior                          |
| --------------------------- | --------------------------------- |
| Coverage below threshold    | Fail check `coverage`             |
| Traceability gap (CRITICAL) | Fail check `v-model-traceability` |
| Lint / typecheck error      | Fail check `lint` / `typecheck`   |

---

### Module: MOD-033 (NestJS Module Wiring `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-033
**Type**: Utility (composition root)
**Target Source File(s)**: `packages/services/recipe-service/src/app.module.ts`, `…/main.ts`

#### Interface View

| Direction | Name               | Type   | Format                                | Constraints          |
| --------- | ------------------ | ------ | ------------------------------------- | -------------------- |
| Input     | `Config` (MOD-029) | object |                                       |                      |
| Output    | NestJS app handle  | object | `INestApplication`                    | Started in `main.ts` |
| Exception | bootstrap failure  | (boot) | Logged via MOD-030 then exit non-zero |                      |

#### Algorithmic / Logic View

```text
@Module({
  imports: [
    ConfigModule.forRoot({ load: [load], validate: () => Config }),
    AuthModule,            // MOD-001, MOD-002
    RecipesModule,         // MOD-003..011
    PhotosModule,          // MOD-012..014
    VersioningModule,      // MOD-015, MOD-016
    ArchiveModule,         // MOD-017..019
    CollectionsModule,     // MOD-020, MOD-021
    GdprModule,            // MOD-022, MOD-023
    PersistenceModule,     // MOD-024
    AwsAdaptersModule,     // MOD-025
    ObservabilityModule,   // MOD-030
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiErrorFilter },          // MOD-028
    { provide: APP_GUARD,  useClass: AuthGuard },               // composes MOD-001 + MOD-002
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor }, // MOD-030
  ],
})
class AppModule {}

# main.ts:
const app = await NestFactory.create(AppModule, { bufferLogs: true })
app.useLogger(MOD-030.logger)
app.enableShutdownHooks()
await app.listen(config.PORT)
```

#### State Machine View

App lifecycle: `bootstrapping → listening → draining → stopped`.

#### Internal Data Structures

DI tokens declared per module.

#### Error Handling & Return Codes

| Trigger                   | Behavior                             |
| ------------------------- | ------------------------------------ |
| Missing required provider | Nest throws at boot; logged; exit 1  |
| Listen failure            | Logged; exit 1                       |
| SIGTERM                   | Graceful shutdown via shutdown hooks |

---

### Modules: MOD-034 / MOD-035 / MOD-036 (Home Widget Surface — SYS-021)

**Parent Architecture Modules**: ARCH-034 (Home Widget Contract & Registry, `@commise/features-core`), ARCH-035 (`curateHomeWidgets` pure composition fn), ARCH-036 (Home Widget Host Render — `next/dynamic` web / `React.lazy` mobile)
**Type**: Library (MOD-034, MOD-035) · Component (MOD-036)
**Target Source File(s)**: `packages/apps/commise/features/core/**` (contract + `appShell` registry + `curateHomeWidgets`); Home host in `packages/apps/commise/{web,mobile}` rendering `@commise/features-recipes/widget/{web,mobile}`

**Design delegation (stated).** The low-level design for the Home widget surface — the `HomeWidgetDescriptor` shape (`capability` / `minTier` / lazy `load`), the ditox `appShell` container + startup registration (`.use(addFeature)`), the pure `curateHomeWidgets(widgets, ctx)` capability + tier gating and personalization ordering (absent capability → excluded, never an empty tile; unknown ids skipped), and the per-platform lazy render chain (Suspense + per-widget `ErrorBoundary`) — is **authoritatively specified in `research/home-widget-architecture.md` (`## DECISION (2026-07-06)`)** and is **not duplicated here**. Unit-level verification traces to that design; in v1 only the recipe widget is registered, and widgets backed by services 005–009 stay absent until their feature packages ship and their backing capability is live.

---

## ARCH → MOD Coverage Matrix

| ARCH-ID  | MOD-IDs                   |
| -------- | ------------------------- |
| ARCH-001 | MOD-001                   |
| ARCH-002 | MOD-002                   |
| ARCH-003 | MOD-003                   |
| ARCH-004 | MOD-004                   |
| ARCH-005 | MOD-005                   |
| ARCH-006 | MOD-006                   |
| ARCH-007 | MOD-007                   |
| ARCH-008 | MOD-008                   |
| ARCH-009 | MOD-009                   |
| ARCH-010 | MOD-010                   |
| ARCH-011 | MOD-011                   |
| ARCH-012 | MOD-012                   |
| ARCH-013 | MOD-013                   |
| ARCH-014 | MOD-014                   |
| ARCH-015 | MOD-015                   |
| ARCH-016 | MOD-016                   |
| ARCH-017 | MOD-017                   |
| ARCH-018 | MOD-018                   |
| ARCH-019 | MOD-019                   |
| ARCH-020 | MOD-020                   |
| ARCH-021 | MOD-021                   |
| ARCH-022 | MOD-022                   |
| ARCH-023 | MOD-023                   |
| ARCH-024 | MOD-024                   |
| ARCH-025 | MOD-025 `[EXTERNAL]`      |
| ARCH-026 | MOD-026                   |
| ARCH-027 | MOD-027                   |
| ARCH-028 | MOD-028                   |
| ARCH-029 | MOD-029                   |
| ARCH-030 | MOD-030 `[CROSS-CUTTING]` |
| ARCH-031 | MOD-031 `[CROSS-CUTTING]` |
| ARCH-032 | MOD-032 `[CROSS-CUTTING]` |
| ARCH-033 | MOD-033 `[CROSS-CUTTING]` |
| ARCH-034 | MOD-034                   |
| ARCH-035 | MOD-035                   |
| ARCH-036 | MOD-036                   |

**Coverage**: 36 / 36 ARCH modules covered (100%). External modules: 1 (MOD-025). Cross-cutting modules: 4 (MOD-030, MOD-031, MOD-032, MOD-033). MOD-034/035/036 (Home Widget Surface) delegate low-level design to `research/home-widget-architecture.md`.

## Peer-Review Remediation Log

| Finding ID  | Action Taken                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-MOD-001 | Updated MOD-015 pseudocode to insert `recipe_version_pending_archives` in the same transaction (`MOD-024.recipeVersionPendingArchives.insert(...)`) and updated output/internal types to include `pendingArchiveId`. Added stateless confirmation to MOD-004, MOD-008, MOD-010, MOD-012, MOD-013, MOD-016 State Machine View entries: all state transitions delegated to persistence layer, module holds no mutable state, concurrency safety via MOD-016 optimistic locking.            |
| PRF-MOD-002 | Updated MOD-009 interface and data model to ARCH contract output `{ perServing, perRecipe, missingItems[] }`; added `UNIT_INCONVERTIBLE` (422) throw path for unconvertible units.                                                                                                                                                                                                                                                                                                       |
| PRF-MOD-003 | Added whitelist validation at start of MOD-011 `build()` and throws `INVALID_FILTER({ code, field })`; added Error Handling row.                                                                                                                                                                                                                                                                                                                                                         |
| PRF-MOD-004 | Aligned MOD-010 `pageSize` constraint/guard to `≤ 100`; added `SEARCH_TIMEOUT` (504) exception in interface, pseudocode timeout guard, and error table.                                                                                                                                                                                                                                                                                                                                  |
| PRF-MOD-005 | Added quota check to MOD-012 pseudocode with `MOD-024.photoUploads.countPendingForUser(...)`; added `UPLOAD_QUOTA_EXCEEDED` (429) in interface/error table and `QUOTA_LIMIT` constant.                                                                                                                                                                                                                                                                                                   |
| PRF-MOD-006 | Reconciled MOD-013 to ARCH codes (`UPLOAD_INVALID` 422, `UPLOAD_NOT_FOUND` 404) and updated MOD-028 `STATUS_FOR` mapping to include upload and conversion codes.                                                                                                                                                                                                                                                                                                                         |
| PRF-MOD-007 | Added advisory lock acquisition/release to MOD-021 pull path and added `PULL_LOCK_HELD` (409) to interface and error handling.                                                                                                                                                                                                                                                                                                                                                           |
| PRF-MOD-008 | Replaced empty MOD-003 Internal Data Structures prose with explicit route params, list query, `If-Match` header binding, and DTO aliases.                                                                                                                                                                                                                                                                                                                                                |
| PRF-MOD-009 | Removed non-conformant "inherits" statement from MOD-020 and replaced NestJS class-name errors with domain error codes across the full matrix.                                                                                                                                                                                                                                                                                                                                           |
| PRF-MOD-010 | Defined `roundTo3` algorithm inline in MOD-007 pseudocode and added typed function specification to Internal Data Structures.                                                                                                                                                                                                                                                                                                                                                            |
| PRF-MOD-011 | Added explicit `normalize(quantity, fromUnit, toUnit)` specification in MOD-008, with conversion maps, unknown-unit behavior (`UNIT_INCONVERTIBLE`), and data-structure definitions.                                                                                                                                                                                                                                                                                                     |
| PRF-MOD-012 | Added full `convertToGrams(quantity, unit, density)` specification in MOD-009 with mass/volume tables, formula, and unsupported-unit behavior.                                                                                                                                                                                                                                                                                                                                           |
| PRF-MOD-013 | Added named `CDN_INVALIDATION_FAILED` handling in MOD-023: warning log + append CDN paths to `failed` list + retry via reconciler path.                                                                                                                                                                                                                                                                                                                                                  |
| PRF-MOD-014 | Added explicit MOD-032 internal types `CoverageReport` and `TraceabilityGap`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| PRF-MOD-015 | Added MOD-019 `PendingArchiveRow` type for rows returned by `findPending()` and iterated by reconciler loop.                                                                                                                                                                                                                                                                                                                                                                             |
| PRF-MOD-016 | Documented SQS FIFO 5-minute dedup window in MOD-017 and switched dedup ID derivation to include attempt (`${job.jobId}-attempt-${job.attempt}`).                                                                                                                                                                                                                                                                                                                                        |
| PRF-MOD-017 | Added MOD-018 `ArchiveJob` type to make message-body contract self-contained in Internal Data Structures.                                                                                                                                                                                                                                                                                                                                                                                |
| PRF-MOD-018 | Quantified MOD-025 retry/backoff policy as `3 attempts, exponential backoff base 200 ms, full jitter, max delay 2 s`.                                                                                                                                                                                                                                                                                                                                                                    |
| PRF-MOD-019 | Added explicit offline behavior statement to MOD-026: no offline mutations; network errors surfaced via error boundary with retry affordance.                                                                                                                                                                                                                                                                                                                                            |
| PRF-MOD-020 | Specified MOD-022 `isAdmin(userId)` mechanism using principal roles (`admin` via the session token's `public_metadata` claim) and typed supporting structure.                                                                                                                                                                                                                                                                                                                            |
| PRF-MOD-021 | Added `DB_UNAVAILABLE` (503) propagation row to MOD-009 Error Handling and documented caller-visible behavior.                                                                                                                                                                                                                                                                                                                                                                           |
| PRF-MOD-022 | Added explicit MOD-004 pseudocode comment documenting `VERSION_WRITE_FAILED` propagation and transaction abort behavior.                                                                                                                                                                                                                                                                                                                                                                 |
| PRF-MOD-023 | Expanded MOD-024 `applyErasureMutations` with explicit table order, tombstone/nullify operations, and FK-handling strategy.                                                                                                                                                                                                                                                                                                                                                              |
| FIX2-D1     | Rewrote MOD-014 to the D1 topology: the photo-processor Lambda is **S3-only, not VPC-attached, touches no DB** — it renders WebP derivatives to S3 and emits an SQS `photo-processed` message. The `recipe_photos` completion `UPDATE` (`processing_status='complete'\|'failed'`) is performed by the in-VPC **Fargate `photo-processed` consumer** (documented in the section). Corrected the MOD-001 and MOD-013 State Machine notes that had attributed the DB transition to MOD-014. |
| FIX2-D6     | Aligned the `recipe_version_pending_archives` FK design (D6): MOD-015 insert now writes `recipe_version_id` (FK) + `recipe_id`/`version_number`/`status` and **no snapshot column** (replay payload IS `recipe_versions.snapshot`). Updated MOD-019 `PendingArchiveRow` to the canonical columns and the reconciler to derive the S3 destination from `recipe_id`+`version_number` rather than a stored key.                                                                             |
