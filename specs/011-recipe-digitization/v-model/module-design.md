# Module Design: Recipe Digitization & Family Circles

**Feature Branch**: `011-recipe-digitization`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/011-recipe-digitization/v-model/architecture-design.md`

## Overview

Feature 011's module decomposition translates each of the 47 `ARCH-NNN` modules from `architecture-design.md` into a flat catalogue of `MOD-NNN` low-level units (functions, classes, handlers, adapter operations, public library surfaces) sized so that source code becomes a translation exercise rather than a design exercise. Decomposition follows §3.1 of `speckit.v-model.module-design.md`: Components split per major function/class, Services per endpoint or handler, Libraries per public API surface, Utilities and small Adapters often 1:1, Adapter modules per distinct operation. The resulting inventory is **91 MODs** with 100% forward `ARCH → MOD` coverage; cross-cutting infrastructure (`ARCH-041..047`) inherits the `[CROSS-CUTTING]` tag through to its MODs and receives the same decomposition rigor as business logic per §3.2. This is a **non-regulated** project (`v-model-config.yml.domain` is empty), so the safety-critical sections (Complexity Constraints, Memory Management, Single Entry/Exit) are intentionally omitted from per-MOD bodies — only the four mandatory views (Algorithmic/Logic, State Machine, Internal Data Structures, Error Handling) will be authored in chunks MD-2..MD-4.

## ID Schema

- **Module Design**: `MOD-NNN` — sequential 3-digit identifier (`MOD-001`..`MOD-091`); never renumbered.
- **Parent Architecture Modules**: comma-separated `ARCH-NNN` list per MOD (many-to-many; one ARCH may produce multiple MODs and one MOD may serve multiple ARCHs).
- **Type**: `Function`, `Class`, `Handler`, `Adapter Op`, `Public API`, `Configuration`, `UI Component`, `Worker`, `Job`, `Validator`, `Wrapper` — informs decomposition view emphasis (e.g., handlers always emit a State Machine view at controller scope; pure functions use the `N/A — Stateless` bypass).
- **Tags** (inherited from parent ARCH where present):
    - `[CROSS-CUTTING]` — infrastructure module consumed horizontally; full four-view decomposition still required (§3.2).
    - `[EXTERNAL]` — wrapper around a third-party library; pseudocode covers wrapper logic only (retry, pooling, config), not vendor internals. None expected at this layer; flagged here for future use.
    - `[DERIVED MODULE: <reason>]` — function not traceable to any `ARCH-NNN`; MUST be reconciled by updating `architecture-design.md` first. None at this chunk.
- Examples:
    - `MOD-009` with Parent `ARCH-005` — `handle_create_digitization_jobs` endpoint handler.
    - `MOD-066 [CROSS-CUTTING]` with Parent `ARCH-044` — `idempotency.run(key, payloadHash, fn)` wrapper function.

## Module Inventory

The table below decomposes all 47 ARCH modules into 91 MOD specifications. Per-MOD bodies (Algorithmic/Logic, State Machine, Internal Data Structures, Error Handling) are deferred to chunks MD-2..MD-4 per §4 of the command.

| MOD ID  | Name                                                          | Parent ARCH        | Type          | Notes                                                                                     |
| ------- | ------------------------------------------------------------- | ------------------ | ------------- | ----------------------------------------------------------------------------------------- |
| MOD-001 | `CapturePicker` web component                                 | ARCH-001           | UI Component  | File-picker UI; client-side MIME/size pre-check; emits `BatchSelected`.                   |
| MOD-002 | `useBatchUploadState` web hook                                | ARCH-001           | Function      | React state machine for batch lifecycle (`idle → selecting → ready → uploading → done`).  |
| MOD-003 | `CapturePickerNative` Expo screen                             | ARCH-002           | UI Component  | Camera + library picker with native permission handling.                                  |
| MOD-004 | `useNativePermissions` hook                                   | ARCH-002           | Function      | Wraps Expo permission API with deny/limited fallbacks.                                    |
| MOD-005 | `presignedUpload(file, opts)`                                 | ARCH-003           | Public API    | Streams file bytes via PUT; integrates `Idempotency-Key`.                                 |
| MOD-006 | `withRetryEnvelope(fn, policy)`                               | ARCH-003           | Function      | Bounded retry with exponential backoff + jitter for transient PUT failures.               |
| MOD-007 | `OfflineQueueStore` (web SQLite/IDB / mobile SQLite)          | ARCH-004           | Class         | Persistent FIFO of unsent uploads keyed by `batch_id`.                                    |
| MOD-008 | `OfflineQueueDrainer`                                         | ARCH-004           | Worker        | Background flusher that resumes pending PUTs on connectivity restore.                     |
| MOD-009 | `POST /jobs` handler                                          | ARCH-005           | Handler       | Validates payload, mints `job_id`s, returns pre-signed PUT URLs.                          |
| MOD-010 | `mintPresignedPutUrl(jobId, key)`                             | ARCH-005, ARCH-007 | Function      | Calls `@aws-sdk/s3-request-presigner`; binds `Idempotency-Key` header.                    |
| MOD-011 | `validateJobIntakeDto`                                        | ARCH-005           | Validator     | `class-validator` DTO check (batch size, MIME hint, count).                               |
| MOD-012 | `validateImagePreflight(meta)`                                | ARCH-006           | Validator     | Enforces 300×300 px min, 20 MB max, MIME ∈ {jpeg,png,heic}.                               |
| MOD-013 | `PreflightError` taxonomy                                     | ARCH-006           | Class         | Typed errors with stable `error_code` strings consumed by ARCH-028.                       |
| MOD-014 | `s3.putObjectMetadata(key, meta)` adapter op                  | ARCH-007           | Adapter Op    | Persists checksum + content-length on `digitization_jobs` after PUT.                      |
| MOD-015 | `s3.getCdnUrl(key)` adapter op                                | ARCH-007           | Adapter Op    | Returns CloudFront-fronted GET URL.                                                       |
| MOD-016 | `s3.softDeleteObject(key, retentionDays)` adapter op          | ARCH-007           | Adapter Op    | Tags object with 30-day retention; relies on bucket lifecycle policy.                     |
| MOD-017 | `OcrJobDispatcher.send(jobId)`                                | ARCH-008           | Function      | Builds SQS message and publishes within 30s of upload commit.                             |
| MOD-018 | `concurrencyTokenBucket(userId)`                              | ARCH-008           | Function      | Per-user concurrency control supporting ≥20 concurrent jobs.                              |
| MOD-019 | `ocrWorker.handler(event)` Lambda entry                       | ARCH-009           | Handler       | SQS event source; orchestrates fetch → invoke → parse → persist.                          |
| MOD-020 | `ocrWorker.dispatchToProvider(payload)`                       | ARCH-009           | Function      | Calls `OcrProvider` with timeout + structured logging.                                    |
| MOD-021 | `ocrWorker.handleFailure(err)`                                | ARCH-009           | Function      | Classifies retriable vs terminal; routes terminal to DLQ.                                 |
| MOD-022 | `OcrProvider` interface (`@kitchensink/digitization-ocr`)     | ARCH-010           | Public API    | TS interface: input shape, confidences, language, error taxonomy, timeout.                |
| MOD-023 | `OcrRawResult` + `OcrError` types                             | ARCH-010           | Public API    | Shared DTOs for raw payload and error envelope.                                           |
| MOD-024 | `DefaultOcrProviderAdapter.recognize(input)`                  | ARCH-011           | Adapter Op    | Vendor SDK call mapped to `OcrProvider.recognize`.                                        |
| MOD-025 | `DefaultOcrProviderAdapter.mapVendorError(err)`               | ARCH-011           | Function      | Translates vendor SDK errors to `OcrError` taxonomy.                                      |
| MOD-026 | `parseRawToFields(raw)`                                       | ARCH-012           | Function      | Normalizes provider output into `{title,ingredients,steps,yield,prep_time,cook_time}`.    |
| MOD-027 | `attachConfidences(parsed, raw)`                              | ARCH-012           | Function      | Decorates parsed fields with per-token confidences + language code.                       |
| MOD-028 | `persistOcrPayload(jobId, raw, parsed)`                       | ARCH-013           | Function      | Writes `raw_ocr_json` and `parsed_json` columns within ARCH-039 transaction.              |
| MOD-029 | `enforceRawRetention(jobId)`                                  | ARCH-013, ARCH-033 | Function      | Lifetime contract guard: raw purged at 90d, parsed retained for row lifetime.             |
| MOD-030 | `GET /jobs/:id/correction` handler                            | ARCH-014           | Handler       | Projects `parsed_json` to `CorrectionView`.                                               |
| MOD-031 | `PATCH /jobs/:id/correction` handler                          | ARCH-014           | Handler       | Validates patch paths; merges into `parsed_json`.                                         |
| MOD-032 | `mergeCorrectionPatch(parsed, patch)`                         | ARCH-014           | Function      | Pure merge function with per-field `accepted_at` capture.                                 |
| MOD-033 | `evaluateAcceptAllEligibility(parsed, accepted)`              | ARCH-015           | Function      | Returns `{eligible:boolean, missing:string[]}`.                                           |
| MOD-034 | `CorrectionScreen` web component                              | ARCH-016           | UI Component  | Side-by-side photo + parsed-fields editor.                                                |
| MOD-035 | `useCorrectionForm` web hook                                  | ARCH-016           | Function      | Form state + dirty-field tracking; emits PATCH deltas.                                    |
| MOD-036 | `CorrectionScreen` mobile component                           | ARCH-017           | UI Component  | Native side-by-side editor with keyboard-avoiding layout.                                 |
| MOD-037 | `useCorrectionFormNative` hook                                | ARCH-017           | Function      | Mobile form state mirror of MOD-035.                                                      |
| MOD-038 | `POST /jobs/:id/save` handler                                 | ARCH-018           | Handler       | Save bridge: creates `recipes` row + outbox event in one TX.                              |
| MOD-039 | `buildRecipeFromParsed(parsed, ownerId)`                      | ARCH-018           | Function      | Deterministic projection from `parsed_json` to `recipes` insert payload.                  |
| MOD-040 | `GET /jobs/:id` handler                                       | ARCH-019           | Handler       | Returns job lifecycle state + last-event timestamp.                                       |
| MOD-041 | `DELETE /jobs/:id` handler                                    | ARCH-019           | Handler       | Cancels job; transitions to `cancelled`; preserves audit.                                 |
| MOD-042 | `GET /jobs` handler                                           | ARCH-020           | Handler       | Paginated list filtered by `state` and `batch_id`.                                        |
| MOD-043 | `JobListProjection.toView(rows)`                              | ARCH-020           | Function      | Projects DB rows to `JobListItemView`.                                                    |
| MOD-044 | `POST /circles` handler                                       | ARCH-021           | Handler       | Creates circle; assigns owner; emits `circle.created`.                                    |
| MOD-045 | `POST /circles/:id/members` handler                           | ARCH-021           | Handler       | Adds member; idempotent on `(circle_id,user_id)`.                                         |
| MOD-046 | `DELETE /circles/:id/members/:userId` handler                 | ARCH-021           | Handler       | Removes member; emits `circle.member.removed`.                                            |
| MOD-047 | `circleAccessGuard(viewerId, circleId)`                       | ARCH-021           | Function      | Membership/ownership check used by other handlers.                                        |
| MOD-048 | `rewriteAudiencesOnMembershipChange(circleId, removedUserId)` | ARCH-022           | Function      | Compacts audience grants when a member is removed.                                        |
| MOD-049 | `softDeleteRecipe(recipeId, actorId)`                         | ARCH-023           | Function      | Sets `deleted_at`; enqueues archive request via outbox.                                   |
| MOD-050 | `restoreRecipe(recipeId, actorId)`                            | ARCH-023           | Function      | Clears `deleted_at` within retention window; emits `recipe.restored`.                     |
| MOD-051 | `archiveRecipeVersion(message)` worker handler                | ARCH-023           | Worker        | SQS consumer that PUTs JSON snapshot to `s3://recipes/.../archive/...`.                   |
| MOD-052 | `appendCircleAuditEntry(entry)`                               | ARCH-024           | Function      | Append-only insert into `audit_log`; rejects updates.                                     |
| MOD-053 | `circleOutlierMonitor.run()`                                  | ARCH-025           | Job           | Scheduled aggregator emitting `circle.size.outlier` events.                               |
| MOD-054 | `POST /circles/:id/invitation/rotate` handler                 | ARCH-026           | Handler       | Owner-only; rotates active invite token.                                                  |
| MOD-055 | `POST /circles/join/:token` handler                           | ARCH-026           | Handler       | Redeems invite token; idempotent membership add.                                          |
| MOD-056 | `AuthMiddleware.use(req, res, next)`                          | ARCH-027           | Class         | NestJS middleware verifying the Clerk session token networklessly via `ClerkAuthService`. |
| MOD-057 | `ClerkAuthService`                                            | ARCH-027           | Class         | Wraps `@clerk/backend` `verifyToken` against `CLERK_JWT_KEY`; enforces `azp`.             |
| MOD-058 | `Rfc7807ExceptionFilter.catch(err, host)`                     | ARCH-028           | Class         | Global NestJS exception filter; emits `application/problem+json`.                         |
| MOD-059 | `mapErrorToProblem(err)`                                      | ARCH-028           | Function      | Pure mapping from typed errors to RFC 7807 envelopes with stable `error_code`.            |
| MOD-060 | `Audience` types + `AudienceScope` union                      | ARCH-029           | Public API    | Pure TS types exported from `@kitchensink/shared-audience`.                               |
| MOD-061 | `assertCircleRefIdPresent(audience)`                          | ARCH-029           | Function      | Consumer-side guard enforcing `ref_id` when `scope='circle'`.                             |
| MOD-062 | `applyApiV1Prefix(app)` bootstrap step                        | ARCH-030           | Configuration | Sets global prefix `api/v1` on the Nest application.                                      |
| MOD-063 | `routePrefixLintRule`                                         | ARCH-030           | Configuration | ESLint rule enforcing `/api/v1/*` route prefix in CI.                                     |
| MOD-064 | `resolveAudience(viewerId, audience, health)`                 | ARCH-031           | Function      | Returns `'allow' \| 'deny' \| 'circles_unavailable'` (no silent allow on outage).         |
| MOD-065 | `InvitationAcceptanceScreen`                                  | ARCH-032           | UI Component  | Accessible WCAG 2.1 AA confirmation surface for `/circles/join/:token`.                   |
| MOD-066 | `rawOcrPurgeJob.run()`                                        | ARCH-033           | Job           | Daily scheduled purge of `raw_ocr_json` older than 90 days.                               |
| MOD-067 | `metrics.emit(name, value, dims)`                             | ARCH-034           | Function      | Async fire-and-forget metric publisher.                                                   |
| MOD-068 | `cdkAlarmDefinitions`                                         | ARCH-034           | Configuration | CDK alarm specs for queue depth, DLQ, OCR p95 latency.                                    |
| MOD-069 | `POST /internal/canary/promote` handler                       | ARCH-035           | Handler       | Evaluates gate signals; returns promotion verdict.                                        |
| MOD-070 | `evaluateCanaryGates(window)`                                 | ARCH-035           | Function      | Pure evaluator over telemetry window; default-deny on insufficient signal.                |
| MOD-071 | `flags.isEnabled(name, ctx)`                                  | ARCH-036           | Function      | Cached feature-flag lookup with last-known-good fallback.                                 |
| MOD-072 | `FlagWebhookHandler`                                          | ARCH-036           | Handler       | Invalidates cache on provider webhook.                                                    |
| MOD-073 | `testConventionLintRules`                                     | ARCH-037           | Configuration | ESLint rule pack enforcing test naming + colocation.                                      |
| MOD-074 | `workspaceGuardrailsCi`                                       | ARCH-038           | Configuration | CI job config: project references, schema isolation, generated types ordering.            |
| MOD-075 | `withSerializable(fn)` wrapper                                | ARCH-039           | Function      | Wraps callbacks in `BEGIN ISOLATION LEVEL SERIALIZABLE`; retries on `40001`.              |
| MOD-076 | `txWrapperLintRule`                                           | ARCH-039           | Configuration | AST rule ensuring critical-path mutations use `withSerializable`.                         |
| MOD-077 | `uiPrimitiveReuseLintRule`                                    | ARCH-040           | Configuration | Custom ESLint rule flagging duplicated primitives outside `packages/ui`.                  |
| MOD-078 | `primitivesRationaleDoc` enforcer                             | ARCH-040           | Configuration | Verifies `packages/ui/PRIMITIVES.md` row exists for each new primitive.                   |
| MOD-079 | `logger.info/warn/error(msg, ctx)` [CROSS-CUTTING]            | ARCH-041           | Function      | Request-scoped structured logger bound to OTel trace context.                             |
| MOD-080 | `logger.bind(scope)` [CROSS-CUTTING]                          | ARCH-041           | Function      | Attaches `{user_id, job_id, circle_id}` to subsequent log lines.                          |
| MOD-081 | `loadAppConfig()` [CROSS-CUTTING]                             | ARCH-042           | Function      | Boot-time Zod-validated config loader; fail-fast on invalid env.                          |
| MOD-082 | `SecretsResolver.get(arn)` [CROSS-CUTTING]                    | ARCH-042           | Class         | First-use AWS Secrets Manager resolver with in-process cache.                             |
| MOD-083 | `sentry.bootstrap()` [CROSS-CUTTING]                          | ARCH-043           | Function      | Initializes `@sentry/aws-serverless` + Nest adapter.                                      |
| MOD-084 | `sentry.captureException(err, ctx)` [CROSS-CUTTING]           | ARCH-043           | Function      | Forwards to Sentry; mirrors to `logger.error` for local visibility.                       |
| MOD-085 | `idempotency.run(key, payloadHash, fn)` [CROSS-CUTTING]       | ARCH-044           | Function      | TX-aware idempotency wrapper backed by `idempotency_keys`.                                |
| MOD-086 | `outbox.publish(event, tx)` [CROSS-CUTTING]                   | ARCH-045           | Function      | Inserts outbox row inside caller TX.                                                      |
| MOD-087 | `outboxDrainer.run()` [CROSS-CUTTING]                         | ARCH-045           | Worker        | Scheduled drain → SNS/SQS publish → `dispatched_at` ack.                                  |
| MOD-088 | `tracing.init({serviceName, exporter})` [CROSS-CUTTING]       | ARCH-046           | Function      | Bootstraps OTel SDK; installs auto-instrumentation.                                       |
| MOD-089 | `tracing.withSpan(name, fn)` [CROSS-CUTTING]                  | ARCH-046           | Function      | Helper that wraps callbacks in a child span.                                              |
| MOD-090 | `db` Drizzle client factory [CROSS-CUTTING]                   | ARCH-047           | Function      | Singleton pool factory + typed schema binding.                                            |
| MOD-091 | `db.transaction(async (tx) => ...)` [CROSS-CUTTING]           | ARCH-047           | Function      | Drizzle TX helper used by ARCH-005, 014, 018, 021, 022, 023, 044, 045.                    |

> Inventory totals (verified during MD-1):
>
> - MOD count: **91** (MOD-001..MOD-091).
> - ARCH coverage: **47/47** ARCH modules have ≥1 child MOD.
> - Cross-cutting MODs: 13 (MOD-079..MOD-091; inherit `[CROSS-CUTTING]` from ARCH-041..047).
> - External MODs: 0.
> - Derived MODs: 0.

## Module Designs

Per-MOD bodies follow. Each body has the four mandatory views: **Algorithmic / Logic**, **State Machine**, **Internal Data Structures**, **Error Handling**. Per `v-model-config.yml.domain` being empty (non-regulated mode), the safety-critical sections (Complexity Constraints, Memory Management, Single Entry/Exit) are intentionally omitted. Stateless modules use the `N/A — Stateless` bypass for the State Machine view per §3.4 of the command.

Bodies are authored in chunks: **MD-2** = MOD-001..MOD-008 (capture & upload), **MD-3a..MD-3l** = remaining business + cross-cutting MODs, **MD-4** = wrap-up + integrity check.

---

### MOD-001 — `CapturePicker` web component

- **Parent ARCH**: ARCH-001
- **Type**: UI Component

**Algorithmic / Logic**

```text
function CapturePicker({ onBatchSelected, maxFiles, accept }):
  state = useBatchUploadState()                      # MOD-002
  fileInput = <input type="file" multiple accept={accept}/>
  on fileInput.change(event):
    files = Array.from(event.target.files)
    if files.length == 0: return                     # user cancelled
    if files.length > maxFiles:
      state.reject(reason="BATCH_TOO_LARGE", limit=maxFiles)
      return
    preflight = files.map(clientPreflight)           # client-side MIME + size sniff
    rejects = preflight.filter(r => !r.ok)
    if rejects.length > 0:
      state.reject(reason="PREFLIGHT_FAIL", details=rejects)
      return
    state.markReady(preflight.map(p => p.normalised))
    onBatchSelected(state.batch)                     # bubbles BatchSelected event
  render:
    <DropZone onDrop={fileInput.click}/>
    <PreviewStrip files={state.batch}/>
    <SubmitButton disabled={state.phase != "ready"}/>
```

**State Machine**

```text
phases:  idle → selecting → ready → uploading → done
                       ↘ error ↗ (retryable; user re-picks)
transitions:
  idle        --user-clicks-->        selecting
  selecting   --files-validated-->    ready
  selecting   --validation-fail-->    error
  ready       --user-submits-->       uploading
  uploading   --all-PUTs-acked-->     done
  uploading   --any-PUT-fails-->      error
  error       --user-retries-->       selecting
```

**Internal Data Structures**

