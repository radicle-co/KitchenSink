# KitchenSink Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-29

## Active Technologies

- TypeScript 5.x, Node.js 24.x (per `.nvmrc` + `package.json` engines) + NestJS 11, Drizzle ORM, `pg` (node-postgres), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs` (version-archive queue), Sharp (Lambda photo processor), `class-validator` + `class-transformer` (DTO validation), `@nestjs/config` (Zod env), `@auth0/nextjs-auth0` v4.x (web), `react-native-auth0` v5.5 (mobile) (001-commise-recipe-app)
- RDS PostgreSQL 16 (`db.t4g.small`, ~$25/mo) — pg_trgm, JSONB, tsvector FTS; S3 (photo objects + version archives) + CloudFront (CDN); SQS (version-archive queue + DLQ) (001-commise-recipe-app)

- TypeScript 5.x, Node.js 22.x (Lambda runtime) + `@clerk/nextjs` ^6.39 (web), `@clerk/expo` ^2.4 (mobile, Expo 53+), `@clerk/backend` ^1.27 (webhooks), `expo-secure-store` (mobile token storage), `jwks-rsa` (authorizer JWKS fetch from Clerk Frontend API), `jose` (JWT verification), `svix` (Clerk webhook signature verification), `@aws-sdk/client-sqs` (SQS), `@sentry/aws-serverless`, `@aws-lambda-powertools/logger`, CDK v2 (`aws-cdk-lib`) (002-user-auth)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x, Node.js 22.x (Lambda runtime): Follow standard conventions

## Recent Changes

- 001-commise-recipe-app: Added TypeScript 5.x, Node.js 24.x (per `.nvmrc` + `package.json` engines) + NestJS 11, Drizzle ORM, `pg` (node-postgres), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/client-sqs` (version-archive queue), Sharp (Lambda photo processor), `class-validator` + `class-transformer` (DTO validation), `@nestjs/config` (Zod env), `@auth0/nextjs-auth0` v4.x (web), `react-native-auth0` v5.5 (mobile)

- 002-user-auth: Added TypeScript 5.x, Node.js 22.x (Lambda runtime) + `@clerk/nextjs` ^6.39 (web), `@clerk/expo` ^2.4 (mobile, Expo 53+), `@clerk/backend` ^1.27 (webhooks), `expo-secure-store` (mobile token storage), `jwks-rsa` (authorizer JWKS fetch from Clerk Frontend API), `jose` (JWT verification), `svix` (Clerk webhook signature verification), `@aws-sdk/client-sqs` (SQS), `@sentry/aws-serverless`, `@aws-lambda-powertools/logger`, CDK v2 (`aws-cdk-lib`)

<!-- MANUAL ADDITIONS START -->

## Deliberate decisions (looks wrong, isn't)

Before "simplifying" one of these, read the linked ADR and confirm you're not reintroducing the failure it prevents:

- **Sandbox front-ends use path routing (`sandbox.commise.app/pr-{N}`), NOT per-PR subdomains.** Clerk's `azp` check is exact-string (no wildcards) and the sandbox identity service is shared, so per-PR origins would 401 every preview. See `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`.
- **A PR's deploy jobs are gated ENSURE-EXISTS, not on changed paths.** `deploy-food` / `deploy-recipe` run when the sources changed **or** the `pr-{N}` stack is absent/wedged **or** the origin does not answer — so a docs-only PR still gets food + recipe-workers + recipe-service. Don't restore the `paths-filter`-only gate (it left recipe-only previews with no food service and a dead `RECIPE_FOOD_SERVICE_URL`), and don't replace it with an unconditional redeploy (two Docker images per push). The deployed smoke treats food's **401** as the PASS: a transport failure or the shared ALB's default `404 text/plain` is the failure. See `docs/architecture/decisions/0010-ensure-exists-per-pr-deploy-gate.md`.

<!-- MANUAL ADDITIONS END -->
