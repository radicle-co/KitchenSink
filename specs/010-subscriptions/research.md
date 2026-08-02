# Research: Subscriptions & Monetization

**Feature**: `010-subscriptions`
**Date**: 2026-05-08
**Status**: Complete
**Scope**: Competitor pricing models, Stripe Billing integration (NestJS), proration/plan-change handling, webhook idempotency, Customer Portal, and feature-gating patterns across features 001–009.

---

## 1. Competitor Analysis: Recipe App Subscription Models

### 1.1 Pricing Landscape (2026)

| App                      | Model                 | Free Tier                                   | Paid Price                               | Gated Features                                                  |
| ------------------------ | --------------------- | ------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| **Mealime**              | Freemium subscription | Limited recipe library, basic meal planning | ~$5.99/mo                                | Unlimited recipes, grocery delivery integration, cooking videos |
| **Paprika**              | One-time per platform | None                                        | $4.99 iOS/Android, $29.99 Mac/Windows    | All features included — no gating                               |
| **Samsung Food (Whisk)** | Free                  | Full                                        | Free                                     | None — fully free                                               |
| **AnyList**              | Freemium annual       | Lists, basic recipe org                     | $9.99/yr individual, $14.99/yr household | Meal calendar, advanced sharing                                 |
| **Plan to Eat**          | Subscription          | 30-day trial                                | ~$6.25/mo (~$49/yr)                      | All features behind paywall                                     |
| **BigOven**              | Freemium              | 200 recipes                                 | $2.99/mo                                 | Unlimited recipes, grocery list, meal planning                  |
| **Sabor**                | Freemium subscription | Basic                                       | $9.99/mo                                 | Unlimited recipes, advanced nutrition, budget analytics         |

**Sources**: [MyMealTicket comparison 2026](https://mymealticket.app/blog/recipe-apps-compared/), [WeeklyMealsPlanner comparison 2026](https://weeklymealsplanner.app/guides/top-tier-meal-planning-with-the-best-recipes-to-grocery-list-app), [Sabor vs Mealime vs Paprika 2026](https://trysabor.com/blog/meal-planning-apps-sabor-vs-mealime-vs-paprika-comparison)

### 1.2 Freemium Gating Patterns

**What competitors gate behind premium:**

| Feature Category         | Mealime Pro | AnyList Complete | Sabor Premium  | Commise (proposed)                          |
| ------------------------ | ----------- | ---------------- | -------------- | ------------------------------------------- |
| Private/unlisted content | —           | —                | —              | ✅ Private recipes                          |
| AI features              | —           | —                | ✅ AI planning | ✅ AI generation, optimization              |
| Grocery delivery         | ✅          | —                | —              | ✅ Online ordering                          |
| Unlimited recipes        | ✅          | —                | ✅             | Free tier unlimited (public)                |
| Advanced nutrition       | —           | —                | ✅             | ✅ Trainer nutrition planning               |
| Meal plan automation     | ✅          | ✅               | ✅             | ✅ Auto-generated plans, waste optimization |
| Household sharing        | —           | ✅               | ✅             | Future consideration                        |

**Key insight**: The market consensus is that **AI features, grocery delivery integration, and advanced planning automation** are the strongest premium differentiators. Basic recipe CRUD and manual meal planning are universally free. Commise's proposed gating (spec FR-040/FR-041) aligns well with this pattern.

### 1.3 Pricing Benchmarks

- **Entry-level monthly**: $2.99–$5.99/mo (BigOven, Mealime)
- **Mid-tier monthly**: $6.25–$9.99/mo (Plan to Eat, Sabor)
- **Annual discount**: Typically 30–40% off monthly (e.g., AnyList $9.99/yr vs ~$1.67/mo effective)
- **Sweet spot for recipe SaaS**: **$4.99–$7.99/mo** or **$39.99–$59.99/yr**

**Recommendation for Commise**: Two tiers — Free and Premium at **$6.99/mo or $59.99/yr** (~28% annual discount). This positions above Mealime (less AI) and below Sabor (less enterprise), matching the feature depth.

---

## 2. Stripe Billing Integration

### 2.1 Architecture Overview

The recommended integration uses **Stripe Checkout** for new subscriptions and the **Stripe Customer Portal** for self-serve management. This avoids building custom payment UI and leverages Stripe's PCI compliance.

**Flow**:

1. User clicks "Upgrade" → backend creates a Checkout Session → redirect to Stripe-hosted page
2. User completes payment → `checkout.session.completed` webhook fires → provision subscription in DB
3. Ongoing: `invoice.paid` / `invoice.payment_failed` / `customer.subscription.updated` / `customer.subscription.deleted` webhooks keep DB in sync
4. User manages subscription → backend creates Customer Portal session → redirect to Stripe-hosted portal

### 2.2 NestJS Integration: `@golevelup/nestjs-stripe`

The `@golevelup/nestjs-stripe` package (v3.0.0, released March 2026) is the canonical NestJS Stripe integration. It provides:

- Injectable `Stripe` client via `@InjectStripeClient()`
- Auto-registered webhook endpoint at `/stripe/webhook`
- Automatic signature verification using `STRIPE_WEBHOOK_SECRET`
- `@StripeWebhookHandler('event.type')` decorator for routing events to services
- Support for Stripe v2 thin events via `@StripeThinWebhookHandler`

**Module setup**:

```typescript
// billing/billing.module.ts
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
});
```

**`main.ts` requirement** — raw body must be enabled for webhook signature verification:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
```

**Sources**: [golevelup/nestjs-stripe docs](https://golevelup.github.io/nestjs/modules/stripe.html), [NPM v3.0.0](https://www.npmjs.com/package/@golevelup/nestjs-stripe/v/0.8.1), [ECOSIRE NestJS 11 guide 2026](https://ecosire.com/blog/stripe-billing-implementation-guide)

### 2.3 Subscription Lifecycle: Create

```typescript
// Create Checkout Session for new subscription
const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId, // or customer_email for new customers
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
        trial_period_days: 14,
        metadata: { userId, plan: 'premium' },
    },
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing/cancel`,
    metadata: { userId },
});
```

