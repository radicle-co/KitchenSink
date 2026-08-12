# Technical Plan: Feature 010 — Subscriptions & Monetization

**Feature**: `010-subscriptions`
**Status**: Active — product decisions closed 2026-05-10; implementation not yet started

---

## 1. Architecture Overview

### System Context

```
User clicks "Upgrade" → Backend creates Stripe Checkout Session
    ↓
Stripe-hosted payment page
    ↓
checkout.session.completed webhook → provision subscription in DB
    ↓
User on premium: @RequirePremium() decorator gates all FR-041 features
    ↓
Ongoing: invoice.paid / updated / deleted webhooks keep DB in sync
    ↓
User manages via Stripe Customer Portal (no custom UI needed)
```

### Stripe Billing Stack

| Component               | Technology                                  | Rationale                                                   |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Checkout                | Stripe Checkout (hosted)                    | PCI-compliant; no custom payment UI                         |
| Subscription management | Stripe Customer Portal                      | Handles upgrade/downgrade/cancel; no custom UI              |
| Webhook handling        | `@golevelup/nestjs-stripe` v3.0.0           | NestJS DI, auto signature verification, decorator routing   |
| Idempotency             | `webhook_events` table                      | Stripe retries for 72h; must be deduplicated                |
| Feature gating          | `@RequirePremium()` decorator + `PlanGuard` | Runs after `AuthMiddleware` (Clerk); fails closed, testable |

### Subscription States

```
free ──────────────────────────────────────────────────→ premium
  │                                                               │
  │  checkout.session.completed                                   │ customer.subscription.deleted
  │                                                               │
  ▼                                                               │
trialing (14 days) ──────→ active ──────→ past_due (grace 7d) ──→ canceled
                            │                    │
                            │ invoice.payment_    │ user updates
                            │ failed              │ payment method
                            ▼                    ▼
                       active               active
```

---

## 2. Data Model

### Account Entity Additions (002-user-auth)

```typescript
// Add to existing Account entity
@Column({ type: 'varchar', default: 'free' })
plan: 'free' | 'premium';

@Column({ type: 'varchar', default: 'inactive' })
subscriptionStatus: 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive';

@Column({ type: 'varchar', nullable: true })
stripeCustomerId: string | null;

@Column({ type: 'varchar', nullable: true })
stripeSubscriptionId: string | null;

@Column({ type: 'timestamptz', nullable: true })
currentPeriodEnd: Date | null;

@Column({ type: 'boolean', default: false })
cancelAtPeriodEnd: boolean;

@Column({ type: 'timestamptz', nullable: true })
trialEndsAt: Date | null;
```

### webhook_events Table (Idempotency)

```sql
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  VARCHAR(255) UNIQUE NOT NULL,
  event_type      VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'processing',  -- processing | processed | failed
  error           TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhook_events_stripe_event_id ON webhook_events(stripe_event_id);
CREATE INDEX idx_accounts_stripe_customer_id ON accounts(stripe_customer_id);
CREATE INDEX idx_accounts_stripe_subscription_id ON accounts(stripe_subscription_id);
```

---

## 3. API Contracts

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

**010 straddles the rule, and getting the two halves backwards here is expensive.** `/api/v1/billing/*` is
**ours** (§15-b: converge it). **Stripe is not** (§15-d: never converge it). The webhook endpoint has one of
each in the same request: the **inbound body is Stripe's**, the **response is ours**.

✅ **RESOLVED (2026-08-12) — `/api/v1/billing/*` is owned by `@kitchensink/identity-service`, and the Stripe
webhook by `@kitchensink/identity-webhooks`**, per
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md).
**No new deployable service is created for 010.**

| Role                                  | Binding for 010                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)  | `@kitchensink/identity-service` — `packages/services/identity/src/billing/*.schema.ts`       |
| Schema package (generated, committed) | `@kitchensink/schema-identity` — `packages/schemas/identity`, **extended, never forked**     |
| Stripe webhook handler                | `@kitchensink/identity-webhooks` — **not** the ECS API; see below                            |
| Consuming client                      | the identity consumer named by **002's own OPEN item** — see the note below the table        |
| Consuming apps                        | `@commise/web` (the primary billing surface), `@commise/mobile` (deep-links to web checkout) |
| NestJS module (internal boundary)     | `BillingModule`, inside the identity service                                                 |