```text
BatchItem = {
  clientId: uuid,                # local handle until server mints job_id
  file: File,                    # browser File handle (no copy)
  mime: "image/jpeg" | "image/png" | "image/heic",
  byteSize: number,
  width: number, height: number, # from createImageBitmap probe
  thumbnail: Blob (≤ 64 kB)
}
Batch = { id: uuid, items: BatchItem[], createdAt: ISO8601 }
```

**Error Handling**

| Condition               | Code                   | Surfaced As                 | Recovery                      |
| ----------------------- | ---------------------- | --------------------------- | ----------------------------- |
| File count > `maxFiles` | `BATCH_TOO_LARGE`      | inline banner + count badge | user removes items            |
| MIME not in allowed set | `PREFLIGHT_MIME`       | per-item red border         | item dropped from batch       |
| Dimensions < 300×300    | `PREFLIGHT_DIMENSIONS` | per-item red border         | item dropped from batch       |
| `byteSize > 20 MB`      | `PREFLIGHT_SIZE`       | per-item red border         | item dropped from batch       |
| Browser denies File API | `BROWSER_UNSUPPORTED`  | full-screen fallback        | user routed to native app CTA |

---

### MOD-002 — `useBatchUploadState` web hook

- **Parent ARCH**: ARCH-001
- **Type**: Function (custom React hook)

**Algorithmic / Logic**

```text
function useBatchUploadState():
  [phase, setPhase]   = useState("idle")
  [batch, setBatch]   = useState(emptyBatch())
  [error, setError]   = useState(null)

  function markSelecting():       setPhase("selecting"); setError(null)
  function markReady(items):      setBatch({...batch, items}); setPhase("ready")
  function markUploading():       setPhase("uploading")
  function markDone():            setPhase("done"); setError(null)
  function reject(reason, ...):   setError({reason, ...}); setPhase("error")
  function reset():               setBatch(emptyBatch()); setPhase("idle"); setError(null)

  return { phase, batch, error, markSelecting, markReady, markUploading, markDone, reject, reset }
```

**State Machine**

Mirrors MOD-001 phases. Hook owns the transition table; component is the trigger surface.

**Internal Data Structures**

```text
HookState = {
  phase: "idle" | "selecting" | "ready" | "uploading" | "done" | "error",
  batch: Batch,
  error: { reason: string, details?: unknown } | null
}
```

**Error Handling**

- Pure state container — never throws. All errors surface via `error` slot consumed by MOD-001.
- Defensive: `setPhase` to an unknown literal logs `console.warn` with `INVALID_PHASE_TRANSITION` and is otherwise no-op.

---

### MOD-003 — `CapturePickerNative` Expo screen

- **Parent ARCH**: ARCH-002
- **Type**: UI Component

**Algorithmic / Logic**

```text
function CapturePickerNative({ onBatchSelected, maxFiles }):
  perms = useNativePermissions(["camera","mediaLibrary"])     # MOD-004
  state = useBatchUploadState()                                # shared with web via shared package
  if !perms.cameraGranted && !perms.libraryGranted:
    return <PermissionPrompt onRequest={perms.request}/>
  on user-tap "Take Photo":
    if !perms.cameraGranted: perms.request("camera"); return
    result = await ImagePicker.launchCameraAsync({ quality: 0.9, base64: false })
    if result.canceled: return
    pushItem(result.assets[0])
  on user-tap "Pick from Library":
    if !perms.libraryGranted: perms.request("mediaLibrary"); return
    result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, selectionLimit: maxFiles })
    if result.canceled: return
    result.assets.forEach(pushItem)
  function pushItem(asset):
    if state.batch.items.length >= maxFiles: state.reject("BATCH_TOO_LARGE"); return
    pre = clientPreflightNative(asset)
    if !pre.ok: state.reject("PREFLIGHT_FAIL", pre); return
    state.markReady([...state.batch.items, pre.normalised])
  render:
    <PreviewStrip files={state.batch}/>
    <SubmitButton disabled={state.phase != "ready"} onPress={() => onBatchSelected(state.batch)}/>
```

**State Machine**

Inherits MOD-002's machine; adds permission sub-state:

```text
permissions:  unknown → requesting → (granted | denied | limited)
denied → settings-deeplink → (granted | denied)
limited → continue with reduced library access
```

**Internal Data Structures**

```text
NativeBatchItem extends BatchItem {
  uri: string,           # Expo content:// or file:// URI
  exif?: { Orientation, GPSLatitude, GPSLongitude, ... },  # stripped before upload
  asset_id?: string      # MediaLibrary handle if from library
}
```

**Error Handling**

| Condition                 | Code                  | Surfaced As                       | Recovery                |
| ------------------------- | --------------------- | --------------------------------- | ----------------------- |
| Camera permission denied  | `PERM_CAMERA_DENIED`  | native alert + Settings deep-link | user grants in Settings |
| Library permission denied | `PERM_LIBRARY_DENIED` | native alert + Settings deep-link | user grants in Settings |
| `ImagePicker` throws      | `PICKER_NATIVE_ERROR` | toast + Sentry breadcrumb         | retry CTA               |
| Asset URI unreadable      | `ASSET_READ_FAIL`     | per-item red border               | item dropped            |

---

### MOD-004 — `useNativePermissions` hook

- **Parent ARCH**: ARCH-002
- **Type**: Function (custom React hook)

**Algorithmic / Logic**

```text
function useNativePermissions(scopes):
  [state, setState] = useState({ cameraGranted:false, libraryGranted:false, libraryLimited:false, requesting:false })
  useEffect(() => refresh(), [])
  async function refresh():
    cam = await Camera.getCameraPermissionsAsync()
    lib = await MediaLibrary.getPermissionsAsync()
    setState({
      cameraGranted: cam.status == "granted",
      libraryGranted: lib.status == "granted",
      libraryLimited: lib.accessPrivileges == "limited",
      requesting: false
    })
  async function request(scope):
    setState({...state, requesting:true})
    if scope == "camera":      await Camera.requestCameraPermissionsAsync()
    if scope == "mediaLibrary":await MediaLibrary.requestPermissionsAsync()
    await refresh()
  return { ...state, request, openSettings: Linking.openSettings }
```

**State Machine**

```text
unknown → requesting → granted
                   ↘ denied  → (user opens Settings → unknown)
                   ↘ limited → granted-with-restrictions
```

**Internal Data Structures**

```text
PermissionState = {
  cameraGranted: boolean,
  libraryGranted: boolean,
  libraryLimited: boolean,
  requesting: boolean
}
```

**Error Handling**

- Expo permission APIs do not throw under normal conditions; rejected promises are caught and re-emitted as `PERM_API_ERROR` with the underlying message preserved for Sentry.
- `openSettings()` is best-effort; failure logs `PERM_SETTINGS_DEEPLINK_FAIL` and shows a copy-path fallback.

---

### MOD-005 — `presignedUpload(file, opts)`

- **Parent ARCH**: ARCH-003
- **Type**: Public API

**Algorithmic / Logic**

```text
async function presignedUpload(file, opts):
  # opts: { url, headers, idempotencyKey, onProgress, signal }
  body = file.stream ? file.stream() : file               # streams when supported
  headers = {
    "Content-Type":      file.type,
    "Content-Length":    file.size,
    "Idempotency-Key":   opts.idempotencyKey,
    ...opts.headers
  }
  return withRetryEnvelope(                              # MOD-006
    () => fetch(opts.url, { method:"PUT", body, headers, signal: opts.signal }),
    policy: { retries:3, baseMs:500, maxMs:8000, jitter:true, retryOn:[408,425,429,500,502,503,504,"NETWORK"] }
  ).then(res => {
    if !res.ok: throw new UploadError(res.status, await res.text())
    return { etag: res.headers.get("etag"), size: file.size }
  })
```

**State Machine**

`N/A — Stateless` (single PUT operation; retry state lives inside MOD-006).

**Internal Data Structures**

```text
UploadOpts = {
  url: string,                 # pre-signed S3 PUT URL
  headers?: Record<string,string>,
  idempotencyKey: string,      # uuid v4
  onProgress?: (bytesUploaded:number, total:number) => void,
  signal?: AbortSignal
}
UploadResult = { etag: string, size: number }
```

**Error Handling**

| Condition                             | Code                   | Behaviour                                                |
| ------------------------------------- | ---------------------- | -------------------------------------------------------- |
| Network failure                       | `NETWORK`              | retried by MOD-006 up to 3×                              |
| HTTP 408/425/429/5xx                  | `<status>`             | retried by MOD-006                                       |
| HTTP 4xx (non-retryable)              | `<status>`             | thrown as `UploadError`; bubbles to MOD-001 `error` slot |
| `AbortSignal.aborted`                 | `ABORTED`              | thrown as `AbortError`; not retried                      |
| `Content-Length` mismatch on response | `RESP_LENGTH_MISMATCH` | thrown; logged to Sentry with `etag` for forensic match  |

---

### MOD-006 — `withRetryEnvelope(fn, policy)`

- **Parent ARCH**: ARCH-003
- **Type**: Function

**Algorithmic / Logic**

```text
async function withRetryEnvelope(fn, policy):
  attempt = 0
  while true:
    try:
      return await fn()
    catch (err):
      attempt += 1
      classified = classify(err, policy.retryOn)
      if !classified.retryable || attempt > policy.retries: throw err
      delay = min(policy.maxMs, policy.baseMs * 2^(attempt-1))
      if policy.jitter: delay = random(delay/2, delay)
      await sleep(delay)

function classify(err, retryOn):
  if err.name == "AbortError": return { retryable:false }
  if err.status && retryOn.includes(err.status): return { retryable:true }
  if !err.status && retryOn.includes("NETWORK"): return { retryable:true }
  return { retryable:false }
```

**State Machine**

```text
attempting → success ✓
attempting → fail-classified-retryable → backoff → attempting
attempting → fail-classified-fatal → throw
attempting → attempts > retries → throw
```

**Internal Data Structures**

```text
RetryPolicy = {
  retries: number,             # max additional attempts
  baseMs: number,
  maxMs: number,
  jitter: boolean,
  retryOn: Array<number | "NETWORK">
}
```

**Error Handling**

- Re-throws the **last** error after exhausting retries; preserves stack via `cause`.
- Honours external `AbortSignal` propagated through the wrapped `fn`; aborts short-circuit the loop without sleeping.
- Emits structured log on each retry: `{attempt, delayMs, errCode, errStatus}` consumed by MOD-088 (`tracing.init`).

---

### MOD-007 — `OfflineQueueStore`

- **Parent ARCH**: ARCH-004
- **Type**: Class

**Algorithmic / Logic**

```text
class OfflineQueueStore:
  constructor(driver):       # driver = SQLite (mobile/web), IndexedDB fallback
    this.db = driver.open("offline_uploads_v1")
    this.db.migrate(SCHEMA)

  async enqueue(item):
    row = { id: uuid(), batch_id: item.batch_id, payload: serialize(item), state:"pending", attempts:0, created_at: now() }
    await this.db.insert("uploads", row)
    return row.id

  async peekBatch(limit=10):
    return this.db.select("uploads")
                  .where("state IN ('pending','retry')")
                  .orderBy("created_at ASC")
                  .limit(limit)

  async markInFlight(id):    return this.db.update("uploads", id, { state:"in_flight", attempts: attempts+1, updated_at: now() })
  async markDone(id):        return this.db.delete("uploads", id)
  async markRetry(id, errCode):
    return this.db.update("uploads", id, { state:"retry", last_error: errCode, updated_at: now() })
  async markPoison(id, errCode):
    return this.db.update("uploads", id, { state:"poison", last_error: errCode, updated_at: now() })
```

**State Machine**

```text
row state:  pending → in_flight → done ✓
                          ↘ retry → in_flight … (≤ N attempts)
                          ↘ poison (after max attempts; surfaced to user)
```

**Internal Data Structures**

```text
SCHEMA `uploads`:
  id          TEXT PRIMARY KEY
  batch_id    TEXT NOT NULL
  payload     BLOB NOT NULL          -- serialized BatchItem (sans File handle)
  state       TEXT NOT NULL CHECK(state IN ('pending','in_flight','retry','poison'))
  attempts    INTEGER NOT NULL DEFAULT 0
  last_error  TEXT
  created_at  INTEGER NOT NULL       -- epoch ms
  updated_at  INTEGER
INDEX uploads_state_created ON uploads(state, created_at)
```

**Error Handling**

| Condition                | Code             | Behaviour                                                    |
| ------------------------ | ---------------- | ------------------------------------------------------------ |
| Driver open fails        | `OQ_DRIVER_OPEN` | thrown at construction; caller falls back to in-memory queue |
| Quota exceeded on insert | `OQ_QUOTA`       | thrown; MOD-008 pauses ingestion, surfaces banner            |
| Migration failure        | `OQ_MIGRATE`     | aborts; logs schema mismatch                                 |
| Row corruption on read   | `OQ_DESERIALIZE` | row marked `poison`, breadcrumb to Sentry                    |

---

### MOD-008 — `OfflineQueueDrainer`

- **Parent ARCH**: ARCH-004
- **Type**: Worker

**Algorithmic / Logic**

```text
class OfflineQueueDrainer:
  constructor(store, uploader):    # store = MOD-007, uploader = MOD-005
    this.store    = store
    this.uploader = uploader
    this.running  = false
    this.maxAttempts = 5
    this.subscribeConnectivity()

  subscribeConnectivity():
    NetInfo.addEventListener(s => { if s.isConnected && !this.running: this.run() })

  async run():
    this.running = true
    try:
      loop:
        rows = await this.store.peekBatch(10)
        if rows.length == 0: break
        for row in rows:
          await this.processOne(row)
    finally:
      this.running = false

  async processOne(row):
    item = deserialize(row.payload)
    await this.store.markInFlight(row.id)
    try:
      await this.uploader(item.file, item.uploadOpts)
      await this.store.markDone(row.id)
    catch (err):
      if row.attempts >= this.maxAttempts:
        await this.store.markPoison(row.id, err.code)
        emit("upload.poison", { id: row.id, errCode: err.code })
      else:
        await this.store.markRetry(row.id, err.code)
        emit("upload.retry", { id: row.id, attempt: row.attempts+1 })
```

**State Machine**

```text
drainer:  idle → running → idle
running steps per row inherit MOD-007 row state machine (pending → in_flight → done|retry|poison)
external trigger: connectivity-restored event flips idle → running
```

**Internal Data Structures**

```text
DrainerEvent =
  | { type:"upload.retry",  id:string, attempt:number }
  | { type:"upload.poison", id:string, errCode:string }
  | { type:"upload.done",   id:string }
```

**Error Handling**

- Top-level `try/finally` guarantees `running` flag clears even on uncaught throw.
- Poison rows are surfaced to the user via in-app notification; user action (retry/discard) routes back through MOD-007.
- Drainer is **idempotent** at the row level: if process crashes between `markInFlight` and `markDone`, next run sees `in_flight` rows older than `STALE_THRESHOLD_MS` (60 s) and resets them to `retry`.

---

> **MD-2 status**: MOD-001..MOD-008 complete (8/91).

---

### MOD-009 — `POST /jobs` handler

- **Parent ARCH**: ARCH-005
- **Type**: Handler (NestJS controller method)

**Algorithmic / Logic**

```text
@Post('/jobs')
# Protected by AuthMiddleware (MOD-056) wired in the module's configure(); req.user is already populated
@UseInterceptors(IdempotencyInterceptor)                # MOD-085 wrapper
async function handleCreateDigitizationJobs(req, dto: JobIntakeDto):
  validateJobIntakeDto(dto)                             # MOD-011 throws on bad input
  userId = req.user.sub
  await concurrencyTokenBucket(userId).acquire(dto.items.length)   # MOD-018
  jobs = []
  await db.transaction(async tx => {                    # MOD-091
    for item in dto.items:
      jobId = uuid()
      key   = `users/${userId}/jobs/${jobId}/original.${ext(item.mime)}`
      await tx.insert("digitization_jobs", {
        id: jobId, user_id: userId, batch_id: dto.batch_id,
        s3_key: key, mime: item.mime, byte_size: item.byte_size,
        state: "awaiting_upload", created_at: now()
      })
      url = await mintPresignedPutUrl(jobId, key)       # MOD-010
      jobs.push({ job_id: jobId, upload_url: url, expires_at: url.expiresAt })
    await outbox.publish({                              # MOD-086
      type: "DigitizationJobsCreated",
      payload: { batch_id: dto.batch_id, job_ids: jobs.map(j=>j.job_id) }
    }, tx)
  })
  return { batch_id: dto.batch_id, jobs }
```

**State Machine**

`N/A — Stateless` at handler scope. Persisted state lives on `digitization_jobs.state` (managed by ARCH-009..018) — handler only writes the initial `awaiting_upload` row.

**Internal Data Structures**

```text
JobIntakeDto = {
  batch_id: uuid,
  items: Array<{ mime: "image/jpeg"|"image/png"|"image/heic", byte_size: number, client_id?: uuid }>
}
JobIntakeResponse = {
  batch_id: uuid,
  jobs: Array<{ job_id: uuid, upload_url: string, expires_at: ISO8601 }>
}
```

**Error Handling**

| Condition                                       | Code                     | HTTP                | Recovery                             |
| ----------------------------------------------- | ------------------------ | ------------------- | ------------------------------------ |
| DTO validation fails                            | `INTAKE_DTO_INVALID`     | 400                 | client surfaces field errors         |
| Clerk session token missing/expired             | `AUTH_REQUIRED`          | 401                 | client refreshes token, retries      |
| Concurrency bucket exhausted                    | `RATE_LIMIT_USER`        | 429 + `Retry-After` | client backs off                     |
| Idempotency replay with mismatched payload hash | `IDEMPOTENCY_CONFLICT`   | 409                 | client regenerates `Idempotency-Key` |
| Pre-sign service unavailable                    | `S3_PRESIGN_UNAVAILABLE` | 503                 | client retries with same key         |
| TX rollback (any insert fails)                  | `INTAKE_TX_ROLLBACK`     | 500                 | logged + Sentry; client retries      |

---

### MOD-010 — `mintPresignedPutUrl(jobId, key)`

- **Parent ARCH**: ARCH-005, ARCH-007
- **Type**: Function

**Algorithmic / Logic**

```text
async function mintPresignedPutUrl(jobId, key):
  cmd = new PutObjectCommand({
    Bucket: env.S3_INTAKE_BUCKET,
    Key:    key,
    ContentType: inferContentType(key),
    Metadata: { "job-id": jobId }
  })
  expiresIn = env.PRESIGN_TTL_SEC ?? 900               # 15 min default
  url = await getSignedUrl(s3Client, cmd, {
    expiresIn,
    signableHeaders: new Set(["content-type","content-length","x-amz-meta-job-id","idempotency-key"])
  })
  return { url, expiresAt: new Date(Date.now() + expiresIn*1000).toISOString() }
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

```text
PresignResult = { url: string, expiresAt: ISO8601 }
```

**Error Handling**

- AWS SDK `getSignedUrl` rejection wrapped as `S3_PRESIGN_FAIL` with `cause` preserved.
- Missing bucket env var detected at boot via `@nestjs/config` Zod schema; not handled here.
- TTL clamped to `[60, 3600]` seconds; out-of-range values throw `S3_PRESIGN_TTL_RANGE` synchronously.

---

### MOD-011 — `validateJobIntakeDto`

- **Parent ARCH**: ARCH-005
- **Type**: Validator

**Algorithmic / Logic**

```text
class JobIntakeDto:
  @IsUUID('4')                            batch_id: string
  @ArrayMinSize(1) @ArrayMaxSize(env.MAX_BATCH_ITEMS ?? 30)
  @ValidateNested({ each: true }) @Type(() => JobIntakeItemDto)
  items: JobIntakeItemDto[]

class JobIntakeItemDto:
  @IsIn(["image/jpeg","image/png","image/heic"])  mime: string
  @IsInt() @Min(1) @Max(20 * 1024 * 1024)         byte_size: number
  @IsOptional() @IsUUID('4')                      client_id?: string

# Pipeline (NestJS ValidationPipe with whitelist:true, forbidNonWhitelisted:true, transform:true)
function validateJobIntakeDto(dto):
  errors = await validate(dto)
  if errors.length > 0: throw new BadRequestException({ code:"INTAKE_DTO_INVALID", errors: flattenErrors(errors) })
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

Defined inline above (`JobIntakeDto`, `JobIntakeItemDto`).

**Error Handling**

| Condition                                    | Code                                    |
| -------------------------------------------- | --------------------------------------- |
| Non-UUID `batch_id`                          | `INTAKE_DTO_INVALID.batch_id`           |
| Empty / oversized `items`                    | `INTAKE_DTO_INVALID.items`              |
| Disallowed MIME                              | `INTAKE_DTO_INVALID.items[i].mime`      |
| `byte_size` out of range                     | `INTAKE_DTO_INVALID.items[i].byte_size` |
| Extra unknown property (whitelist violation) | `INTAKE_DTO_INVALID._unknown`           |

---

### MOD-012 — `validateImagePreflight(meta)`

- **Parent ARCH**: ARCH-006
- **Type**: Validator

**Algorithmic / Logic**

