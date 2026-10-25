# KitchenSink agent guide

GitHub Copilot code review, CodeRabbit, Qodo, and Devin ingest this file as
authoritative context. **Treat the rules below as self-contained:** not every
reviewer reads `CLAUDE.md` or follows links. Devin also reads `CLAUDE.md`, but
large rule files can be truncated; agents able to read files must open the
relevant section from disk before working. It contains detailed reasoning and
historical postures later superseded; use the latest explicit ruling and check
the current code. The ADRs under `docs/architecture/decisions/` govern settled
architecture. Never replace a specific ruling with a generic best practice.
Keep claims accurate: `packages/tools/repoGuards/__tests__/reviewerContext.test.ts`
checks unambiguous backticked package claims in the technology section and
that deliberate ADRs are surfaced, **not** that their constraints survived a
rewrite. Keep this root file below Devin's 32 KiB per-rule limit, but do not
strip a rule merely because its ADR number remains mentioned.

## Before making changes

- Own the production outcome, not just a green diff. Challenge the spec and
  existing code; trace consumers, failure paths, concurrency, security,
  operability, and rollback. Prefer the smallest complete solution, not a
  shortcut that omits current requirements. Prefer maintained libraries to
  hand-rolled parsing, retries, date math, crypto, or validation.
- Read the applicable spec/plan and ADR before writing. Before modifying code,
  read the relevant part of `docs/engineering/ENGINEERING_EXCELLENCE.md`:
  backend/frontend excellence plus design patterns for production code, and
  test excellence for any test or test review. Read
  `docs/CODING_STANDARDS.md` for naming, purity, JSDoc, and test tiers.
- Tests precede implementation: write acceptance-derived tests, see them fail,
  then implement and see them pass. UI: component tests for all states plus
  Playwright (web) and Maestro (mobile) per story. Non-UI: unit and integration.
  HTTP services also require e2e and k6; migrations require a real-DB LOCAL
  e2e. Integration tests mock databases; only e2e uses a real database. LOCAL
  e2e runs on a developer machine via `npm run test:e2e`, not in CI; deployed
  e2e targets a deployed sandbox and may skip when it is down. Never claim a
  local suite proves a deploy or report a skipped suite as passed. Do not
  weaken an existing test merely to compile; replace it with evidence for
  the new behavior or explain where the coverage moved. See
  `docs/CODING_STANDARDS.md` sections 7.1 and 7.1a.
- For non-trivial changes, do an architecture **plan, blueprint, and
  adversarial review** before finishing; use design patterns where their
  contract fits, not invented scaffolding. Design user-facing flows before
  building them; specify all loading, empty, error, gated, and offline states
  and evaluate implementation against the spec. Use the shared design system,
  localize every user-facing string, and translate the _job_ to mobile rather
  than copying a desktop layout. Run a code-health gate before non-trivial
  commits/pushes. Follow `CLAUDE.md`'s named design/UX/code-health agents
  where available; otherwise do the equivalent analysis and report the gap,
  not a fictitious invocation.
- Preserve other people's work. Verify empirically, report which tiers ran
  and which did not, and flag any remaining uncertainty. Conventional commits
  use `<type>(<scope>): <description>`.

## Active Technologies

- Turborepo with npm workspaces under `packages/`. Inspect each package's
  `package.json` for its actual scripts. Root commands: `npm run build`,
  `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`.
- Node 24 (`.nvmrc`); TypeScript 6. Web: Next.js 16 App Router, React 19,
  Tailwind v4. Mobile: Expo 57, React Native 0.86 (new architecture). Backend:
  NestJS 11, Drizzle, PostgreSQL 18. Infrastructure: CDK v2, ECS/Fargate,
  RDS, S3, SQS, CloudFront. Auth is Clerk, not Auth0: `@clerk/nextjs`,
  `@clerk/expo`, `@clerk/backend`, `expo-secure-store`. Services use
  `@aws-sdk/client-s3` and `@aws-sdk/client-sqs` where needed. Input
  validation uses `nestjs-zod`'s `ZodValidationPipe`, not Nest's
  `ValidationPipe` for `createZodDto`.