**Source**: [Stripe Node.js SDK docs](https://context7.com/stripe/stripe-node/llms.txt)

### 2.4 Plan Changes & Proration

Stripe's default `proration_behavior` is `create_prorations`. For upgrades, this credits unused time on the old plan and charges for the new plan immediately. For downgrades, a credit is applied to the next invoice.

```typescript
// Upgrade: charge immediately
await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: currentItemId, price: newPriceId }],
    proration_behavior: 'always_invoice', // immediate charge
});

// Downgrade: apply at period end (recommended for recipe app)
await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: currentItemId, price: newPriceId }],
    proration_behavior: 'none',
    billing_cycle_anchor: 'unchanged',
});
// OR use subscription schedules for end-of-period downgrade
```

**Proration options**:
| `proration_behavior` | Effect |
|---------------------|--------|
| `create_prorations` | Credit/charge calculated, invoiced at next renewal |
| `always_invoice` | Proration calculated + invoice generated immediately |
| `none` | No proration — customer billed full new price at next renewal |

**Recommendation**: Use `always_invoice` for upgrades (user gets immediate access, pays immediately), `none` with `cancel_at_period_end` pattern for downgrades (user retains premium until period end).

**Source**: [Stripe subscriptions/change docs](https://stripe.com/docs/billing/subscriptions/change), [Stripe API update reference](https://stripe.com/docs/api/subscriptions/update)

### 2.5 Customer Portal

The Stripe Customer Portal handles plan switching, payment method updates, and cancellation without custom UI:

```typescript
// Create portal session
const portalSession = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${appUrl}/account/billing`,
});
// Redirect user to portalSession.url
```

**Portal configuration** (set in Stripe Dashboard or via API):

- ✅ Switch plan (upgrade/downgrade)
- ✅ Prorate subscription updates
- ✅ Schedule downgrades at period end (`schedule_at_period_end: true`, added Oct 2024)
- ✅ Cancel subscription (with cancellation reason collection)
- ✅ Retention coupons (offer discount before cancel)
- ✅ Update payment method

**Source**: [Stripe Customer Portal configure docs](https://docs.stripe.com/customer-management/configure-portal), [Stripe changelog: scheduled downgrades Oct 2024](https://docs.stripe.com/changelog/acacia/2024-10-28/customer-portal-schedule-downgrades)

### 2.6 Webhook Handling: Critical Events

| Event                                  | Action                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`           | Provision subscription: store `stripeCustomerId`, `stripeSubscriptionId`, set `plan = 'premium'`, `subscriptionStatus = 'active'` |
| `invoice.paid`                         | Confirm renewal: update `currentPeriodEnd`, ensure `subscriptionStatus = 'active'`                                                |
| `invoice.payment_failed`               | Send payment failure email; set `subscriptionStatus = 'past_due'`; gate premium features after grace period                       |
| `customer.subscription.updated`        | Sync plan, status, `currentPeriodEnd`, `cancelAtPeriodEnd`                                                                        |
| `customer.subscription.deleted`        | Downgrade to free: set `plan = 'free'`, `subscriptionStatus = 'canceled'`, clear `stripeSubscriptionId`                           |
| `customer.subscription.trial_will_end` | Send trial-ending notification (fires 3 days before trial end)                                                                    |