```text
function validateImagePreflight(meta):
  if !ALLOWED_MIME.has(meta.mime):           throw new PreflightError("PREFLIGHT_MIME",        meta)
  if meta.byte_size <= 0 || meta.byte_size > MAX_BYTES:
                                             throw new PreflightError("PREFLIGHT_SIZE",        meta)
  if meta.width < MIN_DIM || meta.height < MIN_DIM:
                                             throw new PreflightError("PREFLIGHT_DIMENSIONS",  meta)
  if !meta.checksum_sha256 || meta.checksum_sha256.length != 64:
                                             throw new PreflightError("PREFLIGHT_CHECKSUM",    meta)
  return { ok: true, normalised: { ...meta, mime: meta.mime.toLowerCase() } }

constants:
  ALLOWED_MIME = new Set(["image/jpeg","image/png","image/heic"])
  MAX_BYTES    = 20 * 1024 * 1024
  MIN_DIM      = 300
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

```text
ImageMeta = {
  mime: string,
  byte_size: number,
  width: number, height: number,
  checksum_sha256: string,           # hex, 64 chars
  exif_orientation?: 1..8
}
PreflightOk = { ok: true, normalised: ImageMeta }
```

**Error Handling**

- Always throws `PreflightError` (MOD-013); never returns `{ ok:false }`. Calling sites use try/catch.
- `error_code` strings are stable and consumed by ARCH-028 (UI error taxonomy).

---

### MOD-013 — `PreflightError` taxonomy

- **Parent ARCH**: ARCH-006
- **Type**: Class

**Algorithmic / Logic**

```text
class PreflightError extends Error:
  static CODES = ["PREFLIGHT_MIME","PREFLIGHT_SIZE","PREFLIGHT_DIMENSIONS","PREFLIGHT_CHECKSUM"]
  constructor(code, context):
    super(`Preflight failed: ${code}`)
    this.name        = "PreflightError"
    this.code        = code
    this.context     = redactPII(context)             # strips EXIF GPS, filenames
    this.user_message = USER_MESSAGES[code]
    this.retryable   = false
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

```text
USER_MESSAGES = {
  PREFLIGHT_MIME:       "Use JPG, PNG, or HEIC.",
  PREFLIGHT_SIZE:       "Photo must be 20 MB or smaller.",
  PREFLIGHT_DIMENSIONS: "Photo must be at least 300×300 pixels.",
  PREFLIGHT_CHECKSUM:   "Photo could not be verified. Please reselect."
}
```

**Error Handling**

- Class itself never throws beyond `super()` invocation.
- `redactPII` is best-effort; if it throws, raw context is dropped and a `pii_redaction_failed:true` flag is set so log scrubbers can quarantine the breadcrumb.

---

### MOD-014 — `s3.putObjectMetadata(key, meta)` adapter op

- **Parent ARCH**: ARCH-007
- **Type**: Adapter Op

**Algorithmic / Logic**

```text
async function putObjectMetadata(key, meta):
  # meta = { etag, byte_size, checksum_sha256, content_type }
  await s3Client.send(new CopyObjectCommand({
    Bucket:           env.S3_INTAKE_BUCKET,
    Key:              key,
    CopySource:       `${env.S3_INTAKE_BUCKET}/${key}`,
    MetadataDirective: "REPLACE",
    Metadata: {
      "etag":            meta.etag,
      "checksum-sha256": meta.checksum_sha256,
      "byte-size":       String(meta.byte_size)
    },
    ContentType: meta.content_type
  }))
  await db.update("digitization_jobs", { s3_key: key }, {
    etag: meta.etag, byte_size: meta.byte_size, checksum_sha256: meta.checksum_sha256,
    state: "uploaded", uploaded_at: now()
  })
```

**State Machine**

`N/A — Stateless` at op scope. Triggers `digitization_jobs.state: awaiting_upload → uploaded`.

**Internal Data Structures**

```text
ObjectMetaInput = {
  etag: string, byte_size: number,
  checksum_sha256: string, content_type: string
}
```

**Error Handling**

| Condition                            | Code                | Behaviour                                             |
| ------------------------------------ | ------------------- | ----------------------------------------------------- |
| `CopyObject` fails (NoSuchKey)       | `S3_OBJECT_MISSING` | row stays `awaiting_upload`; reaper re-prompts client |
| ETag mismatch (concurrent overwrite) | `S3_ETAG_MISMATCH`  | abort write to DB; `409` to caller                    |
| DB row not found                     | `JOB_ROW_MISSING`   | logged; orphan cleanup job sweeps S3 object           |
| Generic AWS error                    | `S3_OP_FAIL`        | retried by MOD-006 with `{retries:2}` policy          |

---

### MOD-015 — `s3.getCdnUrl(key)` adapter op

- **Parent ARCH**: ARCH-007
- **Type**: Adapter Op

**Algorithmic / Logic**

```text
function getCdnUrl(key, opts = { variant: "original", ttlSec: 3600 }):
  base   = env.CLOUDFRONT_BASE_URL
  path   = opts.variant == "original" ? key : `derived/${opts.variant}/${key}`
  if opts.signed:
    return cloudfrontSigner.getSignedUrl({
      url:      `${base}/${path}`,
      keyPairId: env.CF_KEY_PAIR_ID,
      privateKey: env.CF_PRIVATE_KEY,
      dateLessThan: new Date(Date.now() + opts.ttlSec*1000)
    })
  return `${base}/${path}`
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

```text
CdnUrlOpts = {
  variant?: "original" | "thumb_256" | "thumb_1024",
  ttlSec?:  number,
  signed?:  boolean
}
```

**Error Handling**

- Throws `CDN_KEY_INVALID` synchronously when `key` contains `..`, leading `/`, or null bytes (path traversal guard).
- Signed-URL generation failure wrapped as `CDN_SIGN_FAIL`; falls back to unsigned URL only when `opts.signed` is `false`.
- Missing `CLOUDFRONT_BASE_URL` env var caught at boot via `@nestjs/config`.

---

### MOD-016 — `s3.softDeleteObject(key, retentionDays)` adapter op

- **Parent ARCH**: ARCH-007
- **Type**: Adapter Op

**Algorithmic / Logic**

```text
async function softDeleteObject(key, retentionDays = 30):
  await s3Client.send(new PutObjectTaggingCommand({
    Bucket: env.S3_INTAKE_BUCKET,
    Key:    key,
    Tagging: { TagSet: [
      { Key: "lifecycle",     Value: "soft-deleted" },
      { Key: "delete-after",  Value: addDays(today(), retentionDays).toISOString().slice(0,10) }
    ]}
  }))
  await db.update("digitization_jobs", { s3_key: key }, {
    state:        "soft_deleted",
    deleted_at:   now(),
    purge_after:  addDays(now(), retentionDays)
  })
  emit("storage.soft_deleted", { key, purge_after: addDays(now(), retentionDays) })
```

**State Machine**

`N/A — Stateless` at op scope. Drives `digitization_jobs.state: * → soft_deleted` and relies on the bucket lifecycle policy `SoftDeletedExpire(NDays=retentionDays)` for hard deletion.

**Internal Data Structures**

```text
SoftDeleteResult = void   # observable via emitted event "storage.soft_deleted"
```

**Error Handling**

| Condition                         | Code                      | Behaviour                              |
| --------------------------------- | ------------------------- | -------------------------------------- |
| `PutObjectTagging` fails          | `S3_TAG_FAIL`             | DB update skipped; retried by MOD-006  |
| Object already soft-deleted       | `S3_ALREADY_SOFT_DELETED` | idempotent no-op; success returned     |
| Bucket lifecycle policy missing   | `S3_LIFECYCLE_MISSING`    | startup smoke check fails health probe |
| `retentionDays` out of `[1, 365]` | `S3_RETENTION_RANGE`      | thrown synchronously                   |

---

> **MD-3a status**: MOD-009..MOD-016 complete (16/91).

---

### MOD-017 — `OcrJobDispatcher.send(jobId)`

- **Parent ARCH**: ARCH-008
- **Type**: Function

**Algorithmic / Logic**

```text
async function send(jobId):
  job = await db.select("digitization_jobs").where({ id: jobId }).first()
  if !job:                          throw new DispatchError("DISPATCH_JOB_MISSING", { jobId })
  if job.state != "uploaded":       throw new DispatchError("DISPATCH_BAD_STATE",   { jobId, state: job.state })
  msg = {
    job_id:    job.id,
    user_id:   job.user_id,
    s3_key:    job.s3_key,
    mime:      job.mime,
    enqueued_at: now()
  }
  await sqsClient.send(new SendMessageCommand({
    QueueUrl:               env.SQS_OCR_QUEUE_URL,
    MessageBody:            JSON.stringify(msg),
    MessageGroupId:         job.user_id,                # FIFO grouping per user (when FIFO)
    MessageDeduplicationId: job.id,                     # natural dedupe key
    MessageAttributes: {
      "job-id":     { DataType:"String", StringValue: job.id },
      "user-id":    { DataType:"String", StringValue: job.user_id },
      "trace-id":   { DataType:"String", StringValue: tracing.currentTraceId() }
    }
  }))
  await db.update("digitization_jobs", { id: jobId }, { state: "queued", queued_at: now() })
  emit("ocr.dispatched", { jobId, queued_at: now() })
```

**State Machine**

`N/A — Stateless` at function scope. Drives `digitization_jobs.state: uploaded → queued`.

**Internal Data Structures**

```text
SqsOcrMessage = {
  job_id: uuid, user_id: uuid, s3_key: string,
  mime: string, enqueued_at: ISO8601
}
```

**Error Handling**

| Condition                              | Code                   | Behaviour                                                          |
| -------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Job row missing                        | `DISPATCH_JOB_MISSING` | thrown synchronously; caller re-fetches                            |
| Job state != `uploaded`                | `DISPATCH_BAD_STATE`   | thrown; idempotency layer (MOD-085) treats as conflict             |
| SQS `SendMessage` fails (5xx/throttle) | `SQS_SEND_FAIL`        | retried by MOD-006 (3 attempts)                                    |
| DB update fails after SQS success      | `DISPATCH_DB_DRIFT`    | logged + reconciliation job rebuilds row state from queue receipts |

---

### MOD-018 — `concurrencyTokenBucket(userId)`

- **Parent ARCH**: ARCH-008
- **Type**: Function (factory returning a bucket handle)

**Algorithmic / Logic**

```text
const BUCKETS = new Map<userId, BucketState>()

function concurrencyTokenBucket(userId, capacity = 20, refillPerSec = 5):
  let state = BUCKETS.get(userId) ?? { tokens: capacity, lastRefill: now(), capacity, refillPerSec, queue: [] }
  BUCKETS.set(userId, state)
  return {
    async acquire(n = 1):
      refill(state)
      if state.tokens >= n: state.tokens -= n; return
      # wait in FIFO order
      return new Promise((resolve, reject) => {
        state.queue.push({ n, resolve, reject, enqueued: now() })
        scheduleDrain(state)
      })
    release(n = 1):
      state.tokens = min(state.capacity, state.tokens + n)
      drainQueue(state)
  }

function refill(state):
  elapsedSec = (now() - state.lastRefill) / 1000
  state.tokens = min(state.capacity, state.tokens + elapsedSec * state.refillPerSec)
  state.lastRefill = now()
```

**State Machine**

```text
bucket per user:  full → draining → empty → refilling → draining
queued waiter:    pending → granted ✓
                          → timeout ✗ (after WAIT_TIMEOUT_MS = 5000)
```

**Internal Data Structures**

```text
BucketState = {
  tokens: number, capacity: number, refillPerSec: number,
  lastRefill: epochMs,
  queue: Array<{ n:number, resolve:fn, reject:fn, enqueued:epochMs }>
}
```

**Error Handling**

- `acquire` rejects with `RATE_LIMIT_USER` after `WAIT_TIMEOUT_MS` to prevent unbounded queue growth.
- Process restarts reset all buckets; this is acceptable because RDS-side concurrency is enforced separately by ARCH-018 row-level locks.
- `BUCKETS` map is eviction-free; for very long-lived processes, a daily compaction job removes idle bucket entries (`tokens == capacity` and no queue for ≥1h).

---

### MOD-019 — `ocrWorker.handler(event)` Lambda entry

- **Parent ARCH**: ARCH-009
- **Type**: Handler (Lambda entry point with SQS event source)

**Algorithmic / Logic**

```text
export async function handler(event: SQSEvent, ctx: Context):
  const batchItemFailures = []
  for record in event.Records:
    try:
      msg = JSON.parse(record.body) as SqsOcrMessage
      await tracing.withSpan("ocr.process", async () => {                  # MOD-089
        await dispatchToProvider(msg)                                      # MOD-020
      }, { attributes: { "job_id": msg.job_id, "user_id": msg.user_id } })
    catch (err):
      classified = handleFailure(err)                                      # MOD-021
      if classified.retriable:
        batchItemFailures.push({ itemIdentifier: record.messageId })       # SQS partial-batch failure
      # terminal failures: row already marked `failed`; do NOT add to retries
  return { batchItemFailures }
```

**State Machine**

`N/A — Stateless` at handler scope. Each record drives `digitization_jobs.state: queued → processing → (done | failed)`.

**Internal Data Structures**

```text
SQSEvent.Records = Array<{
  messageId: string,
  body: string,                    # JSON-serialised SqsOcrMessage (MOD-017)
  attributes: { ApproximateReceiveCount: string, ... },
  messageAttributes: Record<string, { stringValue?: string, dataType: string }>
}>
HandlerResult = { batchItemFailures: Array<{ itemIdentifier: string }> }
```

**Error Handling**

| Condition                                               | Code                 | Behaviour                                                          |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| Body not JSON                                           | `OCR_MSG_PARSE`      | terminal; row → `failed`; not retried                              |
| Provider timeout                                        | `OCR_TIMEOUT`        | retriable; partial-batch failure → SQS visibility timeout requeues |
| Provider 5xx                                            | `OCR_PROVIDER_5XX`   | retriable up to `ApproximateReceiveCount <= 5`; then DLQ           |
| Provider 4xx (image unreadable)                         | `OCR_INPUT_INVALID`  | terminal; row → `failed`; surfaced to user                         |
| Lambda timeout (context.getRemainingTimeInMillis < 500) | `OCR_LAMBDA_TIMEOUT` | record left in flight; SQS retry on visibility expiry              |

---

### MOD-020 — `ocrWorker.dispatchToProvider(payload)`

- **Parent ARCH**: ARCH-009
- **Type**: Function

**Algorithmic / Logic**

```text
async function dispatchToProvider(payload: SqsOcrMessage):
  await db.update("digitization_jobs", { id: payload.job_id }, {
    state: "processing", processing_started_at: now()
  })
  signedUrl = s3.getCdnUrl(payload.s3_key, { signed: true, ttlSec: 600 })  # MOD-015
  raw = await withDeadline(
    () => provider.recognize({ image_url: signedUrl, mime: payload.mime, language: "auto" }),
    timeoutMs: env.OCR_TIMEOUT_MS ?? 30000
  )
  parsed = parseRawToFields(raw)                                           # MOD-026
  parsed = attachConfidences(parsed, raw)                                  # MOD-027
  await persistOcrPayload(payload.job_id, raw, parsed)                     # MOD-028
  await db.update("digitization_jobs", { id: payload.job_id }, {
    state: "done", processing_completed_at: now()
  })
  emit("ocr.done", { job_id: payload.job_id, fields: Object.keys(parsed) })
```

**State Machine**

`N/A — Stateless`. Drives `digitization_jobs.state: queued → processing → done`.

**Internal Data Structures**

`SqsOcrMessage` (from MOD-017); `OcrRawResult` and `ParsedRecipe` (from MOD-023, MOD-026).

**Error Handling**

- Wraps provider call in `withDeadline` to enforce hard timeout independent of vendor SDK behaviour.
- All thrown errors propagate to MOD-019; classification happens there (single classification site, easier auditing).
- If `persistOcrPayload` throws after a successful `recognize`, `db.update("processing")` is rolled back via `db.transaction` started in MOD-028, leaving the row recoverable.

---

### MOD-021 — `ocrWorker.handleFailure(err)`

- **Parent ARCH**: ARCH-009
- **Type**: Function

**Algorithmic / Logic**

```text
function handleFailure(err):
  code = err.code ?? inferCode(err)
  retriable = RETRIABLE_CODES.has(code)
  context = { code, message: err.message, jobId: err.jobId }
  logger.error("ocr.failure", context)
  Sentry.captureException(err, { tags: { ocr_code: code, retriable } })
  if !retriable && err.jobId:
    # terminal: mark row failed in fire-and-forget so SQS still acks the message
    db.update("digitization_jobs", { id: err.jobId }, {
      state: "failed",
      failed_at: now(),
      failure_code: code,
      failure_message: redactPII(err.message)
    }).catch(e => logger.error("ocr.failure.persist", { e }))
  return { retriable, code }

constants:
  RETRIABLE_CODES = new Set([
    "OCR_TIMEOUT","OCR_PROVIDER_5XX","NETWORK","SQS_SEND_FAIL","S3_OP_FAIL"
  ])
```

**State Machine**

`N/A — Stateless`. Drives `digitization_jobs.state: * → failed` for terminal errors.

**Internal Data Structures**

```text
FailureClassification = { retriable: boolean, code: string }
```

**Error Handling**

- This module _is_ the error handler — it never throws. Any exception in its own body is swallowed and logged to prevent recursive failure loops.
- `redactPII` ensures vendor error messages (which sometimes echo user filenames or URLs) never reach the DB.

---

### MOD-022 — `OcrProvider` interface (`@kitchensink/digitization-ocr`)

- **Parent ARCH**: ARCH-010
- **Type**: Public API (TypeScript interface in shared package)

**Algorithmic / Logic**

```text
export interface OcrProvider:
  readonly name:            string                 # e.g. "aws-textract", "google-document-ai"
  readonly version:         string                 # SemVer of the adapter, not the vendor SDK

  recognize(input: OcrInput, opts?: OcrOptions): Promise<OcrRawResult>
  healthCheck(): Promise<{ ok: boolean, latencyMs: number, details?: string }>

export interface OcrInput:
  image_url:    string                              # signed CDN URL (CDN-fronted S3)
  mime:         "image/jpeg" | "image/png" | "image/heic"
  language?:    "auto" | "en" | "es" | "fr" | string
  hints?:       { is_recipe?: boolean, expect_columns?: number }

export interface OcrOptions:
  timeoutMs?:   number                              # provider-side timeout, default 30000
  abort?:       AbortSignal
```

**State Machine**

`N/A — Stateless` (interface contract).

**Internal Data Structures**

Defined inline above (`OcrInput`, `OcrOptions`).

**Error Handling**

- Implementations MUST throw `OcrError` (MOD-023) — never raw vendor errors. Adapter modules (MOD-024..025) bear translation responsibility.
- `healthCheck()` MUST resolve within 5 s; longer is treated by callers as `degraded`.
- Interface stability: breaking changes require SemVer major bump; `OcrError.code` additions are non-breaking, removals are breaking.

---

### MOD-023 — `OcrRawResult` + `OcrError` types

- **Parent ARCH**: ARCH-010
- **Type**: Public API (shared DTOs)

**Algorithmic / Logic**

```text
export interface OcrRawResult:
  blocks: Array<{
    text:           string,
    confidence:     number,                # 0..1
    bbox:           { x:number, y:number, w:number, h:number },
    line_index:     number,
    block_type:     "title" | "ingredient" | "step" | "metadata" | "unknown"
  }>
  language:         string                 # detected; "und" if unknown
  page:             { width:number, height:number }
  raw_provider_id:  string                 # vendor-specific job/document id (forensic)

export class OcrError extends Error:
  static CODES = [
    "OCR_TIMEOUT","OCR_PROVIDER_5XX","OCR_PROVIDER_4XX","OCR_INPUT_INVALID",
    "OCR_AUTH","OCR_QUOTA","OCR_NETWORK","OCR_UNKNOWN"
  ]
  constructor(code, message, opts = { cause, retriable, jobId, vendor }):
    super(message); this.code = code
    this.retriable = opts.retriable ?? RETRIABLE_DEFAULTS[code]
    this.jobId     = opts.jobId
    this.vendor    = opts.vendor                 # adapter `name` field
    if opts.cause: this.cause = opts.cause
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

Defined inline above (`OcrRawResult`, `OcrError`).

**Error Handling**

- DTOs are inert; only `OcrError` constructor can throw, and only if `code` is not in `OcrError.CODES` (caught by adapter unit tests).
- `RETRIABLE_DEFAULTS` is exported as a frozen object so consumers can override per call but cannot mutate the shared map.

---

### MOD-024 — `DefaultOcrProviderAdapter.recognize(input)`

- **Parent ARCH**: ARCH-011
- **Type**: Adapter Op

**Algorithmic / Logic**

```text
class DefaultOcrProviderAdapter implements OcrProvider:
  name = "default-ocr-v1"
  version = "1.0.0"

  async recognize(input, opts = {}):
    abort = opts.abort ?? new AbortController().signal
    timeoutMs = opts.timeoutMs ?? 30000
    try:
      vendorReq = {
        Document: { S3Object: parseS3Url(input.image_url) },
        FeatureTypes: ["FORMS","TABLES"],
        ClientRequestToken: input.hints?.client_request_token
      }
      vendorResp = await withDeadline(
        () => vendorClient.analyzeDocument(vendorReq, { abortSignal: abort }),
        timeoutMs
      )
      return mapVendorResponse(vendorResp, { language: input.language ?? "auto" })
    catch (err):
      throw mapVendorError(err, { jobId: input.hints?.job_id })       # MOD-025

  async healthCheck():
    t0 = now()
    try:
      await vendorClient.describeService()
      return { ok: true, latencyMs: now() - t0 }
    catch (e):
      return { ok: false, latencyMs: now() - t0, details: e.message }
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

`OcrInput`, `OcrOptions`, `OcrRawResult` (from MOD-022/023).

**Error Handling**

- All vendor exceptions funnel through MOD-025; this module never throws raw vendor errors.
- `withDeadline` translates timer expiry into `OcrError("OCR_TIMEOUT", ...)` so SQS retries kick in upstream.
- `parseS3Url` validates that `input.image_url` resolves to a bucket the adapter is configured to read; mismatches throw `OcrError("OCR_INPUT_INVALID", ..., { retriable:false })`.

---

### MOD-025 — `DefaultOcrProviderAdapter.mapVendorError(err)`

- **Parent ARCH**: ARCH-011
- **Type**: Function

**Algorithmic / Logic**

```text
function mapVendorError(err, ctx = { jobId, vendor: "default-ocr-v1" }):
  if err.name == "AbortError" or err.code == "RequestTimeout":
    return new OcrError("OCR_TIMEOUT", err.message, { cause:err, retriable:true, ...ctx })
  if err.$metadata?.httpStatusCode >= 500:
    return new OcrError("OCR_PROVIDER_5XX", err.message, { cause:err, retriable:true, ...ctx })
  switch err.name:
    case "ThrottlingException":
    case "ProvisionedThroughputExceededException":
      return new OcrError("OCR_QUOTA", err.message, { cause:err, retriable:true, ...ctx })
    case "AccessDeniedException":
    case "UnrecognizedClientException":
      return new OcrError("OCR_AUTH", err.message, { cause:err, retriable:false, ...ctx })
    case "InvalidS3ObjectException":
    case "InvalidParameterException":
    case "DocumentTooLargeException":
      return new OcrError("OCR_INPUT_INVALID", err.message, { cause:err, retriable:false, ...ctx })
    case "NetworkingError":
      return new OcrError("OCR_NETWORK", err.message, { cause:err, retriable:true, ...ctx })
  if err.$metadata?.httpStatusCode >= 400:
    return new OcrError("OCR_PROVIDER_4XX", err.message, { cause:err, retriable:false, ...ctx })
  return new OcrError("OCR_UNKNOWN", err.message ?? "unknown vendor error",
                      { cause:err, retriable:false, ...ctx })
