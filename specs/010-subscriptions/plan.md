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

🟠 **OPEN — which service owns `/api/v1/billing/*`?** §5 _Module Structure_ shows a `src/billing/` module
alongside `auth/jwt-auth.guard.ts` "from 002", which reads like it lands **inside the identity service**, but
this plan never says so and no ADR decides it. **Question for the owner: does billing live in
`@kitchensink/identity-service`, or in a new `@kitchensink/billing-service`?** The answer picks the schema
package (`@kitchensink/schema-identity` vs a new `@kitchensink/schema-billing`), so nothing below names it. It
also decides where `@RequirePremium()` / `PlanGuard` live relative to every gated feature. **The contract
obligation binds whichever service ends up owning the paths.**

**The owning service MUST** author every checkout, portal, and subscription-status request/response shape — and
the webhook endpoint's own response — as **zod in that service** at `src/**/*.schema.ts` beside its controller;
**validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto`; generate and commit
`packages/schemas/<service>` exporting the zod, `z.infer` types, `contract-hash.ts`, a barrel and a **derived**
`openapi.yaml` (outbound only — never a codegen input); and keep every `*.schema.ts` importing **only `zod` and
other `*.schema.ts` files** — notably **no Stripe SDK type**, since importing one would drag a third-party
shape into a contract we publish.

**Every client MUST** — separately mandatory:

- Import its wire **types and zod** from that service's schema package, and **declare no billing request or
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
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. **The OPEN ownership question above does not defer this
obligation** — it binds whichever service ends up owning `/api/v1/billing/*`.

- **✅ "Signature-verified is NOT shape-verified" — §15-d above already says it, and GR-016 §16-b makes it
  portfolio law.** `@golevelup/nestjs-stripe`'s signature check authenticates the **sender**; it says nothing
  about the **shape**. So every inbound Stripe event — `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated` / `.deleted`, `trial_will_end` — is **validated at
  the boundary after signature verification and before any field drives a `subscriptions` or `webhook_events`
  write**. Both controls, in that order, never one instead of the other. This is the same rule identity's svix
  webhook is bound by (002).
- **One mechanism, one `400`.** Every checkout, portal and subscription-status input — body, path params, query
  params — plus the webhook endpoint's **own** response contract, is parsed by that service's own `*.schema.ts`
  zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. ⚠️ If billing lands **inside
  `@kitchensink/identity-service`**, note that identity is the service where a `createZodDto` DTO was served by
  Nest's **own** `ValidationPipe` and therefore validated **nothing while looking correctly wired** (`PATCH
/users/me`). Billing routes must not inherit that wiring — and the proof is a test that posts a known-bad
  body to a real billing route and asserts the `400`.
- **⛔ THE FLOOR.** Every input field writing a bounded column is validated at least as strictly as the column
  can store — plan/status enums, `price_cents`-style integer amounts and their `int4` ceiling of
  **2,147,483,647**, timestamps, external-id lengths, nullability. **Asserted, never derived**: no zod generated
  from Drizzle, and — as §3.0 already requires — **no Stripe SDK type in a `*.schema.ts`** either.
- **⚠️ An entitlement decision must never branch on an unparsed field.** The `SubscriptionStatus` shape and the
  plan/entitlement enum gate 004, 007, 009, 012 and 013. A webhook body whose `status` string was never checked
  against the enum can **fail open** — granting premium — with `typecheck` green. The enum is validated at the
  boundary and mapped explicitly; an unrecognised value is a **rejection plus an alarm**, never a default.
- **Non-HTTP ingress is in scope.** Any retry queue, DLQ replay or reconciliation job this feature adds **parses
  its payload against an authored zod before acting on it** — a pipe reaches none of them, and these are the
  paths that re-drive money-relevant writes.
- **Unknown keys are a stated choice per surface.** Our own `/api/v1/billing/*` bodies are small and
  well-known, which is the easiest place to reject unknown keys outright; Stripe's inbound body is the opposite
  case — it is **their** shape and gains fields without telling us, so its boundary schema must tolerate
  unknown keys deliberately rather than by accident. Naming the choice per surface is the requirement.
  (Portfolio default for **our** bodies is **OPEN** — GR-016 OPEN-GR-016-B.)
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