⚠️ **The consuming client is still 002's question, and 010 does not pre-empt it.** 002's plan carries its own
🟠 **OPEN**: either **(a)** introduce `packages/clients/identity` and have `@commise/features-account` wrap it,
or **(b)** have `@commise/features-account` import `@kitchensink/schema-identity` directly and remain the only
consumer. Neither is decided, and **no `packages/clients/identity` exists today**. Whichever lands, the client
obligation below is unchanged — it is about who **authors** a wire shape, not which directory it lives in.

**The one-line reason, specific to 010**: **the entitlement is a column on identity's `accounts` row.**
`accounts.subscription_tier` already ships (`text`, `notNull`, default `'free'`, in
`packages/shared/identity-db/src/schema/accounts.ts`), and 010's `plan` / `subscriptionStatus` /
`stripeCustomerId` / `stripeSubscriptionId` / `currentPeriodEnd` / `cancelAtPeriodEnd` / `trialEndsAt` all go on
that **same row** — so a separate billing service would be a **second writer** to it, which is the exact
single-writer discipline the food service holds for USDA data, inverted. The Clerk `public_metadata` claim path
`FR-044` depends on is also **identity's**: writing that metadata is identity's job.

**A schema package is per SERVICE, not per feature.** 010 adds `*.schema.ts` files under
`packages/services/identity/src/billing/`, beside the controller they serve, and the **existing** generator
copies them into the **existing** `@kitchensink/schema-identity` (a 716-line derived `openapi.yaml` today).
There is **no** `@kitchensink/schema-billing`, and 010 does not get one.

**The NestJS module is the internal boundary, and it is mandatory now even though the service boundary is not.**
`BillingModule` — the shape §5 already draws — owns the checkout/portal/subscription controllers and its own
`*.schema.ts`. A future extraction cuts at **that module edge**, and its cost is a new schema package plus a
client base-URL change, which is why the module edge cannot be skipped today.

**⛔ The Stripe webhook belongs in `@kitchensink/identity-webhooks`, not in the ECS API.** Four independent
reasons, all four of which that package already satisfies for Clerk's svix callback:

1. It is an **unauthenticated third-party callback** and must **not** sit behind Clerk's `AuthMiddleware`, which
   protects every identity-service route except `/health`.
2. It needs the **raw request body** for signature verification (which is why §5 reaches for
   `NestFactory.create(AppModule, { rawBody: true })` — a global change to the API process for one route).
3. It must **answer while the API is scaled down** — non-prod runs `FARGATE_SPOT` and a nightly sandbox
   shutdown (ADR-0007, ADR-0008), and Stripe retries for 72 hours against whatever is or is not up.
4. It needs the **`webhook_events` idempotency table, which ALREADY EXISTS in that database** for the svix
   callback (`packages/shared/identity-db/src/schema/webhookEvents.ts`).
   ⚠️ **But not in the shape §2 declares.** The shipped table is keyed `svix_id text PRIMARY KEY` with
   `identity_id text NOT NULL`, `event_type text`, `received_at`, `expires_at` — it has **no**
   `stripe_event_id`, **no** `status`, **no** `error`, **no** `processed_at`. §2's DDL therefore describes a
   _different_ table under the _same name_, and that collision must be resolved deliberately (extend the
   existing table, or add a distinctly named one) rather than discovered by a failing migration.