```

**State Machine**

`N/A — Stateless`.

**Internal Data Structures**

Reuses `OcrError` (MOD-023). No internal state.

**Error Handling**

- Pure function: never throws; always returns an `OcrError`.
- `OCR_UNKNOWN` is the safety net so MOD-021 (`ocrWorker.handleFailure`) can still classify the failure.
- All branches preserve `cause` for Sentry stack reconstruction (REQ aligned with `architecture-design.md` ARCH-011 error-mapping contract).

---

### MOD-026 — `parseRawToFields(raw)`

- **Parent ARCH**: ARCH-012
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function parseRawToFields(raw: OcrRawResult): ParsedRecipe:
  blocks = raw.blocks.filter(b => b.text.trim().length > 0)

  title       = pickTitle(blocks)
  ingredients = pickByType(blocks, "ingredient")
                  .map(toIngredientLine)
                  .filter(nonEmpty)
  steps       = pickByType(blocks, "step")
                  .sort(by line_index ascending)
                  .map(b => ({ text: normalizeWhitespace(b.text) }))
  metadata    = pickByType(blocks, "metadata")

  return {
    title,
    ingredients,
    steps,
    yield:     extractYield(metadata),       # nullable
    prep_time: extractDuration(metadata, "prep"),  # ISO-8601 minutes, nullable
    cook_time: extractDuration(metadata, "cook"),
    language:  raw.language
  }

function pickTitle(blocks):
  candidates = blocks.filter(b => b.block_type == "title")
  if candidates.length > 0:
    return normalizeWhitespace(candidates[0].text)
  # fallback: largest-area block on first page-third
  topThird = blocks.filter(b => b.bbox.y < raw.page.height / 3)
  if topThird.length > 0:
    biggest = topThird.maxBy(b => b.bbox.w * b.bbox.h)
    return normalizeWhitespace(biggest.text)
  return null
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

`ParsedRecipe` (consumed by MOD-027/028/030/032/039); `IngredientLine = { quantity?, unit?, item, raw }`.

**Error Handling**

- Function never throws on missing fields; absent values become `null` so the correction screen (MOD-034/036) can prompt the user.
- Block-type heuristics are isolated in helpers so vendor-specific tagging changes don't ripple beyond MOD-026.

---

### MOD-027 — `attachConfidences(parsed, raw)`

- **Parent ARCH**: ARCH-012
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function attachConfidences(parsed, raw):
  byText = indexBlocksByNormalizedText(raw.blocks)

  decorate = (value) =>
    if value == null: return { value: null, confidence: 0 }
    match = byText.lookup(normalizeWhitespace(value))
    return { value, confidence: match?.confidence ?? 0 }

  return {
    title:       decorate(parsed.title),
    ingredients: parsed.ingredients.map(line => ({
                   ...line,
                   confidence: byText.lookup(normalizeWhitespace(line.raw))?.confidence ?? 0
                 })),
    steps:       parsed.steps.map(step => ({
                   ...step,
                   confidence: byText.lookup(normalizeWhitespace(step.text))?.confidence ?? 0
                 })),
    yield:       decorate(parsed.yield),
    prep_time:   decorate(parsed.prep_time),
    cook_time:   decorate(parsed.cook_time),
    language:    { value: parsed.language, confidence: raw.language == "und" ? 0 : 1 }
  }
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

`ConfidenceIndex` (in-memory `Map<normalizedText, block>`); `DecoratedField = { value, confidence:0..1 }`.

**Error Handling**

- Missing matches degrade to `confidence: 0` rather than throwing — the correction UI uses `confidence < threshold` to highlight fields.
- Normalisation is centralised in `normalizeWhitespace` so MOD-026/027/032 stay consistent.

---

### MOD-028 — `persistOcrPayload(jobId, raw, parsed)`

- **Parent ARCH**: ARCH-013
- **Type**: Function

**Algorithmic / Logic**

```text
async function persistOcrPayload(jobId, raw, parsed):
  return await db.transaction(async tx =>
    row = await tx.update(ocrJobs)
            .set({
              raw_ocr_json:     raw,
              parsed_json:      parsed,
              parsed_at:        now(),
              raw_purge_after:  now() + INTERVAL '90 days',
              state:            "parsed"
            })
            .where(eq(ocrJobs.id, jobId)
                   and eq(ocrJobs.state, "running"))
            .returning({ id: ocrJobs.id, version: ocrJobs.version })

    if row == null:
      throw new OcrError("OCR_STATE_CONFLICT",
                         `job ${jobId} not in 'running' state`,
                         { retriable:false })

    await tx.insert(ocrEvents).values({
      job_id:     jobId,
      event_type: "parsed",
      payload:    { block_count: raw.blocks.length },
      created_at: now()
    })
    return row
  )
```

**State Machine**

`running → parsed` (single transition; idempotent because guard requires `state='running'`).

**Internal Data Structures**

Drizzle ORM update payload; `ocrEvents` insert row.

**Error Handling**

- `OCR_STATE_CONFLICT` short-circuits double-processing from SQS redelivery.
- Transaction guarantees `raw_ocr_json`, `parsed_json`, and lifecycle event land atomically (ARCH-013/ARCH-039 contract).
- Postgres errors propagate; MOD-021 maps them to `failed` with `retriable=true` for serialization failures.

---

### MOD-029 — `enforceRawRetention(jobId)`

- **Parent ARCH**: ARCH-013, ARCH-033
- **Type**: Function (scheduled)

**Algorithmic / Logic**

```text
async function enforceRawRetention(jobId = null):
  predicate = jobId
    ? and(eq(ocrJobs.id, jobId), lt(ocrJobs.raw_purge_after, now()))
    : lt(ocrJobs.raw_purge_after, now())

  return await db.transaction(async tx =>
    purged = await tx.update(ocrJobs)
              .set({ raw_ocr_json: null, raw_purged_at: now() })
              .where(and(predicate, isNotNull(ocrJobs.raw_ocr_json)))
              .returning({ id: ocrJobs.id })

    for row in purged:
      await tx.insert(ocrEvents).values({
        job_id:     row.id,
        event_type: "raw_purged",
        payload:    { reason: "retention_90d" },
        created_at: now()
      })
    return { purged_count: purged.length }
  )
```

**State Machine**

`N/A — operates on row data; lifecycle state untouched`.

**Internal Data Structures**

Scheduled invocation context: `{ jobId?: string }`. Returns `{ purged_count }`.

**Error Handling**

- Idempotent: `isNotNull(raw_ocr_json)` guard ensures repeated runs are no-ops.
- Per-row purge errors do not abort the batch; they bubble for MOD-021/Sentry but `parsed_json` always survives (ARCH-033 lifetime contract).
- Invariant verified by MD-4 acceptance test: `parsed_json IS NOT NULL` after purge.

---

### MOD-030 — `GET /jobs/:id/correction` handler

- **Parent ARCH**: ARCH-014
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function getCorrection(req, res):
  jobId  = req.params.id
  userId = req.auth.userId

  job = await ocrJobsRepo.findOwnedBy(jobId, userId)
  if job == null:
    return res.status(404).json({ error: "JOB_NOT_FOUND" })

  if job.state in ["queued","running"]:
    return res.status(409).json({ error: "JOB_NOT_READY", state: job.state })

  view = projectToCorrectionView(job)        # MOD-027 output + accepted_at map
  return res.status(200).json(view)
```

**State Machine**

`N/A — Read-only handler`.

**Internal Data Structures**

`CorrectionView = { jobId, image_url, fields: DecoratedField{}, accepted_at: { [path]: ISOString } }`.

**Error Handling**

- 404 for missing or non-owned jobs (ownership check inside repo).
- 409 when job has not yet reached `parsed`/`corrected`.
- 5xx surfaces via the global error filter; handler stays thin.

---

### MOD-031 — `PATCH /jobs/:id/correction` handler

- **Parent ARCH**: ARCH-014
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function patchCorrection(req, res):
  jobId  = req.params.id
  userId = req.auth.userId
  patch  = req.body                        # { path: value, ... }

  validatePatchPaths(patch)                # whitelist: title, ingredients[*], steps[*], yield, prep_time, cook_time

  await db.transaction(async tx =>
    job = await tx.select().from(ocrJobs)
            .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.owner_id, userId)))
            .forUpdate()
            .first()

    if job == null:           throw httpError(404, "JOB_NOT_FOUND")
    if job.state == "saved":  throw httpError(409, "JOB_FROZEN")

    merged = mergeCorrectionPatch(job.parsed_json, patch)   # MOD-032

    await tx.update(ocrJobs)
            .set({
              parsed_json: merged.parsed,
              accepted_at: merged.accepted_at,
              state:       "corrected",
              updated_at:  now()
            })
            .where(eq(ocrJobs.id, jobId))

    await tx.insert(ocrEvents).values({
      job_id:     jobId,
      event_type: "correction_patched",
      payload:    { paths: Object.keys(patch) },
      created_at: now()
    })
  )

  return res.status(200).json({ ok: true })
```

**State Machine**

`parsed → corrected` (idempotent; subsequent patches stay in `corrected`).

**Internal Data Structures**

Patch envelope `{ [path]: value }` with whitelist enforcement; `accepted_at: Map<path, ISOString>`.

**Error Handling**

- `validatePatchPaths` throws 400 for unknown fields (defence-in-depth vs JSON injection).
- `forUpdate()` row-lock prevents concurrent PATCH races (REQ-OCR-CORRECT).
- 409 `JOB_FROZEN` when correction arrives after the job has been saved into `recipes`.
- All Postgres errors funnel through global filter; correction events always recorded inside the same TX.

---

### MOD-032 — `mergeCorrectionPatch(parsed, patch)`

- **Parent ARCH**: ARCH-014
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function mergeCorrectionPatch(parsed, patch):
  next        = deepClone(parsed)
  acceptedAt  = {}
  ts          = now()

  for path, value in patch:
    setByJsonPath(next, path, value)
    acceptedAt[path] = ts

  # collapse empty ingredient/step entries
  next.ingredients = next.ingredients.filter(line => line.item?.trim().length > 0)
  next.steps       = next.steps.filter(step => step.text?.trim().length > 0)

  return { parsed: next, accepted_at: acceptedAt }
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

JSON-path accessor (`title`, `ingredients[i].item`, `steps[i].text`, `yield`, `prep_time`, `cook_time`); `accepted_at: { [path]: ISOString }`.

**Error Handling**

- Pure: throws only for invalid paths (caught upstream by MOD-031 validation).
- Deterministic for replay tests; same `(parsed, patch)` always yields same `(next, accepted_at)` modulo `ts` (injected for testability in MD-4 unit tests).

---

### MOD-033 — `evaluateAcceptAllEligibility(parsed, accepted)`

- **Parent ARCH**: ARCH-015
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function evaluateAcceptAllEligibility(parsed, accepted):
  REQUIRED_PATHS = ["title", "ingredients", "steps"]
  missing = []

  if !parsed.title?.value or parsed.title.value.trim() == "":
    missing.push("title")
  if !parsed.ingredients or parsed.ingredients.length == 0:
    missing.push("ingredients")
  if !parsed.steps or parsed.steps.length == 0:
    missing.push("steps")

  # confidence-gate: any required field below 0.5 must be explicitly accepted
  LOW_CONF = 0.5
  for path in REQUIRED_PATHS:
    field = parsed[path]
    if isLowConfidence(field, LOW_CONF) and !accepted[path]:
      missing.push(`${path}:requires_review`)

  return { eligible: missing.length == 0, missing }

function isLowConfidence(field, threshold):
  if Array.isArray(field):
    return field.some(item => (item.confidence ?? 0) < threshold)
  return (field?.confidence ?? 0) < threshold
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

`AcceptAllResult = { eligible:boolean, missing:string[] }`.

**Error Handling**

- Returns structured `missing[]` rather than throwing; the UI (MOD-034/036) renders inline guidance.
- `LOW_CONF` threshold is a single named constant so MD-4 acceptance tests can pin it.

---

### MOD-034 — `CorrectionScreen` web component

- **Parent ARCH**: ARCH-016
- **Type**: UI Component (React, web)

**Algorithmic / Logic**

```text
function CorrectionScreen({ jobId }):
  { data, isLoading, error } = useQuery(["correction", jobId], fetchCorrection)
  form                       = useCorrectionForm(data)            # MOD-035
  saveBridge                 = useSaveBridge(jobId)               # wraps MOD-038

  if isLoading: return <Skeleton />
  if error:     return <ErrorState onRetry={...} />

  acceptAll = evaluateAcceptAllEligibility(form.values, form.acceptedPaths)

  return (
    <Layout split>
      <PhotoPane src={data.image_url} highlightField={form.activePath} />
      <FieldsPane>
        <TitleField        {...form.bind("title")} />
        <IngredientList    {...form.bind("ingredients")} />
        <StepList          {...form.bind("steps")} />
        <MetadataRow       {...form.bind(["yield","prep_time","cook_time"])} />
        <AcceptAllButton
          disabled={!acceptAll.eligible}
          missing={acceptAll.missing}
          onClick={() => saveBridge.save(form.values)}
        />
      </FieldsPane>
    </Layout>
  )
```

**State Machine**

UI state: `loading → ready → dirty → saving → saved` (drives button + toast affordances).

**Internal Data Structures**

`CorrectionView` (from MOD-030); `form` from MOD-035; `acceptAll` from MOD-033.

**Error Handling**

- `<ErrorState>` retries via TanStack Query; 409 `JOB_NOT_READY` surfaces a "still processing" message.
- `AcceptAllButton` is disabled with a tooltip listing `missing[]` instead of throwing on click.
- Photo-field highlight is decorative — failures degrade silently to the plain editor.
- a11y: every editable field has `aria-label`, low-confidence fields get `aria-describedby` pointing at the warning hint (WCAG 2.1 AA per `architecture-design.md` Cross-Cutting view).

---

### MOD-035 — `useCorrectionForm` web hook

- **Parent ARCH**: ARCH-016
- **Type**: Function (React hook)

**Algorithmic / Logic**

```text
function useCorrectionForm(initial):
  [values, setValues]   = useState(initial?.fields ?? EMPTY)
  [accepted, setAcc]    = useState({})
  [activePath, setPath] = useState(null)
  patchQueue            = useRef([])
  flushDebounced        = useDebouncedCallback(flushPatches, 400)

  bind = (path) => ({
    value:    getByJsonPath(values, path),
    onChange: (next) =>
      setValues(prev => setByJsonPath(prev, path, next))
      patchQueue.current.push({ path, value: next })
      flushDebounced()
    ,
    onFocus:  () => setPath(path),
    onAccept: () => setAcc(prev => ({ ...prev, [path]: now() }))
  })

  flushPatches = async () =>
    if patchQueue.current.length == 0: return
    batch = patchQueue.current.splice(0)
    delta = collapsePaths(batch)                # last-write-wins per path
    await api.patchCorrection(jobId, delta)     # MOD-031

  return { values, acceptedPaths: accepted, activePath, bind }
```

**State Machine**

Internal: `idle → dirty → flushing → idle`; transitions on input + debounce expiry.

**Internal Data Structures**

`PatchQueue: Array<{path,value}>`; `acceptedPaths: Map<path, ISOString>`.

**Error Handling**

- Failed PATCH calls re-queue the delta and surface a non-blocking toast; UI stays editable.
- `collapsePaths` ensures network usage stays O(unique-paths) rather than O(keystrokes).
- Debounce is configurable via prop for MD-4 unit tests.

---

### MOD-036 — `CorrectionScreen` mobile component

- **Parent ARCH**: ARCH-017
- **Type**: UI Component (React Native / Expo)

**Algorithmic / Logic**

```text
function CorrectionScreen({ jobId }):
  query        = useCorrectionQuery(jobId)
  form         = useCorrectionFormNative(query.data)              # MOD-037
  saveBridge   = useSaveBridgeNative(jobId)
  { keyboard } = useKeyboardAvoiding()

  if query.isLoading: return <Skeleton />
  if query.error:     return <ErrorBanner onRetry={query.refetch} />

  return (
    <KeyboardAvoidingView behavior={keyboard.behavior}>
      <SegmentedTabs tabs={["Photo","Fields"]} >
        <Tab.Photo  src={query.data.image_url} highlightField={form.activePath} />
        <Tab.Fields>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TitleField     {...form.bind("title")} />
            <IngredientList {...form.bind("ingredients")} />
            <StepList       {...form.bind("steps")} />
            <MetadataRow    {...form.bind(["yield","prep_time","cook_time"])} />
            <AcceptAllButton
              eligibility={evaluateAcceptAllEligibility(form.values, form.acceptedPaths)}
              onPress={() => saveBridge.save(form.values)}
            />
          </ScrollView>
        </Tab.Fields>
      </SegmentedTabs>
    </KeyboardAvoidingView>
  )
```

**State Machine**

Mirrors MOD-034 (`loading → ready → dirty → saving → saved`).

**Internal Data Structures**

Same as MOD-034; tab state owned by `<SegmentedTabs>`.

**Error Handling**

- `<ErrorBanner>` mirrors web `<ErrorState>` UX language for cross-platform consistency.
- `KeyboardAvoidingView` failure (older OS bug) degrades to `ScrollView` only; correction still functional.
- a11y: VoiceOver labels mirror MOD-034 `aria-label` strings; haptic feedback on accept-all (per ARCH-017).

---

### MOD-037 — `useCorrectionFormNative` hook

- **Parent ARCH**: ARCH-017
- **Type**: Function (React Native hook)

**Algorithmic / Logic**

```text
function useCorrectionFormNative(initial):
  shared = useCorrectionForm(initial)         # MOD-035 (shared logic)

  # mobile-only: persist drafts to expo-secure-store on backgrounding
  useEffect(() =>
    sub = AppState.addEventListener("change", state =>
      if state == "background":
        SecureStore.setItemAsync(`draft:${initial.jobId}`,
                                 JSON.stringify(shared.values))
    )
    return () => sub.remove()
  , [shared.values])

  # restore on mount when offline
  useEffect(() =>
    if NetInfo.isOffline():
      SecureStore.getItemAsync(`draft:${initial.jobId}`).then(json =>
        if json: shared.hydrateFromDraft(JSON.parse(json))
      )
  , [])

  return shared
```

**State Machine**

Inherits `useCorrectionForm` states + `restoring` substate during offline boot.

**Internal Data Structures**

`SecureStore` key namespace `draft:{jobId}` (encrypted at rest by OS keystore — REQ-PRIVACY).

**Error Handling**

- SecureStore write failures swallow + log via `@aws-lambda-powertools/logger`-equivalent mobile logger; user is never blocked.
- Offline draft restore is best-effort; if hydration fails, form starts empty and last server state still loads when network returns.

---

### MOD-038 — `POST /jobs/:id/save` handler

- **Parent ARCH**: ARCH-018
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function saveJob(req, res):
  jobId  = req.params.id
  userId = req.auth.userId

  return await db.transaction(async tx =>
    job = await tx.select().from(ocrJobs)
            .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.owner_id, userId)))
            .forUpdate()
            .first()

    if job == null:                throw httpError(404, "JOB_NOT_FOUND")
    if job.state == "saved":       return res.status(200).json({ recipe_id: job.recipe_id })
    if job.state not in ["parsed","corrected"]:
      throw httpError(409, "JOB_NOT_SAVABLE", { state: job.state })

    eligibility = evaluateAcceptAllEligibility(job.parsed_json, job.accepted_at ?? {})
    if !eligibility.eligible:
      throw httpError(422, "JOB_INCOMPLETE", { missing: eligibility.missing })

    payload  = buildRecipeFromParsed(job.parsed_json, userId)     # MOD-039
    [recipe] = await tx.insert(recipes).values(payload).returning({ id: recipes.id })

    await tx.update(ocrJobs)
            .set({ state: "saved", recipe_id: recipe.id, saved_at: now() })
            .where(eq(ocrJobs.id, jobId))

    await tx.insert(outboxEvents).values({
      aggregate_id: recipe.id,
      event_type:   "recipe.created_from_ocr",
      payload:      { jobId, recipeId: recipe.id, ownerId: userId },
      created_at:   now()
    })

    return res.status(201).json({ recipe_id: recipe.id })
  )
```

**State Machine**

`parsed | corrected → saved` (idempotent: re-POST returns existing `recipe_id`).

**Internal Data Structures**

`outboxEvents` insert payload (consumed by ARCH-021 dispatcher).

**Error Handling**