- Lambda@Edge uses Node 22 because it cannot run Node 24; other Node Lambdas
  run Node 24. Do not copy Edge's runtime into regular functions.
- Services verify signed Clerk **session tokens** themselves, with `azp`
  enforcement. An ALB-facing service must never trust a caller-supplied
  authorizer header. There is no API Gateway JWT authorizer for these routes.

## Conventions

- Use named exports except framework-required defaults; type-only imports,
  `process.env['KEY']`, ISO strings in interfaces, and `@sideEffect` on impure
  functions. Custom errors extend `Error` with `Object.setPrototypeOf` and an
  `is*` guard. Keep TypeScript strict: no `any` or TypeScript error
  suppressions (`@ts-ignore`, `@ts-expect-error`). Organize by domain, not
  `helpers/` or intra-package barrels except package exports
  and documented schema-namespace/generated exceptions. Relative import
  suffixes depend on the package's module resolution.
- Keep pure functions/components pure. Component/module JSDoc uses `@pattern`
  for the enforced design-system, behavior-switching, orchestration, and
  ref-using cases (`docs/CODING_STANDARDS.md` section 11.2). Do **not** stamp
  a vacuous pattern tag on every render-only leaf. Refs are reserved for
  genuinely external imperative systems; moving one into a hook does not
  remove its obligation to explain the pattern.
- Every user-facing feature ships on web and mobile together. Platform files
  use `.native.ts(x)`, not `.mobile.*`. Shared logic, types, and clients live
  in shared packages (`docs/CODING_STANDARDS.md` section 14). In the web app,
  read its nested `AGENTS.md` and installed Next.js docs before using APIs.
- `noUncheckedIndexedAccess` is off: an array/record index can be absent
  despite its static type. Do not delete a missing-row guard, `?.`, or `!`
  merely because a linter calls it unnecessary; inspect the runtime access.

## Architecture tripwires

These rulings are inlined so a reviewer can apply them without opening another
file. Agents changing an affected boundary must still read the full ADR and
relevant `CLAUDE.md` section, then check the current implementation.

### Platform, deployment, and operations

- **ADR-0033 / 0001:** PR previews use `pr-{N}.sandbox.commise.app` at `/`;
  the old path form and apex root 404 by design. Keep sandbox's **anchored**
  Clerk `azp` regex: its dev instance reflects arbitrary origins, so this is
  the trust boundary. Preview DNS must resolve directly to Vercel, not through
  CloudFront. Legacy apex acceptance during `transition` is not permission
  to disable `azp`. While sandbox is up, each PR push must bind the address
  to the deployment for that PR HEAD commit, never simply the latest branch
  deployment; no push may wake a down sandbox.
- **ADR-0002:** Prod VPC is 10.0.0.0/16, sandbox 10.1.0.0/16. Changing prod's
  CIDR or VPC construct IDs can replace the VPC and RDS without a snapshot.
- **ADR-0003:** One shared ALB per stage; services import its HTTPS listener
  and use the shared priority allocator (`shared/infra/src/alb`). No per-service
  ALB or independently invented rule priority. Listener rules require unique
  priorities; unmatched hosts receive a fixed 404.
- **ADR-0004:** VPC Lambdas egress through the `t4g.nano` NAT instance;
  public-subnet Fargate egresses via IGW. Do not replace NAT with a Gateway or
  add paid VPC interface endpoints as a workaround; free gateway endpoints
  are a separate case.
- **ADR-0005:** Teardown scopes by delimiter-aware `pr-{N}` name matching
  and exact allowed environment-tag values in `.github/scripts/prScope.sh`.
  There is **no denylist**: never name/tag a persistent resource as a PR
  resource. Never widen to a bare prefix, invent a second matcher, or add an
  orphan sweep. Claim the Vercel preview domain before publishing DNS; on
  teardown remove DNS before releasing the claim. A failure stops the sequence.
