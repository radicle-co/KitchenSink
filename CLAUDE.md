# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Build all packages (respects Turbo dependency order)
npm run build

# Run all tests
npm run test

# Run a single workspace's tests
npm run test --workspace=packages/services/identity

# Run tests in watch mode (within a workspace)
cd packages/services/identity && npx vitest

# Lint all packages
npm run lint

# Type check all packages
npm run typecheck

# Format all files
npm run format

# Develop locally (persistent, all workspaces)
npm run dev:local
```

### Per-workspace development

```bash
# Web app (Next.js)
npm run dev --workspace=packages/apps/commise/web

# Mobile app (Expo)
npm run dev --workspace=packages/apps/commise/mobile

# Identity service (NestJS)
npm run dev --workspace=packages/services/identity

# E2E tests (Playwright — web only)
npm run test:e2e --workspace=packages/apps/commise/web

# E2E tests (Vitest-based — mobile / webhooks)
npm run test:e2e --workspace=packages/services/identity-webhooks
```

### Infrastructure (CDK)

```bash
# Synth identity service stacks
npm run infra:synth --workspace=packages/services/identity

# Synth identity-webhooks stacks
npm run infra:synth --workspace=packages/services/identity-webhooks

# Build + deploy (done by CI; avoid manual prod deploys)
npm run infra:deploy --workspace=packages/services/identity
```

## Architecture

This is a TypeScript monorepo using **npm workspaces** and **Turborepo** for the **Commise** recipe/meal-planning platform.

### Workspace layout

| Path                                  | Package                                                    | Description                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/apps/commise/web`           | `@commise/web`                                             | Next.js 15 web app (React 19, Tailwind CSS v4)                                                              |
| `packages/apps/commise/mobile`        | `@commise/mobile`                                          | Expo 53 / React Native 0.79 mobile app                                                                      |
| `packages/ui`                         | `@kitchensink/ui`                                          | Shared design-system tokens + Clerk components (Tamagui-compatible)                                         |
| `packages/services/identity`          | `@kitchensink/identity-service`                            | NestJS 11 REST service on ECS/Fargate; Drizzle ORM + RDS PostgreSQL 16                                      |
| `packages/services/identity-webhooks` | `@kitchensink/identity-webhooks`                           | AWS Lambda handlers: Clerk webhook, deletion worker, reconciliation, log forwarder, schema migration runner |
| `packages/infra/global`               | _(CDK app)_                                                | Shared CDK stacks (VPC, RDS, S3, SQS, IAM foundations)                                                      |
| `packages/tools/*`                    | `@kitchensink/{eslint,typescript,vitest,prettier,esbuild}` | Shared tooling configs                                                                                      |

### Authentication architecture

Authentication is built on **Clerk**.

- **Web**: `@clerk/nextjs` — ClerkProvider wraps the Next.js app; `middleware.ts` at the app root protects routes.
- **Mobile**: `@clerk/expo` — tokens stored in `expo-secure-store`.
- **Identity Service**: `AuthMiddleware` (`packages/services/identity/src/auth/middleware/auth.middleware.ts`) verifies the Clerk **session token** (Bearer) itself via `ClerkAuthService` → `@clerk/backend` `verifyToken` — networkless (public `CLERK_JWT_KEY`), with `CLERK_AUTHORIZED_PARTIES`/`azp` enforced. On first request it **read-through-creates** the user+account+profile (`UsersService.resolveOrCreateFromClaims`, Clerk `sub` → app ULID) and populates `req.user`; all routes except `/health` are protected. Admin `scopes`/`permissions` come from the signed token's `public_metadata`. There is deliberately **no** trusted-header (`x-authorizer-context`) path — the service is fronted by a public ALB, so a client-suppliable header would be forgeable (PR #39).
- **Clerk Webhooks**: `packages/services/identity-webhooks/src/handlers/identityWebhook.ts` handles `user.created/updated/deleted` events at the public `POST /v1/webhooks/users` (no gateway auth; verified via `svix` signature inside the Lambda).

### Identity service (NestJS)

`packages/services/identity/src/` is organized by domain:

- `app.module.ts` — root module wiring
- `auth/` — `ClerkAuthService` (session-token verification) + `AuthMiddleware` (Bearer auth, read-through user resolution)
- `users/` — `UsersModule`: user CRUD, avatar upload, profile resolution
- `admin/` — admin-scoped endpoints
- `database/` — `DatabaseModule` (global Drizzle provider), schema definitions, DAOs, migrations
- `config/` — Zod env schema (`EnvironmentSchema`); requires `DATABASE_URL` or individual `DB_*` vars plus `DELETION_QUEUE_URL`
- `queue/` — SQS deletion queue integration
- `types/` — shared TypeScript types including `AuthorizerContext`

### Identity-webhooks (Lambda)

`packages/services/identity-webhooks/src/` contains raw Lambda handlers (no NestJS):

- `handlers/identityWebhook.ts` → Clerk webhook sync (user.created/updated/deleted → RDS)
- `handlers/deletion-worker.ts` → async SQS-triggered user deletion retries
- `handlers/reconciliation.ts` → nightly scheduled reconciliation

Infrastructure lives in `infra/` subfolders of each service package using CDK v2.

### Infra stack topology

The identity service infra is split across stacks in `packages/services/identity/infra/lib/`:
`NetworkStack` → `DataStack` → `IdentityServiceStack` (ECS/Fargate, ALB, RDS credentials) plus the `WebhooksStack` (API Gateway + webhook/worker Lambdas) in `packages/services/identity-webhooks/infra/lib/`. The `packages/infra/global` package owns shared foundational resources.

### Cross-platform rule (enforced)

Every user-facing feature ships to **both** web and mobile in the same release. Platform-specific implementations use `.native.ts(x)` suffix (never `.mobile.*`). Shared business logic, types, and API clients live in shared packages. See `docs/CODING_STANDARDS.md §14` for the full rules.

### Deliberate decisions — looks wrong, isn't (read the ADR before changing)

Some choices look like bugs to "fix" but are intentional. Before reverting one, read the linked ADR and confirm you're not reintroducing the failure it prevents.

- **Sandbox front-end addressing — path routing, NOT per-PR subdomains.** Sandbox web previews are served from one stable origin (`sandbox.commise.app`) with the PR in the **URL path** (and static resources selected via a manifest query param), not from `pr-{N}.commise.app` subdomains. This is deliberate: Clerk's `azp` check is exact-string match (no wildcards), and the sandbox identity service is **shared**, so per-PR origins would 401 every preview. Before changing sandbox routing, the web app's serving origin, or `CLERK_AUTHORIZED_PARTIES` / `azp` handling, read **`docs/architecture/decisions/0001-sandbox-front-end-addressing.md`**.

## Key conventions

- **Commit messages**: Conventional Commits — `<type>(<scope>): <description>`. Enforced by commitlint.
- **Formatting**: 4-space indent, single quotes, semicolons, trailing commas, 120-char print width. Enforced by Prettier; run `npm run format` to fix.
- **Exports**: named exports only; default exports only where framework-required (Next.js pages, Expo entry).
- **Imports**: `.js`/`.jsx` extension on aliased imports; `.ts`/`.tsx` on relative imports. `import type` for type-only imports. Import order: external packages → internal aliases (blank line between). No relative imports crossing workspace boundaries.
- **Environment variables**: bracket notation only — `process.env['KEY']`, never `process.env.KEY`.
- **Dates**: ISO 8601 strings in interfaces, never `Date` objects.
- **Custom errors**: extend `Error`, call `Object.setPrototypeOf`, provide a matching `is*` type guard.
- **Impure functions**: document with `@sideEffect` JSDoc tag.
- **Function purity**: functions must be pure unless performing I/O, mutations, or external calls.
- **Test files**: `*.test.ts` in `__tests__/`; integration tests as `*.integration.test.ts` in `__integration__/`; E2E specs in `e2e/` as `*.spec.ts`. Always import `describe/it/expect/vi` explicitly from `vitest`.
- **Playwright selectors**: `getByRole` and `getByLabel` only — `data-testid` and `page.waitForTimeout()` are banned.
- **Fixture factories**: `make*` functions in `__fixtures__/` accepting `Partial<T>`.
- **TypeScript**: strict mode, zero `any`, no `@ts-ignore`/`@ts-expect-error`.
- **Folder structure**: organize by feature domain (not type); `helpers/` dirs are banned — use `utils/` co-located with consumers or `common/` for cross-cutting concerns.