- 404/409/422 are user-correctable and never trigger Sentry alerts (filtered upstream).
- Single transaction guarantees `recipes` row + outbox event are atomic — required for downstream `recipe.created_from_ocr` consumers.
- Idempotency relies on the `state == "saved"` short-circuit: safe under client retry.

---

### MOD-039 — `buildRecipeFromParsed(parsed, ownerId)`

- **Parent ARCH**: ARCH-018
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function buildRecipeFromParsed(parsed, ownerId):
  return {
    owner_id:    ownerId,
    title:       parsed.title.value.trim(),
    ingredients: parsed.ingredients.map(line => ({
                   quantity: line.quantity ?? null,
                   unit:     line.unit ?? null,
                   item:     line.item.trim(),
                   raw:      line.raw
                 })),
    steps:       parsed.steps.map((s, idx) => ({
                   order: idx + 1,
                   text:  s.text.trim()
                 })),
    yield:       parsed.yield?.value ?? null,
    prep_time:   parsed.prep_time?.value ?? null,
    cook_time:   parsed.cook_time?.value ?? null,
    language:    parsed.language?.value ?? "und",
    source:      "ocr",
    created_at:  now(),
    updated_at:  now()
  }
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

`RecipeInsertPayload` matching Drizzle schema for `recipes` table.

**Error Handling**

- Pure: assumes MOD-038 already ran MOD-033 eligibility, so required fields are present.
- Defensive `?.` chains keep the function total even if the upstream guard regresses; null fields surface in DB constraints rather than silent corruption.

---

### MOD-040 — `GET /jobs/:id` handler

- **Parent ARCH**: ARCH-019
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function getJob(req, res):
  jobId  = req.params.id
  userId = req.auth.userId

  job = await ocrJobsRepo.findOwnedBy(jobId, userId)
  if job == null: return res.status(404).json({ error: "JOB_NOT_FOUND" })

  lastEvent = await ocrEventsRepo.lastFor(jobId)

  return res.status(200).json({
    id:               job.id,
    state:            job.state,                   # queued|running|parsed|corrected|saved|failed|cancelled
    batch_id:         job.batch_id,
    recipe_id:        job.recipe_id ?? null,
    image_url:        job.image_url,
    created_at:       job.created_at,
    updated_at:       job.updated_at,
    last_event:       lastEvent && {
                        type: lastEvent.event_type,
                        at:   lastEvent.created_at
                      },
    failure_reason:   job.failure_reason ?? null
  })
```

**State Machine**

`N/A — Read-only handler`.

**Internal Data Structures**

`JobView` DTO consumed by web/mobile job list + detail screens.

**Error Handling**

- 404 for missing/non-owned jobs (ownership enforced at repo).
- `last_event` is best-effort; null when ledger query fails — UI degrades to `updated_at`.
- All response timestamps emitted as ISO-8601 UTC for cross-platform parsing parity.

---

### MOD-041 — `DELETE /jobs/:id` handler

- **Parent ARCH**: ARCH-019
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function cancelJob(req, res):
  jobId  = req.params.id
  userId = req.auth.userId

  return await db.transaction(async tx =>
    job = await tx.select().from(ocrJobs)
            .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.owner_id, userId)))
            .forUpdate()
            .first()

    if job == null:                  throw httpError(404, "JOB_NOT_FOUND")
    if job.state == "cancelled":     return res.status(204).end()         # idempotent
    if job.state in ["saved"]:       throw httpError(409, "JOB_FROZEN")

    await tx.update(ocrJobs)
            .set({ state: "cancelled", cancelled_at: now(), updated_at: now() })
            .where(eq(ocrJobs.id, jobId))

    await tx.insert(ocrEvents).values({
      job_id:     jobId,
      event_type: "cancelled",
      payload:    { actor_id: userId, prior_state: job.state },
      created_at: now()
    })

    return res.status(204).end()
  )
```

**State Machine**

`queued | running | parsed | corrected | failed → cancelled` (idempotent at `cancelled`).

**Internal Data Structures**

`ocrEvents` insert payload (audit ledger).

**Error Handling**

- 404 + 409 are user-correctable; not alerted.
- In-flight worker invocations honour cancellation lazily via MOD-019 state check before vendor call (REQ-OCR-CANCEL).
- Cancelled jobs retain `parsed_json` until retention purge; the audit row is never deleted.

---

### MOD-042 — `GET /jobs` handler

- **Parent ARCH**: ARCH-020
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function listJobs(req, res):
  userId   = req.auth.userId
  state    = req.query.state          # optional, validated against enum
  batchId  = req.query.batch_id       # optional UUID
  cursor   = parseCursor(req.query.cursor)   # opaque {created_at, id}
  limit    = clamp(req.query.limit ?? 20, 1, 100)

  rows = await ocrJobsRepo.listOwned({
    ownerId: userId,
    state,
    batchId,
    cursorBefore: cursor,
    limit: limit + 1                  # fetch +1 to detect next page
  })

  hasMore = rows.length > limit
  page    = rows.slice(0, limit)

  return res.status(200).json({
    items: JobListProjection.toView(page),    # MOD-043
    next_cursor: hasMore ? makeCursor(page.at(-1)) : null
  })
```

**State Machine**

`N/A — Read-only handler`.

**Internal Data Structures**

`Cursor = { created_at: ISOString, id: UUID }` encoded base64url; `JobListResponse = { items, next_cursor }`.

**Error Handling**

- Invalid `state` returns 400 (enum validation in DTO).
- Invalid cursor returns 400 with reset hint instead of leaking decode errors.
- `limit` clamped server-side to bound DB scan; never throws on absurd values.

---

### MOD-043 — `JobListProjection.toView(rows)`

- **Parent ARCH**: ARCH-020
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function toView(rows):
  return rows.map(r => ({
    id:                r.id,
    state:             r.state,
    batch_id:          r.batch_id,
    title_preview:     r.parsed_json?.title?.value?.slice(0, 80) ?? null,
    image_thumb_url:   buildThumbUrl(r.image_url),       # signed CDN url
    confidence_avg:    summarizeConfidence(r.parsed_json),  # 0..1, null if not parsed
    created_at:        r.created_at,
    updated_at:        r.updated_at,
    failure_reason:    r.failure_reason ?? null
  }))

function summarizeConfidence(parsed):
  if !parsed: return null
  vals = []
  if parsed.title?.confidence != null: vals.push(parsed.title.confidence)
  for line in parsed.ingredients ?? []:
    if line.confidence != null: vals.push(line.confidence)
  for step in parsed.steps ?? []:
    if step.confidence != null: vals.push(step.confidence)
  return vals.length == 0 ? null : avg(vals)
```

**State Machine**

`N/A — Pure function`.

**Internal Data Structures**

`JobListItemView` (consumed by web/mobile job-list screens); `confidence_avg ∈ [0,1] | null`.

**Error Handling**

- Pure: never throws; missing fields collapse to `null` so the list never blanks out.
- `buildThumbUrl` failures return the original `image_url`; UI handles thumb load errors.

---

### MOD-044 — `POST /circles` handler

- **Parent ARCH**: ARCH-021
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function createCircle(req, res):
  userId = req.auth.userId
  { name, description } = validateCreateCircleDto(req.body)

  return await db.transaction(async tx =>
    [circle] = await tx.insert(circles).values({
                  owner_id:    userId,
                  name,
                  description: description ?? null,
                  created_at:  now(),
                  updated_at:  now()
                }).returning({ id: circles.id })

    await tx.insert(circleMembers).values({
      circle_id:  circle.id,
      user_id:    userId,
      role:       "owner",
      joined_at:  now()
    })

    appendCircleAuditEntry({                # MOD-052
      circle_id:  circle.id,
      actor_id:   userId,
      action:     "circle.created",
      payload:    { name }
    }, tx)

    await tx.insert(outboxEvents).values({
      aggregate_id: circle.id,
      event_type:   "circle.created",
      payload:      { circleId: circle.id, ownerId: userId },
      created_at:   now()
    })

    return res.status(201).json({ id: circle.id })
  )
```

**State Machine**

Creates aggregate in `active` state; no transitions in this handler.

**Internal Data Structures**

`CreateCircleDto = { name:string, description?:string }`; outbox event payload.

**Error Handling**

- 400 from DTO validation (name length, profanity filter — handled in `validateCreateCircleDto`).
- Postgres unique constraint on `(owner_id, name)` → 409 `CIRCLE_NAME_TAKEN`.
- Owner row + audit + outbox all in one TX; partial circle creation is impossible.

---

### MOD-045 — `POST /circles/:id/members` handler

- **Parent ARCH**: ARCH-021
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function addMember(req, res):
  circleId = req.params.id
  actorId  = req.auth.userId
  { user_id, role = "member" } = validateAddMemberDto(req.body)

  await circleAccessGuard(actorId, circleId, { require: ["owner","admin"] })   # MOD-047

  return await db.transaction(async tx =>
    inserted = await tx.insert(circleMembers)
                   .values({ circle_id: circleId, user_id, role, joined_at: now() })
                   .onConflictDoNothing({ target: [circleMembers.circle_id, circleMembers.user_id] })
                   .returning({ user_id: circleMembers.user_id })

    if inserted.length == 0:
      return res.status(200).json({ ok: true, idempotent: true })

    appendCircleAuditEntry({               # MOD-052
      circle_id: circleId,
      actor_id:  actorId,
      action:    "circle.member.added",
      payload:   { user_id, role }
    }, tx)

    await tx.insert(outboxEvents).values({
      aggregate_id: circleId,
      event_type:   "circle.member.added",
      payload:      { circleId, userId: user_id, role, actorId },
      created_at:   now()
    })

    return res.status(201).json({ ok: true })
  )
```

**State Machine**

`N/A — Membership upsert`.

**Internal Data Structures**

`AddMemberDto = { user_id:UUID, role?:"member"|"admin" }`.

**Error Handling**

- 403 from `circleAccessGuard` for non-owner/admin actors.
- `onConflictDoNothing` makes re-add idempotent; response distinguishes new vs existing for client UX.
- 422 if target user does not exist (FK violation surfaced by global filter).

---

### MOD-046 — `DELETE /circles/:id/members/:userId` handler

- **Parent ARCH**: ARCH-021
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function removeMember(req, res):
  circleId   = req.params.id
  targetId   = req.params.userId
  actorId    = req.auth.userId

  await circleAccessGuard(actorId, circleId, {
    require: ["owner","admin"],
    selfAllowed: actorId == targetId           # users may always remove themselves
  })

  return await db.transaction(async tx =>
    target = await tx.select().from(circleMembers)
              .where(and(eq(circleMembers.circle_id, circleId),
                         eq(circleMembers.user_id, targetId)))
              .forUpdate()
              .first()

    if target == null:        return res.status(204).end()    # idempotent
    if target.role == "owner": throw httpError(409, "OWNER_REMOVAL_FORBIDDEN")

    await tx.delete(circleMembers)
            .where(and(eq(circleMembers.circle_id, circleId),
                       eq(circleMembers.user_id, targetId)))

    await rewriteAudiencesOnMembershipChange(circleId, targetId, tx)   # MOD-048

    appendCircleAuditEntry({                 # MOD-052
      circle_id: circleId,
      actor_id:  actorId,
      action:    "circle.member.removed",
      payload:   { user_id: targetId, prior_role: target.role }
    }, tx)

    await tx.insert(outboxEvents).values({
      aggregate_id: circleId,
      event_type:   "circle.member.removed",
      payload:      { circleId, userId: targetId, actorId },
      created_at:   now()
    })

    return res.status(204).end()
  )
```

**State Machine**

`N/A — Membership delete`; circle ownership transfer handled by separate flow (out of scope here).

**Internal Data Structures**

`circleMembers` row lock (`forUpdate()`).

**Error Handling**

- 403 from guard for unauthorised actors.
- 409 `OWNER_REMOVAL_FORBIDDEN` to prevent orphan circles; audit row written before throw is rolled back with the TX.
- Audience rewrite + audit + outbox + delete are atomic — eliminates the "ghost recipe access" race.

---

### MOD-047 — `circleAccessGuard(viewerId, circleId, opts)`

- **Parent ARCH**: ARCH-021
- **Type**: Function

**Algorithmic / Logic**

```text
async function circleAccessGuard(viewerId, circleId, opts = { require, selfAllowed }):
  membership = await db.select({
                  role: circleMembers.role
                })
                .from(circleMembers)
                .where(and(eq(circleMembers.circle_id, circleId),
                           eq(circleMembers.user_id, viewerId)))
                .first()

  if opts.selfAllowed and viewerId == opts?.targetUserId:
    return                              # short-circuit for self-actions

  if membership == null:
    throw httpError(404, "CIRCLE_NOT_FOUND")    # do not leak existence to non-members

  required = opts.require ?? ["member","admin","owner"]
  if !required.includes(membership.role):
    throw httpError(403, "INSUFFICIENT_ROLE", { required })

  return membership.role
```

**State Machine**

`N/A — Stateless guard`.

**Internal Data Structures**

`GuardOptions = { require?: Role[], selfAllowed?: boolean, targetUserId?: UUID }`.

**Error Handling**

- 404 (not 403) for non-members keeps circle existence private (REQ-PRIVACY).
- Single `SELECT` keeps p99 latency bounded; result is cacheable per request via DataLoader (out of scope but ARCH-021 notes it as a follow-up).
- Returns `Role` so callers can branch (e.g., MOD-046 owner-removal protection).

---

### MOD-048 — `rewriteAudiencesOnMembershipChange(circleId, removedUserId, tx)`

- **Parent ARCH**: ARCH-022
- **Type**: Function

**Algorithmic / Logic**

```text
async function rewriteAudiencesOnMembershipChange(circleId, removedUserId, tx):
  # find audience grants that reference both the circle and the removed user
  affected = await tx.select({
                id:        recipeAudiences.id,
                recipe_id: recipeAudiences.recipe_id,
                audience:  recipeAudiences.audience
              })
              .from(recipeAudiences)
              .where(or(
                eq(recipeAudiences.circle_id, circleId),
                sql`${recipeAudiences.user_ids} @> ARRAY[${removedUserId}]::uuid[]`
              ))

  for row in affected:
    nextUsers = (row.audience.user_ids ?? []).filter(u => u != removedUserId)

    if row.audience.kind == "circle" and isCircleEmpty(circleId, tx):
      await tx.delete(recipeAudiences).where(eq(recipeAudiences.id, row.id))
      continue

    await tx.update(recipeAudiences)
             .set({
               audience:   { ...row.audience, user_ids: nextUsers },
               updated_at: now()
             })
             .where(eq(recipeAudiences.id, row.id))

    await tx.insert(outboxEvents).values({
      aggregate_id: row.recipe_id,
      event_type:   "recipe.audience.compacted",
      payload:      { recipeId: row.recipe_id, removedUserId, circleId },
      created_at:   now()
    })
```

**State Machine**

`N/A — Operates on audience rows in-place`.

**Internal Data Structures**

`recipeAudiences.audience: { kind:"circle"|"user_list", circle_id?, user_ids?[] }`.

**Error Handling**

- Caller-supplied `tx` ensures atomicity with MOD-046 (no half-rewritten audiences).
- Empty-circle short-circuit prevents stale grants pointing at a circle with zero members.
- Outbox event drives downstream cache busting; failures roll back via the parent TX.

---

### MOD-049 — `softDeleteRecipe(recipeId, actorId)`

- **Parent ARCH**: ARCH-023
- **Type**: Function

**Algorithmic / Logic**

```text
async function softDeleteRecipe(recipeId, actorId):
  return await db.transaction(async tx =>
    row = await tx.update(recipes)
            .set({ deleted_at: now(), deleted_by: actorId, updated_at: now() })
            .where(and(eq(recipes.id, recipeId),
                       eq(recipes.owner_id, actorId),
                       isNull(recipes.deleted_at)))
            .returning({ id: recipes.id, version: recipes.version })

    if row == null:
      throw httpError(404, "RECIPE_NOT_FOUND_OR_ALREADY_DELETED")

    await tx.insert(outboxEvents).values({
      aggregate_id: recipeId,
      event_type:   "recipe.archive.requested",
      payload:      { recipeId, actorId, version: row.version },
      created_at:   now()
    })

    return row
  )
```

**State Machine**

`active → soft-deleted` (idempotent: re-call after delete returns 404).

**Internal Data Structures**

`recipes.deleted_at`, `recipes.deleted_by`; outbox event consumed by ARCH-023 archival worker (MOD-051).

**Error Handling**

- 404 covers both "missing" and "already soft-deleted" — caller cannot distinguish (REQ-PRIVACY).
- Outbox event is the _only_ trigger for archival; `softDeleteRecipe` never calls SQS directly (keeps API path latency-bounded).
- 30-day retention window enforced by MOD-050 + scheduled hard-delete job (out of scope for this MOD).

---

### MOD-050 — `restoreRecipe(recipeId, actorId)`

- **Parent ARCH**: ARCH-023
- **Type**: Function

**Algorithmic / Logic**

```text
RETENTION_DAYS = 30

async function restoreRecipe(recipeId, actorId):
  return await db.transaction(async tx =>
    row = await tx.update(recipes)
            .set({ deleted_at: null, deleted_by: null, updated_at: now() })
            .where(and(
              eq(recipes.id, recipeId),
              eq(recipes.owner_id, actorId),
              isNotNull(recipes.deleted_at),
              gt(recipes.deleted_at, sql`now() - INTERVAL '${RETENTION_DAYS} days'`)
            ))
            .returning({ id: recipes.id })

    if row == null:
      throw httpError(404, "RECIPE_NOT_RESTORABLE")

    await tx.insert(outboxEvents).values({
      aggregate_id: recipeId,
      event_type:   "recipe.restored",
      payload:      { recipeId, actorId },
      created_at:   now()
    })

    return row
  )
```

**State Machine**

`soft-deleted → active` only inside the retention window; otherwise terminal.

**Internal Data Structures**

`RETENTION_DAYS = 30` named constant (MD-4 acceptance test pins it).

**Error Handling**

- 404 covers all three failure modes: not owned, never deleted, past retention.
- Restore does not unwind the archived snapshot; downstream consumers re-fetch live row.
- Concurrent hard-delete is impossible because hard-delete runs only after retention cutoff (separate job).

---

### MOD-051 — `archiveRecipeVersion(message)` worker handler

- **Parent ARCH**: ARCH-023
- **Type**: SQS Worker Handler (Lambda)

**Algorithmic / Logic**

```text
async function handler(event):
  results = []
  for record in event.Records:
    try:
      msg = JSON.parse(record.body)        # { recipeId, version, actorId }
      await archiveRecipeVersion(msg)
      results.push({ itemIdentifier: record.messageId, status: "ok" })
    catch (err):
      logger.error("archive_failed", { messageId: record.messageId, err })
      results.push({ itemIdentifier: record.messageId, status: "fail" })

  # SQS partial batch failure protocol
  return {
    batchItemFailures: results
                         .filter(r => r.status == "fail")
                         .map(r => ({ itemIdentifier: r.itemIdentifier }))
  }

async function archiveRecipeVersion(msg):
  recipe = await recipesRepo.findByIdIncludingDeleted(msg.recipeId)
  if recipe == null:
    throw new Error("RECIPE_GONE_BEFORE_ARCHIVE")    # SQS retries; eventually DLQ

  key = `archive/${recipe.owner_id}/${recipe.id}/v${msg.version}-${nowEpoch()}.json`
  body = JSON.stringify({
    recipe,
    archived_at: now(),
    actor_id:    msg.actorId,
    schema_version: 1
  })

  await s3.send(new PutObjectCommand({
    Bucket: env.RECIPES_ARCHIVE_BUCKET,
    Key:    key,
    Body:   body,
    ContentType: "application/json",
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: env.RECIPES_KMS_KEY_ARN
  }))

  await db.insert(recipeArchives).values({
    recipe_id:   recipe.id,
    s3_key:      key,
    version:     msg.version,
    archived_at: now()
  }).onConflictDoNothing()           # idempotent under SQS redelivery
```

**State Machine**

`pending → archived` per `(recipe_id, version)`; replays are no-ops.

**Internal Data Structures**

`SqsMessage = { recipeId, version, actorId }`; `recipeArchives` row; KMS-encrypted JSON snapshot.

**Error Handling**

- SQS partial batch failure protocol returns only failed `itemIdentifier`s — successful messages never reprocess.
- `RECIPE_GONE_BEFORE_ARCHIVE` is a true error: hard-delete should never beat archive; the DLQ alarm triggers on-call (per ARCH-023 ops view).
- KMS / S3 5xx → exception → SQS visibility timeout retry (up to redrive policy max).
- `onConflictDoNothing` makes archive insert idempotent on the unique `(recipe_id, version)` index.

---

### MOD-052 — `appendCircleAuditEntry(entry, tx?)`

- **Parent ARCH**: ARCH-024
- **Type**: Function

**Algorithmic / Logic**

```text
async function appendCircleAuditEntry(entry, tx = db):
  validateAuditEntry(entry)        # circle_id, actor_id, action ∈ AUDIT_ACTIONS

  await tx.insert(auditLog).values({
    circle_id:  entry.circle_id,
    actor_id:   entry.actor_id,
    action:     entry.action,
    payload:    entry.payload ?? {},
    created_at: now()                        # DB default also enforces this
  })

# update/delete are forbidden by Postgres RLS policy + revoked grants;
# the function deliberately exposes no `update*` / `delete*` API.
```

**State Machine**

`N/A — Append-only ledger`.

**Internal Data Structures**

`AuditEntry = { circle_id:UUID, actor_id:UUID, action:AuditAction, payload?:Record<string,unknown> }`.

**Error Handling**

- Invalid `action` throws `Error("INVALID_AUDIT_ACTION")` — caught upstream by global filter; never reaches client.
- Postgres `INSERT` is the only allowed write path; revoked `UPDATE`/`DELETE` grants make tampering schema-impossible (defence-in-depth per ARCH-024).
- All callers pass the parent transaction so audit + business write are atomic.

---

### MOD-053 — `circleOutlierMonitor.run()`

- **Parent ARCH**: ARCH-025
- **Type**: Scheduled Job

**Algorithmic / Logic**

```text
SIZE_THRESHOLD = 50
GROWTH_THRESHOLD_PCT = 100      # +100% in 24h triggers alert

