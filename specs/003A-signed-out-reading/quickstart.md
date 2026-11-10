# Quickstart: Validate Signed-out Reading

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

How to prove 003A works, tier by tier. Commands are the house npm and turbo doors (CLAUDE.md). This guide holds no
implementation. The test list per unit is in the plan's build order.

## While the feature ships dark

Every public read answers not available, because the 016 and 020 readings are `unknown` (FR-003). So the open page is
proven at the component and integration tiers with readings set by the test, and the deployed tiers prove the dark
state. Do not add a test-only door that opens a recipe on a deployed stage: that door is also a way to open a recipe
in production.

## 1. Unit and integration (CI, every push)

```bash
npm run test --workspace=packages/shared/recipe-core
npm run test --workspace=packages/services/recipe-service
npm run test:integration --workspace=packages/services/recipe-service
npm run test --workspace=packages/services/food-service
npm run test:integration --workspace=packages/services/food-service
npm run test --workspace=packages/services/identity
npm run test:integration --workspace=packages/services/identity
npm run test --workspace=packages/apps/commise/web
npm run test --workspace=packages/apps/commise/mobile
npm run test --workspace=packages/tools/repoGuards
```

Expected: the open-to-web Specification closes on every `unknown` reading. Each form's allowlist test fails on an extra
key. The public controller reads no credential. The food read places no hold and never returns a private food. Every
FR-023 state renders on web and native.

## 2. LOCAL e2e (a developer's machine only)

```bash
npm run local:up            # Postgres and LocalStack
npm run test:e2e --workspace=packages/services/recipe-service
npm run test:e2e --workspace=packages/services/food-service
```

Expected: the SQL form of the open-to-web rule returns the same set as the TypeScript form over a seeded matrix of
recipes. A private food bound to a private recipe never appears in a public read. With no `DATABASE_ADMIN_URL` these
suites throw. They never skip.

## 3. Playwright and Maestro (impacted only)

```bash
npm run e2e:plan            # shows which specs and flows the change reaches
npm run test:e2e:web
npm run test:e2e:mobile
```

Expected, web: a public address answers with `Vary: Accept-Language` and no `Set-Cookie`, the same bytes with and without a session, `noindex` on
a preview, and the not-available page for a private recipe. Expected, native: a tapped public link opens the public
view signed out, Close lands on sign-in, and signed in it opens the recipe screen.

## 4. Deployed e2e (sandbox up, by hand)

Start the sandbox with Sandbox Up (ADR-0060). Then run the manual `deployedE2e.yml`, or the impacted deployed specs.

Expected while dark: every public address on `pr-{N}.sandbox.commise.app/recipe/…` answers the not-available page,
sets no cookie, and sends `noindex`. `GET /api/v1/public/recipes/{id}` on `recipe-pr-{N}.commise.app` answers the one
`404` body with and without a token.

## 5. k6 (by hand only)

The public read gets one unauthenticated scenario in the recipe load test. It needs no test tenant. It runs only by
dispatch, never on a push (owner ruling 2026-09-13). It is a regression detector, not a capacity number.

## 6. Production only

These cannot be proven on a preview, because previews have no CloudFront and no WAF:

- the CloudFront passthrough for `/api/v1/public/recipes/*` with caching disabled
- the WAF rate rule's `429` and `Retry-After`
- the web host's production cache life and its rate limit
- Apple's CDN fetching the association file, and Android's `pm verify-app-links`

Each is a named step in the release checklist, run once after the first production deploy, with its result recorded.