**⛔ `@RequirePremium()` / `PlanGuard` live in a SHARED package, not in the identity service.** Every gated
route is in some _other_ service (001's visibility PATCH is in the recipe service; 006's, 007's and 009's gated
routes likewise), so the guard is a **shared** concern under `packages/shared/*` that reads the entitlement as a
**claim from the signed Clerk session token** — the mechanism `FR-044` specifies and
`packages/shared/clerk-verify` already implements for admin `scopes`/`permissions`. It is **NOT** an import of
`@kitchensink/identity-service`: `packages/infra/global/__tests__/app-service-dependency.test.ts` already
forbids an app depending on a service package, and ADR-0014's rejected alternative 2 is exactly this — it drags
NestJS, Drizzle and the AWS SDK into every consumer and inverts the build order. ⚠️ §4's `PlanGuard` sketch reads
`user.plan` / `user.subscriptionStatus` off the request; under `FR-044` those values arrive from the verified
token claim, and every consumer **fails closed** — an absent or unreadable claim is `free`, never premium.

**Flip condition (ADR-0017)**: extract a billing service when 010 grows **marketplace payments** — Stripe
Connect, creator payouts, 1099 reporting, all explicitly out of scope today. That surface carries a different
regulatory and security posture and should not share a process with authentication.

**`@kitchensink/identity-service` MUST** author every checkout, portal, and subscription-status
request/response shape — and the webhook endpoint's own response — as **zod in the service** at
`src/billing/*.schema.ts` beside its controller; **validate its own requests with that same zod** via
`nestjs-zod`'s `createZodDto`; extend the committed `@kitchensink/schema-identity`, which exports the zod,
`z.infer` types, `contract-hash.ts`, a barrel and a **derived** `openapi.yaml` (outbound only — never a codegen
input); and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files** — notably **no
Stripe SDK type**, since importing one would drag a third-party shape into a contract we publish.

**Every client MUST** — separately mandatory:

- Import its wire **types and zod** from `@kitchensink/schema-identity`, and **declare no billing request or
  response body type of its own** — including in `@commise/web`, `@commise/mobile` and feature packages
  (GR-015 §15-b.4).
- **The `SubscriptionStatus` shape and the plan/entitlement enum are the load-bearing case.** Every gated
  surface across 004, 007, 009, 012 and 013 branches on them. A client that re-declares that enum can drift
  from the server by one member and **fail open** — showing a premium feature to a free user, or the reverse —
  with `typecheck` green. It is imported, never re-declared.
- **Derive** any divergent consumer shape (a paywall banner model, a plan-comparison row) with
  `Pick` / `Omit` / `Partial`. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **A new billing endpoint is not complete until its types are reachable from the schema package.**

**Drift gates** — inherited from GR-015 §15-c, all three required. The `CONTRACT_HASH` **boot assertion** is
especially load-bearing here: a released **mobile binary** pinned to an older entitlement shape while the
service moves ahead is exactly how a paywall silently misbehaves in production.

### ⛔ THE EXCEPTION — Stripe is a third-party API. NEVER converge it. (GR-015 §15-d)

**We do not serve Stripe's API.** There is no service of ours to own its types, and Stripe versions and evolves
its own contract independently of us.

- **The inbound webhook body is STRIPE's shape, not ours.** `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated` / `.deleted`, `trial_will_end` — each MUST be
  **validated at the boundary** (after `@golevelup/nestjs-stripe`'s signature verification, which authenticates
  the sender but does **not** guarantee the shape) before any field drives a `subscriptions` or
  `webhook_events` write. Signature-verified is **not** the same as shape-verified.
- Stripe's types (whether from `stripe`'s own SDK typings or a boundary zod schema) **stay on the Stripe side of
  the adapter** and are **not** folded into our schema package as though we owned them. Only `/api/v1/billing/*`
  request/response shapes are ours.
- The adapter **MAY declare its own types**, and our normalized `SubscriptionStatus` **deliberately differs**
  from Stripe's subscription object. That difference is the normalization, not drift.
- **No OpenAPI document is written for Stripe.**
- **Deleting a Stripe boundary schema under §15-b is a security and correctness regression**, not a cleanup:
  this is the path that decides who has paid. `packages/clients/usda` is the reference implementation and its
  `schemas.ts` must never be "converged".

### 3.0a Input validation (GR-016) — this plan already stated the rule's sharpest case

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. ✅ **§3.0 now names the owners** —
`@kitchensink/identity-service` for `/api/v1/billing/*`, `@kitchensink/identity-webhooks` for the Stripe
callback (ADR-0017) — so every obligation below binds a package that exists.