async function run():
  rows = await db.execute(sql`
    SELECT c.id, c.owner_id,
           COUNT(m.user_id)                                  AS member_count,
           COUNT(m.user_id) FILTER (WHERE m.joined_at > now() - INTERVAL '24 hours') AS joined_last_24h
    FROM circles c
    JOIN circle_members m ON m.circle_id = c.id
    GROUP BY c.id, c.owner_id
  `)

  for r in rows:
    growthPct = r.member_count == 0 ? 0
                : (r.joined_last_24h / r.member_count) * 100

    if r.member_count >= SIZE_THRESHOLD or growthPct >= GROWTH_THRESHOLD_PCT:
      await db.insert(outboxEvents).values({
        aggregate_id: r.id,
        event_type:   "circle.size.outlier",
        payload:      {
                        circleId:        r.id,
                        ownerId:         r.owner_id,
                        memberCount:     r.member_count,
                        joinedLast24h:   r.joined_last_24h,
                        growthPct,
                        thresholds:      { SIZE_THRESHOLD, GROWTH_THRESHOLD_PCT }
                      },
        created_at:   now()
      })

  return { evaluated: rows.length }
```

**State Machine**

`N/A — Stateless aggregation; idempotent per scheduled run`.

**Internal Data Structures**

Inline named constants (`SIZE_THRESHOLD`, `GROWTH_THRESHOLD_PCT`) so MD-4 acceptance tests can pin them.

**Error Handling**

- Outbox dedup handled downstream — repeated emissions for the same circle are acceptable; trust & safety dashboards window them.
- Scheduler retry-on-failure is bounded by EventBridge; no in-function retry to avoid double-counting.

---

### MOD-054 — `POST /circles/:id/invitation/rotate` handler

- **Parent ARCH**: ARCH-026
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function rotateInvitation(req, res):
  circleId = req.params.id
  actorId  = req.auth.userId

  await circleAccessGuard(actorId, circleId, { require: ["owner"] })   # MOD-047

  return await db.transaction(async tx =>
    await tx.update(circleInvitations)
            .set({ revoked_at: now() })
            .where(and(eq(circleInvitations.circle_id, circleId),
                       isNull(circleInvitations.revoked_at)))

    token   = generateInvitationToken()                # 32-byte base64url
    expires = now() + INTERVAL '7 days'

    [row] = await tx.insert(circleInvitations).values({
              circle_id:   circleId,
              token_hash:  hashToken(token),           # SHA-256, never store raw
              created_by:  actorId,
              created_at:  now(),
              expires_at:  expires
            }).returning({ id: circleInvitations.id })

    appendCircleAuditEntry({                           # MOD-052
      circle_id: circleId,
      actor_id:  actorId,
      action:    "circle.invitation.rotated",
      payload:   { invitation_id: row.id, expires_at: expires }
    }, tx)

    return res.status(201).json({
      token,                              # raw token returned ONCE
      expires_at: expires
    })
  )
```

**State Machine**

`active invitation → revoked` ; new `pending → active` row inserted in same TX.

**Internal Data Structures**

`circleInvitations` row stores only `token_hash`; raw token never persisted (REQ-SEC).

**Error Handling**

- 403 from guard for non-owners (admins explicitly excluded — only owner may rotate).
- Revoke + insert atomic: there is never a window with two active invites.
- Raw token returned only in this 201 response — clients must surface to the user immediately.

---

### MOD-055 — `POST /circles/join/:token` handler

- **Parent ARCH**: ARCH-026
- **Type**: HTTP Handler

**Algorithmic / Logic**

```text
async function joinCircle(req, res):
  rawToken = req.params.token
  userId   = req.auth.userId

  if !looksLikeInvitationToken(rawToken):
    throw httpError(400, "INVITATION_TOKEN_INVALID")

  hash = hashToken(rawToken)

  return await db.transaction(async tx =>
    invite = await tx.select().from(circleInvitations)
              .where(and(eq(circleInvitations.token_hash, hash),
                         isNull(circleInvitations.revoked_at),
                         gt(circleInvitations.expires_at, now())))
              .forUpdate()
              .first()

    if invite == null:
      throw httpError(404, "INVITATION_NOT_FOUND_OR_EXPIRED")

    inserted = await tx.insert(circleMembers)
                   .values({ circle_id: invite.circle_id,
                             user_id:   userId,
                             role:      "member",
                             joined_at: now() })
                   .onConflictDoNothing({ target: [circleMembers.circle_id, circleMembers.user_id] })
                   .returning({ user_id: circleMembers.user_id })

    appendCircleAuditEntry({                       # MOD-052
      circle_id: invite.circle_id,
      actor_id:  userId,
      action:    inserted.length > 0 ? "circle.member.joined_via_invite"
                                     : "circle.invitation.replayed",
      payload:   { invitation_id: invite.id }
    }, tx)

    if inserted.length > 0:
      await tx.insert(outboxEvents).values({
        aggregate_id: invite.circle_id,
        event_type:   "circle.member.added",
        payload:      { circleId: invite.circle_id, userId, role: "member",
                        actorId: userId, source: "invitation" },
        created_at:   now()
      })

    return res.status(200).json({ circle_id: invite.circle_id, joined: inserted.length > 0 })
  )
```

**State Machine**

`N/A — Membership upsert keyed on `(circle_id, user_id)`.

**Internal Data Structures**

Hashed token lookup; idempotent membership insert.

**Error Handling**

- 400 short-circuits malformed tokens before any DB hit (cheap defence vs scanners).
- 404 covers expired, revoked, or non-existent — never leaks circle existence (REQ-PRIVACY).
- Replay is observable in audit ledger via distinct `action` value but produces no duplicate outbox event.

---

### MOD-056 — `AuthMiddleware.use(req, res, next)`

- **Parent ARCH**: ARCH-027
- **Type**: Class (NestJS middleware)

**Algorithmic / Logic**

```text
class AuthMiddleware implements NestMiddleware:
  constructor(clerk: ClerkAuthService):                  # MOD-057
    this.clerk = clerk

  async use(req, res, next):
    token = extractBearer(req.headers.authorization)
    if !token: throw new UnauthorizedException("MISSING_BEARER")

    try:
      claims = await this.clerk.verify(token)            # VerifiedClerkClaims; networkless verifyToken + azp check
      req.user = {
        userId:      claims.sub,
        scope:       claims.public_metadata?.scopes ?? [],
        permissions: claims.public_metadata?.permissions ?? [],
        tier:        claims.public_metadata?.tier,
        claims
      }
      next()
    catch (err):
      if isClerkAuthError(err) && err.code == "TOKEN_EXPIRED":
                                          throw new UnauthorizedException("TOKEN_EXPIRED")
      if isClerkAuthError(err) && err.code == "BAD_SIGNATURE":
                                          throw new UnauthorizedException("BAD_SIGNATURE")
      logger.warn("clerk_verify_failed", { code: err.code })
      throw new UnauthorizedException("TOKEN_INVALID")
```

**State Machine**

`N/A — Per-request middleware`.

**Internal Data Structures**

`req.user = { userId, scope[], permissions[], tier, claims }` (consumed by every handler; admin scopes/permissions and subscription tier come from the signed token's `public_metadata`).

**Error Handling**

- All failure modes collapse to `401`; reason code surfaces in `WWW-Authenticate` header (set by `Rfc7807ExceptionFilter` MOD-058).
- Verification failures bubble from MOD-057's `ClerkAuthService`; middleware never silently allows.
- `extractBearer` rejects `Bearer ` with empty token (defence vs misconfigured proxies).

---

### MOD-057 — `ClerkAuthService`

- **Parent ARCH**: ARCH-027
- **Type**: Class

**Algorithmic / Logic**

```text
class ClerkAuthService:
  constructor(cfg: { jwtKey: CLERK_JWT_KEY, authorizedParties: CLERK_AUTHORIZED_PARTIES }):
    this.jwtKey            = cfg.jwtKey               # PEM public key (non-secret); no JWKS fetch
    this.authorizedParties = cfg.authorizedParties    # comma-separated azp allowlist (non-secret)

  async verify(token) -> VerifiedClerkClaims:
    # Networkless: no JWKS round trip, no client secret, no audience, no Clerk Backend API call on the hot path.
    payload = await verifyToken(token, {               # @clerk/backend
      jwtKey:            this.jwtKey,
      authorizedParties: this.authorizedParties        # azp enforcement
    })
    return payload                                     # includes sub + public_metadata (scopes/permissions/tier)
```

**State Machine**

`N/A — Stateless`. Verification is purely cryptographic against the configured public key; there is no key-cache lifecycle (Clerk's networkless model carries the key in config, rotated by redeploy/config update — no per-request refresh).

**Internal Data Structures**

- `jwtKey` — single PEM public key string (`CLERK_JWT_KEY`), non-secret; replaces any JWKS key set.
- `authorizedParties` — `azp` allowlist (`CLERK_AUTHORIZED_PARTIES`), exact-string match (no wildcards).

**Error Handling**

- Verification failures surface to `AuthMiddleware` (MOD-056) as `TOKEN_INVALID` / `TOKEN_EXPIRED` / `BAD_SIGNATURE` (401) — never as 5xx; clients retry idempotently after refreshing the token.
- No network dependency on the hot path, so no JWKS-outage failure mode and no request-thread starvation from key fetches.
- Stateless and process-local; horizontal scale is trivial (each instance holds the same public key from config).
- No silent allow — middleware rejects whenever `verifyToken` throws.

---

### MOD-058 — `Rfc7807ExceptionFilter.catch(err, host)`

- **Parent ARCH**: ARCH-028
- **Type**: Class (NestJS global exception filter)

**Algorithmic / Logic**

```text
@Catch()
class Rfc7807ExceptionFilter implements ExceptionFilter:
  catch(err, host):
    ctx      = host.switchToHttp()
    res      = ctx.getResponse()
    req      = ctx.getRequest()
    problem  = mapErrorToProblem(err)                          # MOD-059

    # Correlation
    problem.instance     = req.url
    problem.trace_id     = req.headers["x-request-id"] ?? randomUUID()

    # Auth challenge for 401
    if problem.status == 401:
      res.setHeader("WWW-Authenticate",
                    `Bearer error="${problem.error_code}"`)

    res.status(problem.status)
       .type("application/problem+json")
       .json(problem)

    if problem.status >= 500:
      logger.error("unhandled_error", { trace_id: problem.trace_id, err })
    else:
      logger.warn("client_error",      { trace_id: problem.trace_id, code: problem.error_code })
```

**State Machine**

`N/A — Per-request terminal handler`.

**Internal Data Structures**

`Problem` envelope `{ type, title, status, detail, error_code, instance, trace_id, errors? }` — `errors[]` populated by validation pipe for 400 responses.

**Error Handling**

- Filter itself MUST NOT throw — any internal failure is caught and degrades to a minimal `500 application/problem+json` body with stable `error_code: "INTERNAL_ERROR"`.
- `trace_id` always emitted so support can pivot from user-visible ID to logs.
- Log severity tiered: `>=500 → error`, `4xx → warn`; matches MOD-067 metric dimensions.

---

### MOD-059 — `mapErrorToProblem(err)`

- **Parent ARCH**: ARCH-028
- **Type**: Function (pure)

**Algorithmic / Logic**

```text
function mapErrorToProblem(err) -> Problem:
  # 1. Domain errors carry their own contract
  if err instanceof DomainError:
    return {
      type:       `https://errors.kitchensink.app/${err.code}`,
      title:      err.title,
      status:     err.httpStatus,
      detail:     err.message,
      error_code: err.code
    }

  # 2. Class-validator failures
  if err instanceof BadRequestException && Array.isArray(err.getResponse().message):
    return {
      type:       "https://errors.kitchensink.app/VALIDATION_FAILED",
      title:      "Validation failed",
      status:     400,
      detail:     "One or more fields failed validation.",
      error_code: "VALIDATION_FAILED",
      errors:     err.getResponse().message     # field-level details
    }

  # 3. Native HttpException
  if err instanceof HttpException:
    body = err.getResponse()
    return {
      type:       `https://errors.kitchensink.app/${body.error_code ?? "HTTP_ERROR"}`,
      title:      err.message,
      status:     err.getStatus(),
      detail:     typeof body == "string" ? body : (body.detail ?? err.message),
      error_code: body.error_code ?? defaultCodeFor(err.getStatus())
    }

  # 4. Unknown — never leak internals
  return {
    type:       "https://errors.kitchensink.app/INTERNAL_ERROR",
    title:      "Internal Server Error",
    status:     500,
    detail:     "An unexpected error occurred.",
    error_code: "INTERNAL_ERROR"
  }
```

**State Machine**

`N/A — Pure function; no side effects`.

**Internal Data Structures**

`defaultCodeFor(status)` — switch returning canonical strings (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, …) so codes remain stable even when callers omit them.

**Error Handling**

- Branch ordering matters: `DomainError` first (richest contract), then framework-specific, then unknown fallthrough.
- Unknown branch never echoes `err.message` or stack — pre-empts info-leak findings from security review.
- Function MUST be deterministic — MD-4 unit tests pin every branch.

---

### MOD-060 — `Audience` types + `AudienceScope` union

- **Parent ARCH**: ARCH-029
- **Type**: Public API (TypeScript module)

**Algorithmic / Logic**

```ts
// @kitchensink/shared-audience
export type AudienceScope = 'private' | 'circle' | 'public';

export type PrivateAudience = { scope: 'private' };
export type CircleAudience = { scope: 'circle'; ref_id: string /* circleId */ };
export type PublicAudience = { scope: 'public' };

export type Audience = PrivateAudience | CircleAudience | PublicAudience;

export const isCircleAudience = (a: Audience): a is CircleAudience => a.scope === 'circle';
```

**State Machine**

`N/A — Compile-time types`.

**Internal Data Structures**

Discriminated union on `scope`; `ref_id` is structurally required only when `scope === "circle"` — TypeScript enforces this at every consumer call-site.

**Error Handling**

- Type-only module — no runtime errors possible.
- Versioned via package boundary: any field addition is a minor bump; removal/rename is breaking.
- Re-exported by `recipe`, `circle`, `feed` modules — single source of truth prevents drift.

---

### MOD-061 — `assertCircleRefIdPresent(audience)`

- **Parent ARCH**: ARCH-029
- **Type**: Function (runtime guard)

**Algorithmic / Logic**

```text
function assertCircleRefIdPresent(audience: Audience): asserts audience is Audience:
  if audience.scope == "circle":
    if typeof audience.ref_id != "string" || audience.ref_id.length == 0:
      throw new BadRequestException({
        error_code: "AUDIENCE_REF_ID_REQUIRED",
        detail:     "scope='circle' requires non-empty ref_id"
      })
```

**State Machine**

`N/A — Single assertion`.

**Internal Data Structures**

None.

**Error Handling**

- Throws `BadRequestException` (400) → mapped to RFC 7807 by MOD-058/059.
- Defends against malformed payloads that bypass class-validator (e.g., direct internal callers).
- Idempotent — safe to call multiple times in the same request lifecycle.

---

### MOD-062 — `applyApiV1Prefix(app)` bootstrap step

- **Parent ARCH**: ARCH-030
- **Type**: Configuration (NestJS bootstrap)

**Algorithmic / Logic**

```ts
export function applyApiV1Prefix(app: INestApplication): void {
    app.setGlobalPrefix('api/v1', {
        exclude: [
            { path: 'health', method: RequestMethod.GET },
            { path: 'metrics', method: RequestMethod.GET },
        ],
    });
}
```

**State Machine**

`N/A — One-shot at boot`.

**Internal Data Structures**

`exclude[]` whitelist — operational endpoints (`/health`, `/metrics`) MUST stay unprefixed for ALB target-group probes and Prometheus scrapes.

**Error Handling**

- Misconfigured prefix surfaces immediately at boot via Nest's route table dump (CDK smoke test asserts `/api/v1/recipes` resolves).
- `exclude[]` drift is caught by MOD-063 (lint rule) at PR time.

---

### MOD-063 — `routePrefixLintRule`

- **Parent ARCH**: ARCH-030
- **Type**: Configuration (custom ESLint rule)

**Algorithmic / Logic**

```text
rule "kitchensink/route-prefix":
  on @Controller decorator usage:
    arg = controllerPath()
    if arg is undefined or arg starts with "/":
      report("Controller path must be relative; global prefix 'api/v1' is applied at boot.")
    if arg matches /^api\/?v\d/:
      report("Do not duplicate the global 'api/v1' prefix in @Controller paths.")

  on Express raw route registration (app.get/app.post/...):
    if pathArg does NOT start with "/api/v1/" AND pathArg not in OPS_WHITELIST:
      report("Raw routes must live under /api/v1/* or be whitelisted ops endpoints.")
```

**State Machine**

`N/A — Static analysis at lint time`.

**Internal Data Structures**

`OPS_WHITELIST = ["/health", "/metrics"]` — kept in sync with MOD-062's `exclude[]` list (single import).

**Error Handling**

- Lint failures block CI (`npm run lint` exits non-zero).
- Rule MUST NOT autofix — incorrect prefix is almost always an architectural mistake worth a human review.

---

### MOD-064 — `resolveAudience(viewerId, audience, health)`

- **Parent ARCH**: ARCH-031
- **Type**: Function (pure decision)

**Algorithmic / Logic**

```text
function resolveAudience(viewerId, audience, health) -> "allow" | "deny" | "circles_unavailable":
  switch audience.scope:
    case "private":
      return audience.owner_id == viewerId ? "allow" : "deny"

    case "public":
      return "allow"

    case "circle":
      if health.circlesService != "healthy":
        # Explicit unavailability — caller renders empty state, NEVER falls through to allow
        return "circles_unavailable"

      isMember = await circleMembershipQuery(viewerId, audience.ref_id)   # MOD-046
      return isMember ? "allow" : "deny"
```

**State Machine**

`N/A — Per-request decision`.

**Internal Data Structures**

`health: { circlesService: "healthy" | "degraded" | "down" }` — sourced from circuit-breaker state on the circles backend client.

**Error Handling**

- `circles_unavailable` is a first-class verdict — MUST NOT be coerced to `allow` (REQ-SEC-AUD-001 / FROZEN-PENDING-RESOLUTION marker preserved).
- Membership query failure (transient DB error) re-throws → 5xx → mapped by MOD-058 → never silently allows.
- `private` branch checks ownership inline — defence in depth even if upstream guard already filtered.

---

### MOD-065 — `InvitationAcceptanceScreen`

- **Parent ARCH**: ARCH-032
- **Type**: UI Component (React Native + web — cross-platform)

**Algorithmic / Logic**

```text
function InvitationAcceptanceScreen({ token }):
  state = useReducer(reducer, { phase: "idle" })   # idle | loading | preview | joining | joined | error

  useEffect(() =>
    state.dispatch({ type: "LOAD" })
    api.getInvitationPreview(token)                 # GET /api/v1/circles/invitations/:token/preview
       .then(preview => state.dispatch({ type: "PREVIEW_OK", preview }))
       .catch(err    => state.dispatch({ type: "PREVIEW_ERR", err }))
  , [token])

  switch state.phase:
    case "idle" | "loading":
      return <Spinner accessibilityLabel="Loading invitation" />

    case "preview":
      return (
        <Screen>
          <Heading level={1}>Join {state.preview.circle_name}</Heading>
          <Text>Invited by {state.preview.invited_by_display_name}</Text>
          <Text>Expires {formatRelative(state.preview.expires_at)}</Text>
          <Button
             accessibilityLabel={`Accept invitation to ${state.preview.circle_name}`}
             onPress={onAccept}
             disabled={state.phase == "joining"}>
            Accept
          </Button>
          <Button kind="ghost" onPress={onDecline}>Not now</Button>
        </Screen>
      )

    case "joined":
      return <SuccessScreen circleId={state.circleId} />

    case "error":
      return <ErrorBanner code={state.err.error_code} message={state.err.detail} retry={onRetry} />

  function onAccept():
    state.dispatch({ type: "JOIN" })
    api.joinCircle(token)                           # POST /api/v1/circles/join/:token (MOD-055)
       .then(({ circle_id }) => state.dispatch({ type: "JOIN_OK", circleId: circle_id }))
       .catch(err            => state.dispatch({ type: "JOIN_ERR", err }))
```

**State Machine**

`idle → loading → (preview | error) → joining → (joined | error)` ; `error` has `retry` transition back to `loading`.

**Internal Data Structures**

`Preview = { circle_name, invited_by_display_name, expires_at }` — never includes the raw token in component props or analytics events.

**Error Handling**

- A11y: every interactive element has `accessibilityLabel`; status changes announced via live region (`role="status"` on web, `accessibilityLiveRegion` on native).
- Error states map RFC 7807 `error_code` → user-friendly copy: `INVITATION_EXPIRED`, `INVITATION_REVOKED`, `INVITATION_TOKEN_INVALID`, `ALREADY_MEMBER`.
- Token NEVER logged or surfaced in analytics; only `circle_id` (post-join) flows to telemetry.
- Disabled `Accept` button during `joining` prevents double-submit (idempotency belt-and-braces with MOD-055).

---

### MOD-066 — `rawOcrPurgeJob.run()`

- **Parent ARCH**: ARCH-033
- **Type**: Job (scheduled Lambda, EventBridge daily cron)

**Algorithmic / Logic**

```text
async function run():
  cutoff = now() - INTERVAL '90 days'

  loop:
    rows = await db.select({ id: ocrJobs.id })
                   .from(ocrJobs)
                   .where(and(
                     isNotNull(ocrJobs.raw_ocr_json),
                     lt(ocrJobs.completed_at, cutoff)
                   ))
                   .limit(BATCH_SIZE)              # BATCH_SIZE = 500

    if rows.length == 0: break

    await db.update(ocrJobs)
            .set({
              raw_ocr_json:  null,
              purged_at:     now()
            })
            .where(inArray(ocrJobs.id, rows.map(r => r.id)))

    metrics.emit("ocr.raw.purged", rows.length)    # MOD-067

    if rows.length < BATCH_SIZE: break             # done for this run