**Idempotency is mandatory** — Stripe retries webhooks for 72 hours. Store processed `stripeEventId` in a `webhook_events` table with a unique constraint. Check before processing:

```typescript
@StripeWebhookHandler('customer.subscription.updated')
async handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const existing = await this.webhookEventRepo.findByStripeEventId(event.id);
  if (existing?.status === 'processed') return; // idempotent skip

  await this.webhookEventRepo.create({ stripeEventId: event.id, status: 'processing' });
  try {
    const sub = event.data.object as Stripe.Subscription;
    await this.syncSubscription(sub);
    await this.webhookEventRepo.markProcessed(event.id);
  } catch (err) {
    await this.webhookEventRepo.markFailed(event.id, err.message);
    throw err; // re-throw so Stripe retries
  }
}
```

**Sources**: [Stripe webhooks with subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks), [NestJS idempotency pattern](https://dev.to/aniefon_umanah_ac5f21311c/building-reliable-stripe-subscriptions-in-nestjs-webhook-idempotency-and-optimistic-locking-3o91), [APIScout SaaS guide 2026](https://apiscout.dev/blog/stripe-subscription-saas-complete-guide-2026)

---

## 3. Codebase Integration: Feature Gating

### 3.1 Subscription State on the User Record

From `002-user-auth`, the `Account` entity in our PostgreSQL database is the source of truth for subscription state. The following fields must be added (or confirmed present):

```typescript
// Additions to Account entity (002-user-auth)
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

The NestJS `AuthMiddleware` (from `002`) networklessly verifies the Clerk session token via `ClerkAuthService` (`@clerk/backend` `verifyToken` with the public `CLERK_JWT_KEY` and `azp`/`CLERK_AUTHORIZED_PARTIES` enforcement), then populates `req.user` with the Clerk `sub` (mapped to the app ULID). Because subscription tier rides on the token's `public_metadata.subscriptionTier` claim, gating decisions read it directly off the verified claims with no DB lookup per request. There is deliberately no trusted-header/authorizer-context path: the service is fronted by a public ALB, so a client-suppliable header would be forgeable.

### 3.2 NestJS Feature Gating Pattern

The recommended pattern is a **custom `@RequirePlan()` decorator + `PlanGuard`** that reads the authenticated user's `plan` field. It runs **after** `AuthMiddleware` (002's Clerk session-token verification, applied as NestJS middleware) has
populated `req.user`; there is no `JwtAuthGuard` in the shipped codebase.

```typescript
// billing/decorators/require-plan.decorator.ts
import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { PlanGuard } from '../guards/plan.guard';

export const REQUIRED_PLAN_KEY = 'requiredPlan';

/** Gate a route to premium subscribers only. */
export function RequirePremium() {
    return applyDecorators(SetMetadata(REQUIRED_PLAN_KEY, 'premium'), UseGuards(PlanGuard));
}
```

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
        if (user.plan === requiredPlan && isActive) return true;

        throw new ForbiddenException({
            code: 'PREMIUM_REQUIRED',
            message: 'This feature requires a premium subscription.',
            upgradeUrl: '/billing/upgrade',
        });
    }
}
```

**Usage across features**:

```typescript
// 001: Private recipe visibility
@Patch(':id/visibility')
@RequirePremium()
setRecipeVisibility(@Param('id') id: string, @Body() dto: SetVisibilityDto) { ... }

// 005: AI recipe generation
@Post('generate')
@RequirePremium()
generateRecipe(@Body() dto: GenerateRecipeDto) { ... }

// 007: Online grocery ordering
@Post('order')
@RequirePremium()
placeGroceryOrder(@Body() dto: PlaceOrderDto) { ... }
```

**Sources**: [NestJS custom decorators docs](https://docs.nestjs.com/custom-decorators), [LaunchFrame feature guards](https://docs.launchframe.dev/features/feature-guards.html), [libermenna NestJS feature flags](https://www.libermenna.com/feature-flags-in-nest-js/)

### 3.3 Feature Gating Map (FR-040 / FR-041)

| Feature                      | Spec | FR                      | Free | Premium | Guard Location                                   |
| ---------------------------- | ---- | ----------------------- | ---- | ------- | ------------------------------------------------ |
| Recipe CRUD (public)         | 001  | 001-FR-001 … 001-FR-005 | ✅   | ✅      | None                                             |
| Private recipe visibility    | 001  | 001-FR-003              | ❌   | ✅      | `PATCH /api/v1/recipes/:id/visibility`           |
| Recipe sharing/cloning       | 001  | 001-FR-006              | ✅   | ✅      | None                                             |
| Basic recipe importing (URL) | 004  | 004-FR-010              | ✅   | ✅      | None                                             |
| Clone-to-private (imported)  | 004  | 004-FR-011              | ❌   | ✅      | `POST /api/v1/recipes/import` (visibility param) |
| AI recipe generation         | 005  | 005-FR-016              | ❌   | ✅      | `POST /api/v1/ai/generate`                       |
| AI instruction optimization  | 005  | 005-FR-019              | ❌   | ✅      | `POST /api/v1/ai/optimize-instructions`          |
| Manual meal planning         | 006  | 006-FR-022 … 006-FR-024 | ✅   | ✅      | None                                             |
| AI meal suggestions          | 006  | 006-FR-025              | ❌   | ✅      | `POST /api/v1/meal-plans/suggest`                |
| Auto-generated meal plans    | 006  | 006-FR-026              | ❌   | ✅      | `POST /api/v1/meal-plans/generate`               |
| Food waste optimization      | 006  | 006-FR-027              | ❌   | ✅      | `POST /api/v1/meal-plans/optimize-waste`         |
| Grocery list generation      | 007  | 007-FR-028 … 007-FR-030 | ✅   | ✅      | None                                             |
| Online grocery ordering      | 007  | 007-FR-031              | ❌   | ✅      | `POST /api/v1/grocery-lists/:id/order`           |
| Cooking mode                 | 008  | 008-FR-032 … 008-FR-035 | ✅   | ✅      | None                                             |
| Basic nutrition tracking     | 009  | 009-FR-038 (partial)    | ✅   | ✅      | None                                             |
| Trainer nutrition planning   | 009  | 009-FR-038              | ❌   | ✅      | `POST /api/v1/nutrition/client-plans`            |

### 3.4 Grace Period on Subscription Lapse

Per spec FR-043, when a subscription lapses (payment failure → `past_due`), users must retain access to their data. Recommended grace period: **7 days** in `past_due` status before downgrading to free-tier access. This matches industry norms and gives users time to update payment methods.

```typescript
// In PlanGuard — allow past_due within grace period
const gracePeriodDays = 7;
const isPastDueWithinGrace =
    user.subscriptionStatus === 'past_due' &&
    user.currentPeriodEnd &&
    differenceInDays(new Date(), user.currentPeriodEnd) <= gracePeriodDays;

if (user.plan === 'premium' && (isActive || isPastDueWithinGrace)) return true;
```

### 3.5 Downgrade Data Retention (Edge Case from Spec)

When a premium user downgrades, per spec acceptance scenario 6:

- **Previously private recipes remain private** (no forced un-privatization)
- **No new recipes can be set to private** until renewal
- **AI-generated recipes already saved** are retained (they are just recipes in the DB)
- **Exception**: Imported/attributed recipes that were set to private must remain public per source TOS (004-FR-011)

This means the `PlanGuard` only gates **write/action** endpoints, not read access to existing data.

---

## 4. Database Schema Additions

### 4.1 `webhook_events` Table (Idempotency)

```sql
CREATE TABLE webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id  VARCHAR(255) UNIQUE NOT NULL,  -- unique constraint for idempotency
  event_type  VARCHAR(100) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'processing',  -- processing | processed | failed
  error       TEXT,
  processed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_webhook_events_stripe_event_id ON webhook_events(stripe_event_id);
```

### 4.2 Account Entity Additions

Fields listed in §3.1 above. The `plan` and `subscriptionStatus` columns should be indexed for fast guard lookups:

```sql
CREATE INDEX idx_accounts_stripe_customer_id ON accounts(stripe_customer_id);
CREATE INDEX idx_accounts_stripe_subscription_id ON accounts(stripe_subscription_id);
```

---

## 5. Key Decisions & Recommendations

| Decision          | Recommendation                                     | Rationale                                                        |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Pricing           | $6.99/mo or $59.99/yr                              | Competitive with Mealime/Sabor; reflects AI feature depth        |
| Trial             | 14-day free trial                                  | Industry standard; Stripe supports natively                      |
| Checkout          | Stripe Checkout (hosted)                           | No PCI scope; fastest to ship                                    |
| Portal            | Stripe Customer Portal                             | Handles plan switch, cancel, payment update without custom UI    |
| Upgrade proration | `always_invoice`                                   | User pays immediately, gets access immediately                   |
| Downgrade timing  | End of period (`schedule_at_period_end`)           | Prevents credit exploitation; matches user expectation           |
| Webhook library   | `@golevelup/nestjs-stripe` v3.0.0                  | Native NestJS DI, auto-signature verification, decorator routing |
| Idempotency       | `webhook_events` table with unique `stripeEventId` | Stripe retries for 72h; must be idempotent                       |
| Feature gating    | `@RequirePremium()` decorator + `PlanGuard`        | Composable, testable, consistent across all features             |
| Grace period      | 7 days `past_due` before locking premium           | Reduces churn from transient payment failures                    |
| Data retention    | Retain all data on lapse; gate actions not reads   | FR-043 compliance; user trust                                    |

---

## 6. Open Questions

| #    | Question                                                                                  | Impact                                          |
| ---- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OQ-1 | Should the free tier have a recipe count limit (e.g., 50 public recipes) or be unlimited? | Affects conversion rate and DB query complexity |
| OQ-2 | Family/household plan? (AnyList charges $14.99/yr for household)                          | Requires multi-user subscription linking        |
| OQ-3 | Annual-only vs monthly+annual?                                                            | Annual reduces churn but lowers conversion      |
| OQ-4 | Should `past_due` users see a banner/notification, or be silently degraded?               | UX decision; affects churn                      |
| OQ-5 | Stripe Tax for international users?                                                       | Compliance requirement if selling in EU/UK      |