- **ADR-0006:** Per-PR features share a base-stage platform but have their
  own stage and logical database. Do not infer that a shared RDS means a
  shared per-PR database or cleanup scope.
- **ADR-0060:** Sandbox starts only by hand through Sandbox Up. Midnight is
  the only scheduled stop; non-prod scheduled rules start disabled and the
  scheduler `sync` is the sole writer of their state. CI jobs skip when down.
- **ADR-0061:** After the midnight stop, reclaim deletes unused PR stacks,
  then shared tier only when safe; preserve its bounded IAM grant, no VPC,
  no role passed to `DeleteStack`, and shell-matcher parity.
- **ADR-0008:** Non-prod RDS uses gp3 and Fargate Spot; prod retains gp2 and
  on-demand. The account budget is account-scoped, not a PR resource.
- **ADR-0010 / 0036:** Per-PR service deploys are ensure-exists (changed,
  forced, missing/unhealthy, or stale, including a missing food catalog seed),
  not path-only and not unconditional.
  Food's unauthenticated 401 **passes** the smoke, but an unauthenticated 2xx,
  shared-ALB 404, transport error, or 5xx fails. The ecosystem join owns
  food-before-recipe availability; recipe-only PRs still need food deployed.
- **ADR-0032:** A deployed e2e suite tests the deployed ecosystem, not a
  locally booted stand-in; do not use local results as evidence of deployment.
  Unit + mocked integration + guards are CI's merge gate. A deployed suite
  skips when sandbox is down; green checks can mean **no deployed e2e ran**.
  The local real-DB suite runs only on a developer machine, never in CI.
  k6 on a tiny PR preview detects correctness regressions, not prod capacity.
  Follow the later local-vs-deployed ruling in `CLAUDE.md` section 7.1a.
- **ADR-0035 / 0022:** Each DB has a separate schema stack. Deploy schema,
  invoke its migration runner with required `expectManifestSha`, then deploy
  readers. No service-stack CDK migration trigger or migrate-before-runner
  deploy (which silently runs old SQL). Migrations are ordered `.sql` files
  discovered automatically and tracked by filename; never edit an already
  applied migration. Ship **expand first** and contract a release after the
  last old-code reader. Do not replace the digest with a shared implementation
  on both sides: independent computations detect a common-mode mistake.
- **ADR-0039 / 0051:** Database owner, IAM migrator, and DML-only service
  roles are distinct; food seed has its own role. No service uses the master.
  Never put master on a membership chain to `rds_iam` (lockout); count **all**
  membership edges, including ADMIN-only rows. Do not weaken the bootstrap's
  membership re-check before every grant. Only role-model bootstrap and the
  non-prod reaper read the master secret; only the reaper drops a database.
- **ADR-0062:** Every custom metric includes `Stage`; alarm topics notify a
  single relay Lambda per base stage. Keep the relay outside the VPC, let it
  throw on failure rather than route through a swallow-on-no-op wrapper, and
  preserve its imported function ARN. Fingerprints use names, never text.
- **PostgreSQL 18 rollout:** This is a one-way major upgrade, not a config
  cleanup. `prod-deploy.yml` deploys global infra on merge; RDS can upgrade
  immediately. Before an engine/stack change, run
  `docs/runbooks/pg18Upgrade.md`'s HALT gates and rehearse restoration from
  a snapshot; there is no in-place downgrade and the prod stack has no
  automatic replacement snapshot (ADR-0002).

### Contracts, authorization, and persistence

- **ADR-0009:** Web/mobile sign-out uses the shared verified command;
  `useClerk().signOut` can resolve while still queued. Do not clear cookies
  manually or drop the post-condition that the Clerk session ended.
- **Signed-out front door:** There is no welcome/interstitial screen on either
  platform. Signed-out users go straight to sign-in; sign-up must remain
  reachable from that sign-in surface.
- **ADR-0011:** `/api/{version}/*` is canonical; keep deprecated
  `/{version}/*` alias until external Clerk webhook configuration is migrated.