```

**State Machine**

`raw_ocr_json IS NOT NULL → raw_ocr_json IS NULL ∧ purged_at = now()` (irreversible per row).

**Internal Data Structures**

`BATCH_SIZE = 500` constant — pinned so unit tests can validate paging and so DB load stays bounded.

**Error Handling**

- Idempotent: re-running on the same day naturally no-ops once `cutoff` rows are exhausted.
- Partial-batch failure: transaction is per-batch; failed batch is retried on next scheduled run (no in-job retry to keep Lambda short).
- `purged_at` watermark allows ops audit ("when did we purge X?") without retaining the raw payload.
- Hard-deleted `recipes` cascade to `ocr_jobs.raw_ocr_json` via FK + on-delete-cascade — purge job is the soft-retention path only.

---

### MOD-067 — `metrics.emit(name, value, dims)`

- **Parent ARCH**: ARCH-034
- **Type**: Function (async fire-and-forget)

**Algorithmic / Logic**

```ts
export function emit(name: string, value: number = 1, dims: Record<string, string | number> = {}): void {
    // EMF (CloudWatch Embedded Metric Format) — single stdout line, picked up by Lambda Logs
    const payload = {
        _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
                {
                    Namespace: 'KitchenSink',
                    Dimensions: [Object.keys(dims)],
                    Metrics: [{ Name: name, Unit: 'Count' }],
                },
            ],
        },
        [name]: value,
        ...dims,
    };
    try {
        process.stdout.write(JSON.stringify(payload) + '\n');
    } catch {
        // swallow — metrics MUST NEVER break a request
    }
}
```

**State Machine**

`N/A — Stateless emission`.

**Internal Data Structures**

EMF JSON envelope — chosen so we get CloudWatch metrics for free without a separate API call (no extra latency on the request hot path).

**Error Handling**

- All errors swallowed — metrics are observability, NEVER request-blocking.
- No retries, no buffering — at-most-once semantics are acceptable for monitoring signals.
- Dimension cardinality is the caller's responsibility; `routePrefixLintRule` (MOD-063) and code review guard against high-cardinality dims (e.g., `userId`).

---

### MOD-068 — `cdkAlarmDefinitions`

- **Parent ARCH**: ARCH-034
- **Type**: Configuration (CDK construct exports)

**Algorithmic / Logic**

```ts
export const ALARMS = {
    ocrQueueDepth: {
        metric: ocrQueue.metricApproximateNumberOfMessagesVisible(),
        threshold: 500,
        evaluationPeriods: 3,
        period: Duration.minutes(1),
        treatMissingData: TreatMissingData.NOT_BREACHING,
        alarmDescription: 'OCR job queue depth elevated — investigate provider or worker concurrency.',
    },
    ocrDlqMessages: {
        metric: ocrDlq.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
        period: Duration.minutes(5),
        treatMissingData: TreatMissingData.NOT_BREACHING,
        alarmDescription: 'Any DLQ message — manual triage required.',
    },
    ocrLatencyP95: {
        metric: new Metric({
            namespace: 'KitchenSink',
            metricName: 'ocr.duration_ms',
            statistic: 'p95',
        }),
        threshold: 15_000, // 15s SLO
        evaluationPeriods: 5,
        period: Duration.minutes(1),
        alarmDescription: 'OCR p95 latency exceeds SLO — check provider health.',
    },
    recipeApi5xx: {
        metric: apiGateway.metricServerError(),
        threshold: 5,
        evaluationPeriods: 2,
        period: Duration.minutes(1),
        alarmDescription: 'Recipe API 5xx error rate elevated.',
    },
} as const;

export function attachAlarms(scope: Construct, snsTopic: ITopic): void {
    for (const [id, def] of Object.entries(ALARMS)) {
        new Alarm(scope, `Alarm-${id}`, def).addAlarmAction(new SnsAction(snsTopic));
    }
}
```

**State Machine**

`N/A — IaC declaration`.

**Internal Data Structures**

`ALARMS` const map — keyed by stable id so alarms are renamed consistently across deploys (CFN logical id stable).

**Error Handling**

- `treatMissingData: NOT_BREACHING` for queue depth — empty queue (= no messages) MUST NOT page on-call.
- DLQ alarm threshold = 1: any single DLQ message is an incident.
- Alarms route via single SNS topic so escalation policy lives in PagerDuty/Opsgenie, not CDK.
- All thresholds are constants in this file — change history is git-blameable.

---

### MOD-069 — `POST /internal/canary/promote` handler

- **Parent ARCH**: ARCH-035
- **Type**: HTTP Handler (internal-only, mTLS or VPC-restricted)

**Algorithmic / Logic**

```text
async function promoteCanary(req, res):
  # Internal endpoint — no Clerk auth middleware; perimeter handled by VPC + ALB target rule
  windowMin = req.body.window_minutes ?? 15
  if windowMin < 5 || windowMin > 60:
    throw httpError(400, "WINDOW_OUT_OF_RANGE")

  signals = await collectCanarySignals(windowMin)   # CloudWatch metrics for canary stack
  verdict = evaluateCanaryGates(signals)            # MOD-070

  await auditLog.append({
    actor:    "system:canary-promoter",
    action:   "canary.promote.evaluated",
    payload:  { window_minutes: windowMin, signals, verdict }
  })

  return res.status(200).json({
    verdict:           verdict.decision,            # "promote" | "hold" | "rollback"
    reason:            verdict.reason,
    insufficient_data: verdict.decision == "hold" && verdict.reason == "INSUFFICIENT_SIGNAL"
  })
```

**State Machine**

`N/A — Per-call decision; downstream deploy pipeline owns actual promotion`.

**Internal Data Structures**

`signals = { error_rate, latency_p95, traffic_share }` — bounded shape; new signals require explicit schema bump.

**Error Handling**

- Default-deny: any unexpected error from `collectCanarySignals` → 503 → pipeline interprets as `hold` (NEVER auto-promotes on error).
- `WINDOW_OUT_OF_RANGE` blocks operator typos (`window_minutes: 600`).
- Verdict + signals always audited so post-incident review can reconstruct the decision.

---

### MOD-070 — `evaluateCanaryGates(window)`

- **Parent ARCH**: ARCH-035
- **Type**: Function (pure evaluator)

**Algorithmic / Logic**

```text
function evaluateCanaryGates(signals) -> { decision, reason }:
  # Insufficient signal — fewer than MIN_REQUESTS in the window
  if signals.request_count < MIN_REQUESTS:           # MIN_REQUESTS = 100
    return { decision: "hold", reason: "INSUFFICIENT_SIGNAL" }

  # Hard rollback gates
  if signals.error_rate > ROLLBACK_ERROR_RATE:       # 0.05  (5%)
    return { decision: "rollback", reason: "ERROR_RATE_EXCEEDS_ROLLBACK_THRESHOLD" }
  if signals.latency_p95 > ROLLBACK_LATENCY_MS:      # 5_000ms
    return { decision: "rollback", reason: "LATENCY_P95_EXCEEDS_ROLLBACK_THRESHOLD" }

  # Hold gates (within tolerance but not promotable)
  if signals.error_rate > PROMOTE_ERROR_RATE:        # 0.01  (1%)
    return { decision: "hold", reason: "ERROR_RATE_ABOVE_PROMOTE_THRESHOLD" }
  if signals.latency_p95 > PROMOTE_LATENCY_MS:       # 2_000ms
    return { decision: "hold", reason: "LATENCY_P95_ABOVE_PROMOTE_THRESHOLD" }

  return { decision: "promote", reason: "ALL_GATES_PASSED" }
```

**State Machine**

`N/A — Pure decision tree; deterministic per (signals) input`.

**Internal Data Structures**

All thresholds named constants — pinned so MD-4 unit tests assert each branch and so SRE config drift is reviewable.

**Error Handling**

- Default-deny on missing signal: never returns `promote` for absent data.
- Rollback gates evaluated BEFORE hold gates — fail-loud ordering.
- Function is pure — no I/O, no clock, no randomness — MD-4 tests pin every branch with table-driven cases.

---

### MOD-071 — `flags.isEnabled(name, ctx)`

- **Parent ARCH**: ARCH-036
- **Type**: Function (cached lookup)

**Algorithmic / Logic**

```text
const cache = new Map()           # name -> { value, fetchedAt }
let lastKnownGood = new Map()     # name -> value (survives provider outage)

async function isEnabled(name, ctx) -> boolean:
  hit = cache.get(name)
  if hit && (now() - hit.fetchedAt) < FLAG_TTL_MS:        # 30_000
    return evaluate(hit.value, ctx)

  try:
    value = await provider.getFlag(name, { timeoutMs: 500 })
    cache.set(name,         { value, fetchedAt: now() })
    lastKnownGood.set(name, value)
    return evaluate(value, ctx)
  catch (err):
    metrics.emit("flags.fetch.error", 1, { name, code: err.code })
    if lastKnownGood.has(name):
      return evaluate(lastKnownGood.get(name), ctx)        # LKG fallback
    return DEFAULT_OFF                                     # default-deny new flags

function evaluate(value, ctx) -> boolean:
  # value: { kind: "boolean" | "percentage" | "rule", ... }
  switch value.kind:
    case "boolean":     return value.on
    case "percentage":  return hash(`${value.salt}:${ctx.userId}`) % 100 < value.percent
    case "rule":        return matchRule(value.rule, ctx)