- **✅ "Signature-verified is NOT shape-verified" — §15-d above already says it, and GR-016 §16-b makes it
  portfolio law.** `@golevelup/nestjs-stripe`'s signature check authenticates the **sender**; it says nothing
  about the **shape**. So every inbound Stripe event — `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated` / `.deleted`, `trial_will_end` — is **validated at
  the boundary after signature verification and before any field drives a `subscriptions` or `webhook_events`
  write**. Both controls, in that order, never one instead of the other. This is the same rule identity's svix
  webhook is bound by (002).
- **⛔ GR-018 — ONE rejection path, and for Stripe "not retried" means answering `2xx`.** This is the half a
  contributor gets backwards on instinct, so it is stated in full
  ([GR-018](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) §18-a–§18-d):
    - **One rejection path**, producing **one** structured shape whose **`reason`** names the cause. A
      **signature failure and a shape failure are EQUALLY invalid** and MUST NOT have two different
      behaviours — they differ **only** in `reason`. Two behaviours means two error contracts, and measured
      repeatedly in this repo, one of the two ends up without a counter.
    - **An invalid payload is NEVER retried.** It cannot become valid by being sent again; retrying it converts
      a producer's bug into sustained load and buries the signal that would have found it.
    - ⚠️ **Stripe retries on ANY non-2xx, for 72 hours.** So returning `400` for an invalid body **requests**
      exactly the retry storm §18-b forbids. A rejected payload is therefore answered **`2xx`**, with the
      rejection carried in **(1)** the response body (so the Stripe dashboard shows what was wrong), **(2)**
      structured logs with its `reason`, **(3)** a **per-`reason` counter**, and **(4)** an **alarm** on that
      counter — because a rejection nobody sees is indistinguishable from success. **Reject the content, accept
      the delivery.**
    - ⚠️ **This does NOT generalize.** `/api/v1/billing/checkout`, `/portal` and `/subscription` are called by
      **our own** clients and keep returning the `400`/`403` GR-016 §16-a.3 requires — a `2xx` there would hide
      a fixable integration bug from the only party able to fix it. The question is always _who is on the other
      end, and do they retry on status?_
    - ⚠️ **A rejected event is NOT recorded as a row** (§18-d, and
      [GR-019](../governance-rules.md#gr-019-identifier-integrity--no-sentinels)). An invalid payload has **no
      trustworthy identifier**, and `webhook_events.identity_id` is `text NOT NULL` in this very database — so
      "just record the rejected event" forces the writer to invent an id, which is precisely the sentinel GR-019
      forbids. The **log line and the counter are load-bearing**, not a consolation prize.
    - ⛔ **This feature's `tasks.md` currently asserts the exact inversion** — "invalid signatures return
      `400`" — which is a GR-018 §18-c violation that _looks_ more correct than the rule. It also splits
      signature failure from shape failure into two behaviours, violating §18-a. That file is owned elsewhere
      and is **not** edited by this amendment; this note is the record that it contradicts the ratified rule.
      Both halves need a test (AC-018-c): an **invalid** body yields `2xx` + recorded rejection + counter, **and**
      a **valid** body still yields its normal success — or the test passes on a handler that always returns
      `200`.
- **One mechanism, one `400`.** Every checkout, portal and subscription-status input — body, path params, query
  params — plus the webhook endpoint's **own** response contract, is parsed by `@kitchensink/identity-service`'s
  own `*.schema.ts` zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. ⚠️ **Billing lands inside
  the one service where this has already gone wrong**: identity is where a `createZodDto` DTO was served by
  Nest's **own** `ValidationPipe` and therefore validated **nothing while looking correctly wired** (`PATCH
/users/me`, a route that writes user data). Billing routes must not inherit that wiring — and the only proof is
  a test that posts a known-bad body to a real billing route and asserts the `400`. Identity registers
  `nestjs-zod`'s `ZodValidationPipe` in `app.module.ts` today (6 sites, up from 3, re-measured 2026-08-12).
- **⛔ THE FLOOR — and 010 has the TIGHTEST real bounds of any of these features, with a thin margin.** §2's
  `webhook_events` declares `stripe_event_id VARCHAR(255)`, `event_type VARCHAR(100)` and `status VARCHAR(20)`.
  ⚠️ **`'processing'` is 10 characters, so `VARCHAR(20)` leaves almost no room** — a future status string longer
  than 20 characters is a failed `INSERT` on the money path, and the zod enum is what has to hold that line.
  Meanwhile the `accounts` additions in §2 are declared **`varchar` with no length at all**, which is
  unbounded in PostgreSQL and therefore **not yet a floor** — ⚠️ **a length must be declared before it can be
  asserted against**, and `stripeCustomerId` / `stripeSubscriptionId` hold third-party identifiers whose format
  is Stripe's to change. Plan/status enums, `price_cents`-style integer amounts and their `int4` ceiling of
  **2,147,483,647**, timestamps and nullability are in scope on the same terms. **Asserted, never derived**: no
  zod generated from Drizzle, and — as §3.0 already requires — **no Stripe SDK type in a `*.schema.ts`** either.
    - ⚠️ **§2 declares these columns with TypeORM-style `@Column()` decorators, while the rest of the
      portfolio — including the very table it extends — is Drizzle** (`packages/shared/identity-db/src/schema/`).
      That inconsistency is **flagged, not silently resolved**: picking one is a data-model decision for the
      owner, and it changes what the parity test below reads.
    - ✅ **OPEN-GR-016-A is CLOSED (ruled 2026-08-12, GR-017 §17-d):**
      the floor is enforced by a **per-service boundary-parity test**, not a review checklist. It lives in
      `@kitchensink/identity-service`; it **may import both** the storage schema and the authored zod, because
      **a test is not a wire schema**; it **derives** the bounded-column enumeration from the storage schema
      rather than typing it out; and it asserts the field→column mapping complete **in both directions** —
      every bounded column has an entry or a reasoned exemption, and every entry names a column that exists.
- **⚠️ An entitlement decision must never branch on an unparsed field.** The `SubscriptionStatus` shape and the
  plan/entitlement enum gate 004, 007, 009, 012 and 013. A webhook body whose `status` string was never checked
  against the enum can **fail open** — granting premium — with `typecheck` green. The enum is validated at the
  boundary and mapped explicitly; an unrecognised value is a **rejection plus an alarm**, never a default.
- **Non-HTTP ingress is in scope.** Any retry queue, DLQ replay or reconciliation job this feature adds **parses
  its payload against an authored zod before acting on it** — a pipe reaches none of them, and these are the
  paths that re-drive money-relevant writes.
- ✅ **Unknown keys — OPEN-GR-016-B is CLOSED (ruled 2026-08-12, GR-017 §17-c):**
  **`z.strictObject()` is the portfolio default for every mutating request body**, so `POST
/api/v1/billing/checkout` and `POST /api/v1/billing/portal` reject unknown keys. Plain `z.object()` is permitted
  only with a **documented forward-compatibility reason at the schema**, which in practice means a **read**
  surface such as `GET /api/v1/billing/subscription`'s query string. ⚠️ **Stripe's inbound body is the opposite
  case and the default does NOT reach it**: it is **their** shape, it gains fields without telling us, and its
  boundary schema tolerates unknown keys **deliberately** — while still rejecting a missing or wrong-typed field
  it depends on. Getting these two halves backwards is the expensive mistake in this feature.
- **⛔ Response validation is DEFERRED (GR-016 §16-g)** for our own responses. The Stripe-side parse above is
  **input** to us and is unaffected by that deferral — do not conflate them.

### Billing Endpoints

| Method | Path                           | Auth             | Description                                                |
| ------ | ------------------------------ | ---------------- | ---------------------------------------------------------- |
| `POST` | `/api/v1/billing/checkout`     | Required         | Create Stripe Checkout Session → redirect to Stripe        |
| `POST` | `/api/v1/billing/portal`       | Required         | Create Stripe Customer Portal session → redirect to Stripe |
| `GET`  | `/api/v1/billing/subscription` | Required         | Get current subscription status                            |
| `POST` | `/api/v1/billing/webhook`      | Stripe signature | Handle all Stripe webhook events                           |

### Request/Response Shapes

```typescript
// POST /api/v1/billing/checkout
Request (empty body — uses user's existing Stripe customer or creates one):
{}

Response:
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/..."
}

// POST /api/v1/billing/portal
Request (empty body):
{}

Response:
{
  "portalUrl": "https://billing.stripe.com/session/..."
}

// GET /api/v1/billing/subscription
Response:
{
  "plan": "premium",
  "status": "active",
  "currentPeriodEnd": "2026-07-09T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "trialEndsAt": null
}
```

### Webhook Event Routing

| Stripe Event                           | Handler                     | Action                                                                                              |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`           | `handleCheckoutCompleted`   | Provision: set `plan='premium'`, store `stripeCustomerId`/`stripeSubscriptionId`, `status='active'` |
| `invoice.paid`                         | `handleInvoicePaid`         | Confirm renewal: update `currentPeriodEnd`, `status='active'`                                       |
| `invoice.payment_failed`               | `handlePaymentFailed`       | Set `status='past_due'`; send failure email                                                         |
| `customer.subscription.updated`        | `handleSubscriptionUpdated` | Sync plan, status, `currentPeriodEnd`, `cancelAtPeriodEnd`                                          |
| `customer.subscription.deleted`        | `handleSubscriptionDeleted` | Downgrade: set `plan='free'`, `status='canceled'`, clear Stripe IDs                                 |
| `customer.subscription.trial_will_end` | `handleTrialEnding`         | Send trial-ending notification (fires 3 days before end)                                            |

---

## 4. Feature Gating Map

### @RequirePremium() Applied Per Feature

| Feature                     | Spec | FR         | Endpoint                                         | Guard               |
| --------------------------- | ---- | ---------- | ------------------------------------------------ | ------------------- |
| Private recipe visibility   | 001  | 001-FR-003 | `PATCH /api/v1/recipes/:id/visibility`           | `@RequirePremium()` |
| Clone-to-private (imported) | 004  | 004-FR-011 | `POST /api/v1/recipes/import` (visibility param) | `@RequirePremium()` |
| AI recipe generation        | 005  | 005-FR-016 | `POST /api/v1/ai/generate`                       | `@RequirePremium()` |
| AI instruction optimization | 005  | 005-FR-019 | `POST /api/v1/ai/optimize-instructions`          | `@RequirePremium()` |
| AI meal suggestions         | 006  | 006-FR-025 | `POST /api/v1/meal-plans/suggest`                | `@RequirePremium()` |
| Auto-generated meal plans   | 006  | 006-FR-026 | `POST /api/v1/meal-plans/generate`               | `@RequirePremium()` |
| Food waste optimization     | 006  | 006-FR-027 | `POST /api/v1/meal-plans/optimize-waste`         | `@RequirePremium()` |
| Online grocery ordering     | 007  | 007-FR-031 | `POST /api/v1/grocery-lists/:id/order`           | `@RequirePremium()` |
| Trainer nutrition planning  | 009  | 009-FR-038 | `POST /api/v1/nutrition/client-plans`            | `@RequirePremium()` |

### PlanGuard Implementation

```typescript
// billing/guards/plan.guard.ts
@Injectable()
export class PlanGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredPlan = this.reflector.getAllAndOverride<string>(REQUIRED_PLAN_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredPlan) return true;

        const { user } = context.switchToHttp().getRequest();
        const isActive = ['active', 'trialing'].includes(user.subscriptionStatus);
        const isPastDueWithinGrace = this.withinGracePeriod(user);

        if (user.plan === requiredPlan && (isActive || isPastDueWithinGrace)) return true;

        throw new ForbiddenException({
            code: 'PREMIUM_REQUIRED',
            message: 'This feature requires a premium subscription.',
            upgradeUrl: '/billing/upgrade',
        });
    }

    private withinGracePeriod(user: Account): boolean {
        if (user.subscriptionStatus !== 'past_due' || !user.currentPeriodEnd) return false;
        const gracePeriodDays = 7;
        return differenceInDays(new Date(), user.currentPeriodEnd) <= gracePeriodDays;
    }
}
```

### Upgrade Prompt Response (for UI)

When `PlanGuard` throws `ForbiddenException`, the NestJS exception layer formats it as:

```json
{
    "statusCode": 403,
    "error": "Forbidden",
    "message": "This feature requires a premium subscription.",
    "code": "PREMIUM_REQUIRED",
    "upgradeUrl": "/billing/upgrade"
}
```

Frontend intercepts `403 PREMIUM_REQUIRED` and shows upgrade CTA instead of generic error.

---

## 5. Module Structure

```
src/
├── billing/
│   ├── billing.module.ts
│   ├── billing.controller.ts      -- checkout, portal, subscription endpoints
│   ├── billing.service.ts          -- Stripe checkout/portal session creation
│   ├── webhook/
│   │   ├── webhook.controller.ts   -- /api/v1/billing/webhook (Stripe signature verified)
│   │   ├── webhook.service.ts     -- routes events to handlers, idempotency check
│   │   └── handlers/
│   │       ├── checkout.handler.ts
│   │       ├── invoice.handler.ts
│   │       ├── subscription.handler.ts
│   │       └── trial-ending.handler.ts
│   ├── decorators/
│   │   └── require-plan.decorator.ts   -- @RequirePremium()
│   └── guards/
│       └── plan.guard.ts
│
├── auth/
│   └── jwt-auth.guard.ts          -- from 002; composed with PlanGuard
```

### BillingModule Setup

```typescript
// billing/billing.module.ts
@Module({
    imports: [
        StripeModule.forRootAsync({
            useFactory: (config: ConfigService) => ({
                apiKey: config.get('STRIPE_SECRET_KEY'),
                webhookConfig: {
                    stripeSecrets: {
                        account: config.get('STRIPE_WEBHOOK_SECRET'),
                    },
                    requestBodyProperty: 'rawBody',
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [BillingController, WebhookController],
    providers: [BillingService, WebhookService, PlanGuard],
    exports: [BillingService],
})
export class BillingModule {}
```

### main.ts Requirement

```typescript
// src/main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });
// Enables raw body for Stripe webhook signature verification
```

---

## 6. Open Questions (OQ from Research)

| #    | Question                         | Decision                                         |
| ---- | -------------------------------- | ------------------------------------------------ |
| OQ-1 | Free tier recipe count limit?    | Unlimited public recipes (no count cap)          |
| OQ-2 | Family/household plan?           | Future consideration; not in v1 scope            |
| OQ-3 | Annual-only vs monthly+annual?   | Both: $6.99/mo and $59.99/yr                     |
| OQ-4 | Past-due silent vs notification? | Show banner on all pages when `past_due`         |
| OQ-5 | Stripe Tax (EU/UK)?              | Defer; implement when expanding to EU/UK markets |

---

## 7. Key Decisions

| Decision          | Choice                                  | Rationale                                                 |
| ----------------- | --------------------------------------- | --------------------------------------------------------- |
| Pricing           | $6.99/mo or $59.99/yr                   | Competitive with Mealime/Sabor; reflects AI feature depth |
| Trial             | 14-day free trial                       | Stripe native support; industry standard                  |
| Checkout          | Stripe Checkout (hosted)                | No PCI scope; fastest to ship                             |
| Portal            | Stripe Customer Portal                  | Handles plan switch, cancel, payment update; no custom UI |
| Upgrade proration | `always_invoice`                        | User pays and gets access immediately                     |
| Downgrade timing  | `schedule_at_period_end`                | User retains premium until period end                     |
| Grace period      | 7 days `past_due`                       | Reduces churn from transient payment failures             |
| Data on lapse     | Retain all data; gate actions not reads | FR-043 compliance                                         |