- **ADR-0014 / 0015:** Services own zod wire schemas in `src/**/*.schema.ts`;
  `packages/schemas/*` are committed **literal copies** of runtime zod;
  OpenAPI is derived output, never an input to generate types. A
  `*.schema.ts` may import `zod`, flat sibling `*.schema.ts` modules, or
  explicitly justified zod-only leaf dependencies admitted by the service's
  import allowlist; **never server code**. Turbo's
  `$TURBO_ROOT$` `inputs`, not a `dependsOn` edge, close the
  client → schema → service → client cycle. Clients import and parse received
  wire shapes; third-party API clients validate their own external boundaries
  and may define their own upstream types. Parse incoming
  HTTP/event/queue/webhook data once at ingress with service-owned zod and
  `nestjs-zod`'s `ZodValidationPipe` (`createZodDto` has no `class-validator`
  metadata). Signature proves origin, not shape. Validate bounded-column
  inputs; request values never become `sql.raw()` fragments. Server-side
  response validation is **deferred**; consumer-side parsing is required.
- **ADR-0016:** Notification retention is ACK or 72h, whichever comes
  first; neither retries nor duplicate publishing refresh the clock. Pending
  dedup uses SHA-256 of RFC 8785 canonical
  `{schemaVersion,recipient,messageType,producer,payload}` (not
  `occurredAt`) and releases on ACK; `(producer,idempotencyKey)` claims
  survive ACK. Use a maintained JCS library, not hand-rolled canonical JSON:
  array order is retained, absent differs from `null`, bytes are exact, and
  unsafe numeric round trips are rejected. Duplicates return the original id
  without touching its TTL. ACK is batched/idempotent per **user**, not device;
  unknown/other-user ACKs settle without leaking existence. ElastiCache
  durability is opt-in and **off by default**, an accepted loss risk, not
  guaranteed delivery; there is one cache per stage with PR-prefixed keys.
- **ADR-0017 / 0019:** Respect established service owners; do not create a
  new service merely to isolate a feature. Features 006/007/009 extend
  recipe-service; 010 extends identity/identity-webhooks. Schema packages
  are per **service**, not feature. A split could break DB-level recipe
  cascades and adds per-stage/PR cost. The ingredient parser is the deliberate
  Python Lambda exception and owns no database.
- **ADR-0018:** Table names have one owner; Stripe delivery dedup uses
  `stripe_webhook_events`, not Clerk's `webhook_events`. Specs define each
  task ID only once. Do not merge sender dedup into one live table or relax
  Clerk's `identity_id NOT NULL` constraint. Feature 011 uses recipe's
  existing `recipe_versions` through its service client, not a second table.
- **ADR-0023:** Imported-public recipe provenance is a field-level policy,
  authorized by `recipes:import:public`, not a route guard: the create route
  stays open to all signed-in users. Only creation may declare
  `imported_public`; update must not reclassify a recipe, and
  `imported_physical`/`imported_paid` cannot be caller-declared. The cookbook
  corpus is operator-downloaded, never runtime-fetched from Gutenberg:
  robots.txt allowance does not grant permission under the site's terms.
- **ADR-0024:** Bedrock's prod $100/month hard cap reserves worst-case spend
  atomically in recipe PostgreSQL before invocation and settles once using
  the reservation's UTC period. **Never retry settlement** (a double refund
  undercounts); a call with no billed response refunds fully. Bound input
  tokens and explicit `maxTokens`, reject over-cap input rather than truncate.
  Budget alerts, concurrency limits, or post-call-only accounting are not a
  spending boundary; counter failure closes the gate. Ceiling denial and
  unreadable counter are transient retries/DLQ, not verified disagreements.
  IAM restricts invocation to the single gated role; a metric emitted by that
  role cannot detect its own bypass. Do not add Gemini to a Bedrock-only roster.