```

**State Machine**

Per-flag: `unknown → cached(value) → expired → refreshing → cached(value')` ; on provider outage: `cached → lkg-fallback → cached'` once provider recovers.

**Internal Data Structures**

- `cache: Map<name, { value, fetchedAt }>` — short-TTL hot path.
- `lastKnownGood: Map<name, value>` — survives full provider outage (per-process; horizontal scale = N independent LKG sets).

**Error Handling**

- Provider timeout (`500ms`) prevents request-thread blocking.
- LKG fallback ensures stable behaviour during incidents (no flag flapping between regions).
- New flag during outage → `DEFAULT_OFF` (default-deny).
- `evaluate` is pure — exposed separately so MD-4 unit tests pin percentage/rule logic without provider mocks.

---

### MOD-072 — `FlagWebhookHandler`

- **Parent ARCH**: ARCH-036
- **Type**: HTTP Handler (provider webhook)

**Algorithmic / Logic**

```text
async function handleFlagWebhook(req, res):
  signature = req.headers["x-flag-signature"]
  if !verifyHmac(signature, req.rawBody, FLAG_WEBHOOK_SECRET):
    throw httpError(401, "WEBHOOK_SIGNATURE_INVALID")

  payload = req.body                                # { event: "flag.updated" | "flag.deleted", name, project, ts }
  if !ALLOWED_EVENTS.has(payload.event):
    return res.status(202).json({ ignored: true })

  flags.invalidate(payload.name)                    # MOD-071 cache.delete(name)
  metrics.emit("flags.cache.invalidated", 1, { name: payload.name, event: payload.event })

  return res.status(204).send()
```

**State Machine**

`N/A — Per-webhook invalidation`.

**Internal Data Structures**

`ALLOWED_EVENTS = new Set(["flag.updated", "flag.deleted", "flag.archived"])` — explicit allowlist; unknown events 202'd (acknowledged but no-op) so future provider events do not error.

**Error Handling**

- HMAC verification BEFORE any payload parsing — defends against spoofed webhooks.
- `204 No Content` on success — provider treats anything else as failure and retries.
- Cache invalidation is best-effort — next request natural-refreshes via TTL even if invalidate is missed.
- Webhook secret rotated independently of app deploys (env-managed; MOD-068 alarms surface signature failure spikes).

---

### MOD-073 — `testConventionLintRules`

- **Parent ARCH**: ARCH-037
- **Type**: Configuration (custom ESLint rule pack)

**Algorithmic / Logic**

```text
rule "kitchensink/test-file-naming":
  on file with path matching tests/** OR **/*.test.ts:
    if filename does NOT match /^(.+)\.(test|spec)\.ts$/:
      report("Test files MUST end in .test.ts or .spec.ts")

rule "kitchensink/test-colocation":
  on file with path matching src/**/*.test.ts:
    sutPath = path.replace(/\.test\.ts$/, ".ts")
    if !exists(sutPath):
      report("Colocated test has no matching SUT file: " + sutPath)

rule "kitchensink/test-describe-required":
  on file with path matching **/*.test.ts:
    if program does NOT contain top-level `describe(` call:
      report("Test file MUST have at least one top-level describe() block")

rule "kitchensink/no-skipped-tests":
  on `it.skip(` OR `describe.skip(` OR `xit(` OR `xdescribe(`:
    if process.env.CI == "true":
      report("Skipped tests forbidden in CI; remove or fix before merging")
```

**State Machine**

`N/A — Static lint`.

**Internal Data Structures**

Rule names namespaced under `kitchensink/` so they are explicitly distinguishable from third-party rules in lint output.

**Error Handling**

- Lint failures block CI (`npm run lint` exits non-zero); local `--fix` is unavailable for these rules (no autofix — naming/structure violations need human review).
- `no-skipped-tests` fires only in CI so dev-loop iteration with `it.skip` is unblocked locally.
- Rule pack has its own `tests/` directory with table-driven cases (covered later in MD-4).

---

### MOD-074 — `workspaceGuardrailsCi`

- **Parent ARCH**: ARCH-038
- **Type**: Configuration (GitHub Actions job config)

**Algorithmic / Logic**

```yaml
# .github/workflows/workspace-guardrails.yml (excerpt)
jobs:
    guardrails:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version-file: .nvmrc, cache: npm }

            - name: Install
              run: npm ci

            - name: Project references intact
              run: npx tsc --build --dry --verbose
              # tsc --build --dry exits non-zero on missing/cyclic references

            - name: Schema isolation
              run: node scripts/verify-schema-isolation.mjs
              # Asserts: only packages/db/* imports from drizzle-orm; nothing else imports schema directly

            - name: Generated types up-to-date
              run: |
                  npm run -w packages/db codegen
                  git diff --exit-code packages/db/src/generated
              # Fails if codegen output differs from committed types

            - name: Workspace dependency graph linear
              run: node scripts/verify-workspace-acyclic.mjs
```

**State Machine**

`N/A — CI pipeline`.

**Internal Data Structures**

Each step exits non-zero on violation; failure surfaces as a single PR check ("workspace-guardrails / guardrails").

**Error Handling**

- Each guardrail is independently runnable via the underlying script — devs can reproduce locally without round-tripping through CI.
- `git diff --exit-code` after codegen catches stale generated types — common drift cause.
- Cyclic-dependency check uses topological sort over `package.json` workspaces; cycle = exit 1 with the offending edges printed.

---

### MOD-075 — `withSerializable(fn)` wrapper

- **Parent ARCH**: ARCH-039
- **Type**: Function (transaction wrapper)

**Algorithmic / Logic**

```text
const SERIALIZATION_FAILURE = "40001"
const MAX_RETRIES = 3

async function withSerializable<T>(fn: (tx) => Promise<T>): Promise<T>:
  attempt = 0
  loop:
    try:
      return await db.transaction(async tx =>
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`)
        return await fn(tx)
      )
    catch (err):
      isSerializationFailure = err.code == SERIALIZATION_FAILURE
      attempt += 1
      if isSerializationFailure && attempt < MAX_RETRIES:
        await sleep(jitterBackoff(attempt))             # 25ms, 75ms, 200ms (±20%)
        metrics.emit("db.serializable.retry", 1, { attempt })
        continue
      if isSerializationFailure:
        metrics.emit("db.serializable.exhausted", 1)
      throw err
```

**State Machine**

Per call: `attempt 1 → (commit | retry) → … → attempt N → (commit | exhaust)`.

**Internal Data Structures**

`MAX_RETRIES = 3` and backoff schedule pinned as named constants — MD-4 unit tests assert exact retry behaviour.

**Error Handling**

- Only `40001` (PostgreSQL serialization failure) triggers retry — every other error propagates immediately.
- Jittered backoff prevents retry-storm convergence under contention.
- Exhausted retries surface as the original `40001` error → mapped by MOD-058/059 to RFC 7807 `CONFLICT_RETRY_EXHAUSTED`.
- Wrapper MUST be the only path that mutates concurrency-sensitive aggregates (enforced by MOD-076).

---

### MOD-076 — `txWrapperLintRule`

- **Parent ARCH**: ARCH-039
- **Type**: Configuration (custom ESLint rule)

**Algorithmic / Logic**

```text
rule "kitchensink/serializable-required":
  config: { criticalPaths: [
    "src/recipe/recipe.service.ts:saveDraft",
    "src/recipe/recipe.service.ts:patchRecipe",
    "src/circle/circle.service.ts:rotateInvitation",
    "src/circle/circle.service.ts:joinCircle",
    "src/version/versionArchive.service.ts:archiveVersion"
  ] }

  on function declaration matching any criticalPath entry:
    if function body contains `db.transaction(` directly:
      report("Critical-path mutation MUST use withSerializable, not raw db.transaction")
    if function body does NOT call `withSerializable(`:
      report("Critical-path function MUST wrap mutations in withSerializable")
```

**State Machine**

`N/A — Static lint`.

**Internal Data Structures**

`criticalPaths` is a static config array — adding a new critical mutation requires a paired rule entry (deliberate friction; reviewer must approve).

**Error Handling**

- Lint failure blocks CI.
- No autofix — wrapping in `withSerializable` may require restructuring (e.g., moving validation outside the tx) and MUST be a human decision.
- Rule scoped by file:function string — explicit allowlist prevents false positives in non-critical paths.

---

### MOD-077 — `uiPrimitiveReuseLintRule`

- **Parent ARCH**: ARCH-040
- **Type**: Configuration (custom ESLint rule)

**Algorithmic / Logic**

```text
rule "kitchensink/ui-primitive-reuse":
  config: {
    primitives:    ["Button", "Input", "Card", "Spinner", "Heading", "Text", "Modal", "Sheet"],
    primitivePkg:  "@kitchensink/ui",
    exemptPaths:   ["packages/ui/**", "packages/**/__stories__/**"]
  }

  on JSX element with name matching any primitive:
    if file path matches any exemptPaths: skip
    importedFrom = resolveImportSource(elementName, currentFile)
    if importedFrom != primitivePkg:
      report(
        `<${elementName}> must be imported from ${primitivePkg}; ` +
        `found local definition in ${importedFrom}. ` +
        `If this is intentional, add a row to packages/ui/PRIMITIVES.md and re-export from @kitchensink/ui.`
      )
```

**State Machine**

`N/A — Static lint`.

**Internal Data Structures**

`primitives` allowlist co-located with the rule — single source of truth shared with MOD-078 enforcer.

**Error Handling**

- Lint failure blocks CI.
- Exemptions narrow: only the `@kitchensink/ui` package itself and Storybook story files.
- No autofix — silent rewriting of imports could break local component variants that legitimately differ; human review required.

---

### MOD-078 — `primitivesRationaleDoc` enforcer

- **Parent ARCH**: ARCH-040
- **Type**: Configuration (CI script)

**Algorithmic / Logic**

```text
script verify-primitives-rationale.mjs:
  exports = parseExports("packages/ui/src/index.ts")
  doc     = parseMarkdownTable("packages/ui/PRIMITIVES.md")
  docRows = new Set(doc.rows.map(r => r.name))

  missing = exports.filter(name => !docRows.has(name))
  orphan  = doc.rows.filter(r => !exports.includes(r.name))

  if missing.length > 0:
    fail(`PRIMITIVES.md missing rows for: ${missing.join(", ")}`)
  if orphan.length > 0:
    fail(`PRIMITIVES.md has orphan rows (no matching export): ${orphan.map(r => r.name).join(", ")}`)

  for row of doc.rows:
    if !row.rationale || row.rationale.length < 20:
      fail(`PRIMITIVES.md row '${row.name}' missing rationale (>=20 chars required)`)

  log("primitives doc consistent: " + exports.length + " entries")
```

**State Machine**

`N/A — One-shot CI check`.

**Internal Data Structures**

`PRIMITIVES.md` table schema: `| name | since | rationale | a11y notes |` — script asserts all four columns present per row.

**Error Handling**

- CI failure on missing rows OR orphan rows OR weak rationale.
- Threshold (`>=20 chars`) deliberately low — intent is to force _some_ rationale, not gold-plate it.
- Script runs as part of `workspaceGuardrailsCi` (MOD-074) job graph.

---

### MOD-079 — `logger.info/warn/error(msg, ctx)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-041
- **Type**: Function (cross-cutting, request-scoped)

**Algorithmic / Logic**

```text
import { Logger } from "@aws-lambda-powertools/logger"
import { trace } from "@opentelemetry/api"

const base = new Logger({ serviceName: "kitchensink" })

function emit(level, msg, ctx = {}):
  span     = trace.getActiveSpan()
  spanCtx  = span?.spanContext() ?? {}
  payload  = {
    msg,
    ...ctx,
    trace_id: spanCtx.traceId,
    span_id:  spanCtx.spanId
  }
  base[level].call(base, payload)                     # JSON line to stdout

export const logger = {
  info:  (msg, ctx) => emit("info",  msg, ctx),
  warn:  (msg, ctx) => emit("warn",  msg, ctx),
  error: (msg, ctx) => emit("error", msg, ctx)
}
```

**State Machine**

`N/A — Per-call emission`.

**Internal Data Structures**

`payload = { msg, ...ctx, trace_id, span_id }` — log lines are pivotable to traces in observability tooling without manual correlation.

**Error Handling**

- Logger failures swallowed at the underlying transport — Powertools handles back-pressure on Lambda stdout.
- Context merge order: caller `ctx` is last so it CAN override defaults intentionally (e.g., redacting `user_id`).
- `error` level is the ONLY level that triggers Sentry (see MOD-084) — `warn` stays in CloudWatch only.

---

### MOD-080 — `logger.bind(scope)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-041
- **Type**: Function (cross-cutting, scope binder)

**Algorithmic / Logic**

```text
function bind(scope: { user_id?, job_id?, circle_id?, request_id? }) -> Logger:
  return {
    info:  (msg, ctx = {}) => logger.info(msg,  { ...scope, ...ctx }),
    warn:  (msg, ctx = {}) => logger.warn(msg,  { ...scope, ...ctx }),
    error: (msg, ctx = {}) => logger.error(msg, { ...scope, ...ctx }),
    bind:  (extra)         => bind({ ...scope, ...extra })
  }
```

**State Machine**

`N/A — Returns a wrapped logger; immutable scope`.

**Internal Data Structures**

`scope` is closed over; `bind` creates a new wrapped logger rather than mutating shared state — safe under concurrent requests in async contexts.

**Error Handling**

- Repeated `bind` calls are safe; later scopes deep-merge over earlier ones.
- No PII leakage path: scope is opt-in per call site; `user_id` MUST come from `req.auth.userId` (MOD-056), never from request body.
- Underlying `logger.info/warn/error` (MOD-079) handles transport failures.

---

### MOD-081 — `loadAppConfig()` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-042
- **Type**: Function (boot-time loader)

**Algorithmic / Logic**

```ts
const AppConfigSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    AWS_REGION: z.string().min(1),
    DATABASE_URL_SECRET_ARN: z.string().startsWith('arn:aws:secretsmanager:'),
    S3_BUCKET_PHOTOS: z.string().min(3),
    S3_BUCKET_VERSIONS: z.string().min(3),
    SQS_OCR_QUEUE_URL: z.string().url(),
    SQS_VERSION_QUEUE_URL: z.string().url(),
    CLERK_JWT_KEY: z.string().min(1),
    CLERK_AUTHORIZED_PARTIES: z.string().min(1),
    SENTRY_DSN: z.string().url().optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    OCR_PROVIDER: z.enum(['textract', 'mock']).default('textract'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

let cached: AppConfig | undefined;

export function loadAppConfig(): AppConfig {
    if (cached) return cached;
    const parsed = AppConfigSchema.safeParse(process.env);
    if (!parsed.success) {
        // Print AND throw — Lambda init failure is the right outcome
        console.error('CONFIG_INVALID', JSON.stringify(parsed.error.format(), null, 2));
        throw new Error('CONFIG_INVALID');
    }
    cached = parsed.data;
    return cached;
}
```

**State Machine**

`uninitialized → cached`; cache lifetime = process lifetime.

**Internal Data Structures**

`cached: AppConfig | undefined` — single module-scope variable; safe under Node single-thread model.

**Error Handling**

- Fail-fast: invalid env throws at boot, killing Lambda init → CloudFormation/CDK deploy surfaces the failure immediately.
- Zod error formatting prints field-by-field issues so ops can fix the param store entry without re-deploying to "see what's wrong".
- Schema additions are non-breaking only when they have `.default()` or `.optional()`.
- Sensitive fields (e.g., DSNs, ARNs) NEVER logged in plaintext — Zod error path prints the _path_ and _issue_, not the value.

---

### MOD-082 — `SecretsResolver.get(arn)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-042
- **Type**: Class (first-use resolver with cache)

**Algorithmic / Logic**

```ts
class SecretsResolver {
    private cache = new Map<string, { value: string; fetchedAt: number }>();
    private inflight = new Map<string, Promise<string>>();
    private ttlMs = 5 * 60_000;

    constructor(private client = new SecretsManagerClient({})) {}

    async get(arn: string): Promise<string> {
        const hit = this.cache.get(arn);
        if (hit && Date.now() - hit.fetchedAt < this.ttlMs) return hit.value;

        // Single-flight: collapse concurrent gets for same ARN
        const existing = this.inflight.get(arn);
        if (existing) return existing;

        const fetchPromise = this.fetch(arn);
        this.inflight.set(arn, fetchPromise);
        try {
            const value = await fetchPromise;
            this.cache.set(arn, { value, fetchedAt: Date.now() });
            return value;
        } finally {
            this.inflight.delete(arn);
        }
    }

    private async fetch(arn: string): Promise<string> {
        const out = await this.client.send(new GetSecretValueCommand({ SecretId: arn }));
        if (!out.SecretString) throw new Error(`SECRET_EMPTY: ${arn}`);
        return out.SecretString;
    }
}

export const secrets = new SecretsResolver();
```

**State Machine**

Per ARN: `unknown → fetching → cached → expired → fetching'`.

**Internal Data Structures**

- `cache: Map<arn, { value, fetchedAt }>` — short TTL keeps rotation responsive.
- `inflight: Map<arn, Promise<string>>` — single-flight prevents thundering herd on cold start when multiple modules await the same secret.

**Error Handling**

- Throws on empty `SecretString` so callers can fail-fast at init.
- TTL means rotation propagates within 5 minutes without redeploy.
- Secret values NEVER logged; even error paths log only the ARN.
- `inflight` map is cleared in `finally` to avoid memory leak on failure.

---

### MOD-083 — `sentry.bootstrap()` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-043
- **Type**: Function (boot-time initializer)

**Algorithmic / Logic**

```ts
import * as Sentry from '@sentry/aws-serverless';

let initialized = false;

export function bootstrap(): void {
    if (initialized) return;
    const cfg = loadAppConfig(); // MOD-081
    if (!cfg.SENTRY_DSN) {
        logger.warn('sentry_disabled_no_dsn'); // MOD-079
        initialized = true;
        return;
    }
    Sentry.init({
        dsn: cfg.SENTRY_DSN,
        environment: cfg.NODE_ENV,
        tracesSampleRate: cfg.NODE_ENV === 'production' ? 0.1 : 1.0,
        integrations: [Sentry.awsServerlessIntegration({ skip404: true })],
        beforeSend(event) {
            return scrubPii(event);
        }, // strip emails, tokens, secrets
    });
    initialized = true;
}
```

**State Machine**

`uninitialized → initialized`; idempotent — second call no-ops.

**Internal Data Structures**

`initialized: boolean` flag — Sentry SDK is itself idempotent but explicit guard documents intent.

**Error Handling**

- Missing DSN → warn + skip init (acceptable for dev/test); production CDK pipeline asserts DSN present pre-deploy.
- `beforeSend(scrubPii)` is the LAST line of defence — strips known PII fields (`email`, `phone`, `auth.token`) from every event.
- Sample rate lower in prod to control cost; 100% in non-prod for debugging.

---

### MOD-084 — `sentry.captureException(err, ctx)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-043
- **Type**: Function (cross-cutting error sink)

**Algorithmic / Logic**

```ts
import * as Sentry from '@sentry/aws-serverless';

export function captureException(err: unknown, ctx: Record<string, unknown> = {}): void {
    // Mirror to local logger for CloudWatch — even if Sentry transport fails
    logger.error('exception_captured', { err: serializeErr(err), ...ctx }); // MOD-079

    try {
        Sentry.withScope((scope) => {
            for (const [k, v] of Object.entries(ctx)) {
                if (k === 'user_id' && typeof v === 'string') scope.setUser({ id: v });
                else scope.setExtra(k, v);
            }
            Sentry.captureException(err);
        });
    } catch {
        // Sentry transport failure MUST NOT break the request
    }
}
```

**State Machine**

`N/A — Per-call sink`.

**Internal Data Structures**

`scope` is per-call (Sentry SDK guarantees scope isolation under async contexts).

**Error Handling**

- Local log emission BEFORE Sentry call — CloudWatch is the source of truth even on Sentry outage.
- `try/catch` around Sentry call — Sentry MUST NEVER break a request.
- `user_id` mapped to Sentry's `user` field for issue grouping; everything else goes to `extra`.
- `serializeErr(err)` (in `logger`) handles `Error` instances + plain values; never throws.

---

### MOD-085 — `idempotency.run(key, payloadHash, fn)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-044
- **Type**: Function (TX-aware idempotency wrapper)

**Algorithmic / Logic**

```text
async function run<T>(key: string, payloadHash: string, fn: (tx) => Promise<T>): Promise<T>:
  return await db.transaction(async tx =>
    [existing] = await tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1)

    if existing:
      if existing.payload_hash != payloadHash:
        throw new ConflictException({
          error_code: "IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD",
          detail:     "Same Idempotency-Key used with a different payload."
        })
      if existing.status == "completed":
        return JSON.parse(existing.response_json) as T
      if existing.status == "in_progress":
        # Another concurrent request is processing; reject so client can retry
        throw new ConflictException({
          error_code: "IDEMPOTENCY_KEY_IN_PROGRESS",
          detail:     "Same Idempotency-Key currently being processed."
        })

    await tx.insert(idempotencyKeys).values({
      key,
      payload_hash:  payloadHash,
      status:        "in_progress",
      created_at:    now()
    })

    try:
      result   = await fn(tx)
      await tx.update(idempotencyKeys)
              .set({
                status:        "completed",
                response_json: JSON.stringify(result),
                completed_at:  now()
              })
              .where(eq(idempotencyKeys.key, key))
      return result
    catch (err):
      # TX rollback drops the in_progress row → caller MAY retry safely
      throw err
  )
```

**State Machine**

Per key: `(absent) → in_progress → (completed | absent on failure)` ; `completed` is terminal until TTL purge.

**Internal Data Structures**

`idempotency_keys` row `{ key PK, payload_hash, status, response_json, created_at, completed_at }` — TTL purge job (operational; not in MOD scope) reaps `completed` rows older than 24h.

**Error Handling**

- `IDEMPOTENCY_KEY_REUSED_DIFFERENT_PAYLOAD` → 409: defends against client bugs that recycle keys.
- `IDEMPOTENCY_KEY_IN_PROGRESS` → 409: lets clients retry instead of double-applying.
- Rollback on failure leaves no row → safe retry semantics.
- Wrapper requires caller-provided `payloadHash` (caller hashes canonicalized request body) so we detect collisions.

---

### MOD-086 — `outbox.publish(event, tx)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-045
- **Type**: Function (cross-cutting event publish)

**Algorithmic / Logic**

```text
async function publish(event: { type, payload, key? }, tx) -> { id }:
  if !event.type || !event.payload:
    throw new Error("OUTBOX_EVENT_MALFORMED")

  [row] = await tx.insert(outbox).values({
    type:          event.type,                           # e.g., "recipe.version.archive_requested"
    payload:       event.payload,                        # JSONB
    aggregate_key: event.key ?? null,                    # for partitioned ordering
    created_at:    now(),
    dispatched_at: null
  }).returning({ id: outbox.id })

  return { id: row.id }
```

**State Machine**

Per row: `created (dispatched_at IS NULL) → dispatched (dispatched_at IS NOT NULL)`.

**Internal Data Structures**

`outbox` table indexed on `(dispatched_at IS NULL, created_at)` so the drainer (MOD-087) can pull pending rows efficiently.

**Error Handling**

- Insert MUST happen inside the caller's TX so commit semantics couple business state and event emission atomically.
- Malformed events fail-fast so we never persist a row the drainer cannot ship.
- `aggregate_key` enables FIFO ordering downstream when needed (e.g., per-recipe events).

---

### MOD-087 — `outboxDrainer.run()` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-045
- **Type**: Worker (scheduled Lambda, EventBridge per-minute)

**Algorithmic / Logic**

```text
async function run():
  loop:
    rows = await db.select()
                   .from(outbox)
                   .where(isNull(outbox.dispatched_at))
                   .orderBy(asc(outbox.created_at))
                   .limit(BATCH_SIZE)                    # BATCH_SIZE = 100

    if rows.length == 0: break

    results = await Promise.allSettled(rows.map(publishToBus))

    successes = []
    for [i, r] of results.entries():
      if r.status == "fulfilled":
        successes.push(rows[i].id)
      else:
        metrics.emit("outbox.dispatch.error", 1, { type: rows[i].type, code: errCode(r.reason) })

    if successes.length > 0:
      await db.update(outbox)
              .set({ dispatched_at: now() })
              .where(inArray(outbox.id, successes))

    if rows.length < BATCH_SIZE: break

async function publishToBus(row):
  topic = TOPIC_FOR.get(row.type) ?? DEFAULT_TOPIC
  await snsClient.send(new PublishCommand({
    TopicArn:           topic,
    Message:            JSON.stringify(row.payload),
    MessageAttributes:  { type: { DataType: "String", StringValue: row.type } },
    MessageGroupId:     row.aggregate_key ?? row.id
  }))
```

**State Machine**

Per row: `pending → dispatched` ; failed rows stay `pending` and are retried next run (no in-job retry → keeps Lambda short).

**Internal Data Structures**

`TOPIC_FOR: Map<eventType, snsTopicArn>` — explicit routing table; unknown types fall through to `DEFAULT_TOPIC` which is monitored for "unknown event type" alerts.

**Error Handling**

- `Promise.allSettled` ensures one bad event does not block the whole batch.
- Per-row failure metric (`outbox.dispatch.error`) feeds MOD-068 alarm if rate spikes.
- At-least-once delivery: SNS retry + drainer re-pull = duplicates possible → consumers MUST be idempotent.
- Backpressure handled implicitly by `BATCH_SIZE` + per-minute schedule (max 6000 events/min sustained).

---

### MOD-088 — `tracing.init({ serviceName, exporter })` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-046
- **Type**: Function (boot-time OTel initializer)

**Algorithmic / Logic**

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

export function init(opts: { serviceName: string; exporterUrl?: string }): void {
    if (sdk) return;
    sdk = new NodeSDK({
        resource: new Resource({
            [SemanticResourceAttributes.SERVICE_NAME]: opts.serviceName,
            [SemanticResourceAttributes.SERVICE_VERSION]: process.env.GIT_SHA ?? 'unknown',
        }),
        traceExporter: new OTLPTraceExporter(opts.exporterUrl ? { url: opts.exporterUrl } : {}),
        instrumentations: [
            getNodeAutoInstrumentations({
                '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy + low value
            }),
        ],
    });
    sdk.start();
    process.on('SIGTERM', () => sdk?.shutdown().catch(() => {}));
}
```

**State Machine**

`uninitialized → started → (running) → shutdown` on SIGTERM.

**Internal Data Structures**

`sdk: NodeSDK | undefined` — module-scope singleton; idempotent `init()`.

**Error Handling**

- Disable noisy instrumentations (`fs`) — high cardinality with zero diagnostic value in this service.
- SIGTERM handler attempts graceful flush; failures swallowed (Lambda lifecycle terminates anyway).
- Exporter URL defaulted by SDK env (`OTEL_EXPORTER_OTLP_ENDPOINT`) so most envs need no explicit override.
- `GIT_SHA` resource attribute lets us pivot from a span to the exact deployed commit.

---

> **MD-3j status**: MOD-081..MOD-088 complete (88/91). Continued in MD-3k with MOD-089..MOD-091.

### MOD-089 — `tracing.withSpan(name, fn)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-046
- **Type**: Function (tracing helper)

**Algorithmic / Logic**

```ts
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

const tracer = trace.getTracer('commise');

export async function withSpan<T>(
    name: string,
    fn: (span: import('@opentelemetry/api').Span) => Promise<T>,
    attrs: Record<string, string | number | boolean> = {},
): Promise<T> {
    return tracer.startActiveSpan(name, async (span) => {
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
        try {
            const out = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return out;
        } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
            throw err;
        } finally {
            span.end();
        }
    });
}
```

**State Machine**

`startActiveSpan → (attrs set) → fn() → OK | ERROR → end`. Span lifetime is bounded by `fn` — no leakage into caller context once `end()` runs.

**Internal Data Structures**

- Module-scope `tracer` — single tracer instance per process keyed by service name (`commise`).
- Span attributes set from `attrs` map before `fn` runs so they appear on the span even if `fn` throws synchronously.

**Error Handling**

- Errors are recorded on the span (`recordException` + `ERROR` status) and re-thrown unchanged — wrapper is transparent to callers.
- `span.end()` runs in `finally` so spans cannot leak under any throw / reject path.
- Caller-supplied `attrs` are restricted to OTel-supported scalar types; complex objects MUST be stringified by the caller (no JSON.stringify here — span attribute size cap risk).
- Used by MOD-019 OCR worker, MOD-029 import job, MOD-044 search query, etc. — wrapping ARCH boundaries gives clean span hierarchy without per-call boilerplate.

---

### MOD-090 — `db` Drizzle client factory [CROSS-CUTTING]

- **Parent ARCH**: ARCH-047
- **Type**: Function (singleton pool factory)

**Algorithmic / Logic**

```ts
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { loadAppConfig } from "../config";        # MOD-081
import { SecretsResolver } from "../secrets";     # MOD-082

let pool: Pool | undefined;
let client: NodePgDatabase<typeof schema> | undefined;

export async function db(): Promise<NodePgDatabase<typeof schema>> {
  if (client) return client;
  const cfg = loadAppConfig();
  const password = await SecretsResolver.get(cfg.dbSecretArn);
  pool = new Pool({
    host: cfg.dbHost,
    port: cfg.dbPort,
    database: cfg.dbName,
    user: cfg.dbUser,
    password,
    max: cfg.dbPoolMax,                  # tuned per Lambda concurrency budget
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: true }
  });
  pool.on("error", err => {
    // unhandled idle-client error — surface to Sentry; pool will reap
    require("../sentry").captureException(err, { scope: "pg.pool" });   # MOD-084
  });
  client = drizzle(pool, { schema });
  return client;
}
```

**State Machine**

`uninitialized → (await secret) → pool created → drizzle bound → ready`. Once `client` is set the function returns synchronously on the cached path. Pool is process-scoped; reused across Lambda invocations within a warm container.

**Internal Data Structures**

- `pool: Pool | undefined` — `pg` connection pool, lazily constructed.
- `client: NodePgDatabase<typeof schema> | undefined` — drizzle client bound to schema.
- `cfg.dbPoolMax` derives from `loadAppConfig` (MOD-081); chosen so `dbPoolMax × maxLambdaConcurrency ≤ RDS max_connections − reserved`.

**Error Handling**

- Secret resolution failures bubble — Lambda will fail fast and the cold-start error is captured by Sentry via the bootstrap (MOD-083).
- `pool.on("error")` traps idle-client failures (e.g., RDS failover) — Sentry-tagged, pool auto-reaps the dead client.
- `connectionTimeoutMillis: 5_000` — bounded so request handlers cannot hang on a wedged pool.
- `ssl.rejectUnauthorized: true` — guards against MITM on the VPC <-> RDS path.
- Pool is intentionally not closed in handlers — Lambda freeze/thaw lifecycle reuses it; AWS SIGKILL on container shutdown reclaims sockets.

---

### MOD-091 — `db.transaction(async (tx) => ...)` [CROSS-CUTTING]

- **Parent ARCH**: ARCH-047
- **Type**: Function (transaction wrapper)

**Algorithmic / Logic**

```ts
import { withSerializable } from "./tx-wrapper";   # MOD-075
import { db } from "./client";                     # MOD-090

type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db();
  return withSerializable(async () =>
    client.transaction(async tx => {
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      return fn(tx);
    })
  );
}
```

**State Machine**

`begin → (statements) → commit | rollback`. `withSerializable` wraps with retry-on-`40001` (serialization failure) — bounded retries (3) with jittered backoff, then surface.

**Internal Data Structures**

- `Tx` — drizzle transaction handle; passed to caller `fn`. All ARCH-005/014/018/021/022/023/044/045 writes funnel through this so the lint rule (MOD-076 `txWrapperLintRule`) can ban raw `client.transaction` calls.
- `idle_in_transaction_session_timeout` (5s) and `statement_timeout` (10s) are set per-transaction via `SET LOCAL` so a wedged caller cannot pin a connection or block VACUUM.

**Error Handling**

- Serialization failures (PG `40001`) are retried by `withSerializable`; deadlock (`40P01`) likewise. After bounded retries the error surfaces to the caller.
- Any throw inside `fn` triggers drizzle rollback automatically; we do not swallow.
- `SET LOCAL` timeouts apply only inside the TX so other queries on the same pooled connection are unaffected after commit/rollback.
- Outbox writes (MOD-086 `outbox.publish(event, tx)`) MUST receive this `tx` so the event row commits atomically with the domain change — enforced by MOD-076.
- This wrapper is the single sanctioned way to begin a transaction; CI fails any direct `client.transaction(` outside this module.

---

> **MD-3k status**: MOD-089..MOD-091 complete. **MD-3 done — 91/91 MOD bodies authored.** Next: MD-4 (cross-cutting concerns recap), MD-5 (Coverage Summary + Derived Modules + Glossary closeout).

## Coverage Summary

> TBD MD-5 — forward `ARCH → MOD` matrix (47 ARCH rows, 91 MOD entries), reverse `MOD → ARCH` integrity check, cross-cutting tally, and confirmation that all `[FROZEN-PENDING-RESOLUTION]` markers from `architecture-design.md` are mirrored in the relevant MOD Error Handling views.

## Derived Modules

> TBD MD-5 — none expected. All MOD-NNN trace to a parent ARCH-NNN; cross-cutting modules inherit the `[CROSS-CUTTING]` tag from their parent ARCH. Any MOD that cannot be traced MUST be flagged `[DERIVED MODULE: <reason>]` and reconciled by updating `architecture-design.md` first.