- **ADR-0025:** Python ingredient-parser Lambda stays outside the VPC and
  ships its runtime assets (including the NLTK corpus, avoiding a runtime
  download to Lambda's read-only filesystem). Do not disguise it as a
  provider, move it to a container to appease an unrelated guard, or attach
  it to the NAT merely for consistency.
- **ADR-0026:** CRF and LLM parse the original ingredient line independently;
  `buildParsePrompt` takes **only the line**; never give the LLM the CRF
  answer or turn the independent legs into a retry chain. A missing engine
  is `single-engine`, not `differ`. The CRF's `foundation_foods` is never
  trusted for identity (the resolution cascade owns it). A conjunction sums
  stated measures (`2 cups and 1 tablespoon`); a parenthetical restatement
  (`1 pound (about 4 cups)`) does **not**; a conjunction needs a following
  digit to avoid losing `one and one-half`. A missing CRF unit is absence,
  not disagreement; when **both** engines state different units the existing
  CRF-wins rule still applies. An LLM unit rescue also takes the LLM's
  **stated** quantity, but must not erase a CRF amount when the LLM states
  none. Size words such as `large` can be valid units; a number can never
  be a unit.
  Vessel role depends on position: leading a measure is a unit, after a
  preposition an instruction. Segmentation changes require a **whole-corpus
  diff** (unit tests missed real deleted ingredients). Keep orchestration
  in `recipe-import-core` and the Bedrock leg in `recipe-workers`, the only
  authorized invoker. `ParseEngine` has one definition; human corrections
  use `ParseFactSource`, not a widened parse-cache engine enum. Do not
  replace the ruled modifier lexicon with a generic POS tagger.
- **ADR-0027:** Ingredient phrases in specified resolution tables persist
  across user erasure under the owner's ruling. `user_id` counts distinct
  contributors and authorizes private corrections; do not reintroduce an
  erasure sweep without revisiting the privacy ruling. Keep `user_id` and
  `source_phrase`/`source_line` nullable where corroboration/backfilled rows
  require it; preserve the partial unique index through rename, not a
  drop/recreate window that admits concurrent duplicates. An applied SQL
  migration is never edited (the runner records filename, not checksum).
  Revisit this ruling if an identity-to-user mapping can be reintroduced
  after erasure; the surviving ULID is a conscious residual privacy risk.
- **ADR-0029:** User-authored foods are user-owned substances; USDA remains
  the catalog writer. Authored foods stay private until a human operator
  approves promotion; provenance is the route, not a caller-supplied source
  field. Per-author dedup must not collapse into catalog dedup. Erasure
  deletes unreferenced foods or orphans referenced ones. A recipe is a
  method, never written back as a food or logged as a substance.
- **ADR-0030:** Analytics has one first-party event store with distinct
  ingestion doors and **INSERT-only** lifetime-count trigger; erasure
  anonymizes (null `user_id`, blank `query_text`) without decrementing
  counts. Server emits save/view credit on a _new_ membership/detail read;
  the client door admits only `query_outcome`, with no actor field. Dedup
  client events by event id; retention sweeps events after six months, not
  accumulated lifetime counts. Client-asserted pick data must not drive
  automated rankings or user-visible metrics without an integrity bar.
- **ADR-0034 / ADR-0058:** First publication starts version history; a never-
  published draft updates in place, using `first_published_at`, not current
  `status` or a caller-provided skip flag. Once published, draft edits still
  version.
- **ADR-0047:** Browser-facing services share `resolveCorsPolicy` derived
  from the Clerk authorized parties. It assumes bearer-only ingress; do not
  add cookie/session auth or WebSocket upgrades to adopters, or reflect all
  origins when the party list is empty.
- **ADR-0056:** Native navigation uses React Navigation 7, per-tab stacks
  and the app tab bar. The back-intercept provider remains _outside_ the
  navigation container so an open sheet consumes Back before a stack pop.
- **ADR-0057:** Device drafts and the single-writer outbox have fixed v1
  formats; unknown create outcome is parked, not blindly resent. Deletes
  alone are retry-safe after unknown outcome under the current 404 contract.
  Web draft and journal both live in `sessionStorage`; do not move just the
  journal to a different lifetime or re-send a parked create on reload.
- **ADR-0059:** Settings are nullable typed columns in identity; NULL means
  never chosen. Defaults are resolved in code, GET does not write, and
  erasure removes settings. Do not use JSONB or local browser preferences.

## Rules for new code and specifications (GR-017–GR-021)

These bind _new_ code and may have no nearby example yet; other AI reviewers
cannot depend on following a link to discover them.

- **GR-017, new service on its first commit:** author zod in the service;
  supply `contract:generate`, a committed per-service schema package with
  runtime schemas, `z.infer` types, `CONTRACT_HASH` and derived `openapi.yaml`;
  assert the hash at **boot**, bind `nestjs-zod`'s `ZodValidationPipe`, parse
  every non-HTTP ingress, and provide unit, integration, e2e, and k6 tests.
  A new client/app declares **no** independent wire type for one of our
  services: import its schema/type, validate responses when received and
  outbound bodies against the callee's zod, and detect contract skew. Derive
  genuinely different consumer views with `Pick`/`Omit`/`Partial`.
- **GR-017, input/storage parity:** use `z.strictObject()` by default for
  mutating bodies: silently discarding an unknown field can turn a partial
  write into a false 200. A plain `z.object()` needs a documented reason
  at its schema. Assert input limits against bounded DB columns in a
  per-service parity test enumerating columns **from Drizzle**, with
  field-to-column mappings checked complete both ways. The production
  wire schema must never derive from or import the storage schema. Do not
  accept `@Body() body: unknown` and make parsing optional inside a
  controller method; one boundary error path must identify the invalid field.
- **GR-018, one rejection path:** invalid event/webhook data never reaches a
  job or a DB row and must not be retried as though it were a transient
  dependency failure. Reject via one code path/response shape and a typed
  `reason`; record it in the response body and structured logs, count per
  reason, and alarm. Distinguish _permanent shape failure_ from
  _potentially recoverable signature failure_: for Clerk/svix and Stripe,
  `WEBHOOK_REJECTION_STATUS` maps `shape` → **200** (acknowledge delivery,
  drop invalid content), `signature` → **401** (preserve the retry window,
  and do not acknowledge a forgery). Do not collapse the statuses or add a
  second branch. Internal callers return 400/403; an unowned ingress
  dead-letters once and alarms on DLQ depth. A rejected event has no
  trustworthy ID: logs/metrics/DLQ, not a row with an invented identifier,
  are its record.
- **GR-019, identifiers:** never use `'unknown'`, `'none'`, `''`, `'n/a'`, or
  `0` as an ID in storage, wire, map, metrics, or branching. An ID is
  required at use; a create/upsert generates one when absent. A legitimately
  absent relationship is `NULL` / `| null`, and an unresolvable required ID
  is rejected, never replaced with a sentinel.
- **GR-020, dual principal:** if a token `sub` or EventBridge `source` and
  a payload both assert a principal, require **both** and reject a mismatch.
  Resolve the transport identity through a committed, injective registry
  asserted at boot. Never authorize using the payload assertion alone.
- **GR-021 / ADR-0018, owners:** a table name has one declarer across
  features and shipped packages, **even across logical databases**. Reuse
  an existing table through its owning service rather than issuing a
  second `CREATE TABLE` or foreign DDL. A spec declaration uses fenced DDL;
  prose alone is only a reference, invisible to the collision gate. Each
  `tasks.md` task ID has exactly one definition carrying its done-state;
  later mentions are pointers, not new checkboxes. Discover packages,
  tables, and tasks rather than freezing a list; parse syntax rather than
  trusting a text match that may hit a comment or miss multiline DDL.
  Exceptions need a substantive written `why` and an exact set of owners;
  an exempted drifted duplicate is a recorded defect, not a pattern.

## Feature status

`CLAUDE.md`'s managed Spec Kit section holds the current feature gates; read
it before working on a numbered feature. In particular, 019 Offline Mode has
an unresolved Clerk offline-auth opening decision (OQ-1): do not implement
that gate until the owner decides. 015 Publishing Rewards is planned but its
implementation is intentionally stopped on documented blockers. Avoid
copying volatile task lists or progress into this always-on file.
