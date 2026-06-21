# Quickstart: IdP User Authentication

**Feature**: `002-user-auth` | **Date**: 2026-06-01
**Scope**: Tenant rollout guide for `kitchensink-dev`, `kitchensink-staging`, `kitchensink-prod`

---

## Prerequisites

- Node.js `>=24.16.0` (per `.nvmrc`)
- AWS CLI configured with target account + region credentials
- `DOMAIN_NAME` environment variable set (e.g., `thecommise.app`)
- Docker (for local PostgreSQL + LocalStack)

---

## Tenant Strategy

| Environment | IdP Tenant Name       | API GW Domain Prefix | Stack Suffix |
| ----------- | --------------------- | -------------------- | ------------ |
| Dev         | `kitchensink-dev`     | `identity.dev.`      | `-dev`       |
| Staging     | `kitchensink-staging` | `identity.sandbox.`  | `-staging`   |
| Prod        | `kitchensink-prod`    | `identity.`          | `-prod`      |

---

## Bootstrap Checklist

### 1. IdP Dashboard Configuration

- [ ] Create tenant for target environment (`kitchensink-{stage}`)
- [ ] Generate **Publishable Key** (web / mobile)
- [ ] Generate **Secret Key** (backend API)
- [ ] Configure **Webhook Signing Secret**
- [ ] Enable `user.created` webhook trigger
- [ ] Configure redirect URLs:
    - Web: `https://{prefix}{DOMAIN_NAME}/sign-in/callback`
    - Mobile: `{appScheme}://oauth-native-callback`
- [ ] Verify JWKS endpoint: `https://{tenant}.clerk.accounts.dev/.well-known/jwks.json`

### 2. Environment Variables

Create root `.env` (do **not** commit):

```bash
DOMAIN_NAME=thecommise.app
STAGE=dev
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
```

### 3. Secrets Manager

Populate the secret `kitchensink/{stage}/identity/keys`:

```json
{
    "secretKey": "sk_...",
    "publishableKey": "pk_...",
    "webhookSigningSecret": "whsec_..."
}
```

```bash
aws secretsmanager put-secret-value \
  --secret-id kitchensink/dev/identity/keys \
  --secret-string file://auth-secrets.json
```

### 4. CDK Bootstrap & Deploy

```bash
cd packages/services/identity-webhooks/infra
npm install
npm run infra:synth   # verify templates
npm run infra:deploy  # deploy all 6 stacks
```

Stacks created:

- `kitchensink-identity-network-{stage}`
- `kitchensink-identity-data-{stage}`
- `kitchensink-identity-domain-{stage}`
- `kitchensink-identity-webhooks-{stage}`
- `kitchensink-identity-service-{stage}`
- `kitchensink-identity-api-{stage}`

### 5. Database Migration

After RDS endpoint is available (check CloudFormation outputs):

```bash
cd packages/services/identity
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id kitchensink/dev/db/identity \
  --query SecretString --output text)

DB_PASSWORD=$(echo $DB_SECRET | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")
DB_HOST=$(echo $DB_SECRET | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['host'])")

DATABASE_URL="postgresql://identity_app:${DB_PASSWORD}@${DB_HOST}:5432/kitchensink_identity"
export DATABASE_URL

npx drizzle-kit migrate
```

### 6. Smoke Tests

```bash
# Health check (via ALB)
curl https://identity.dev.${DOMAIN_NAME}/health

# Authorizer — expect 401 without token
curl -i https://identity.dev.${DOMAIN_NAME}/v1/users/me

# Webhook — expect 400 without signature
curl -i -X POST https://identity.dev.${DOMAIN_NAME}/webhooks/users

# Profile (with token) — requires valid Bearer
curl -H "Authorization: Bearer ${TOKEN}" \
  https://identity.dev.${DOMAIN_NAME}/v1/users/me
```

---

## Troubleshooting

| Symptom                     | Root Cause              | Resolution                                                                                              |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `DOMAIN_NAME not set`       | Missing env var         | `export DOMAIN_NAME=thecommise.app` before synth/deploy                                                 |
| `Cannot find asset`         | `dist/` missing         | Run `npm run build` in `identity-webhooks` package                                                      |
| RDS connection timeout      | Security group rules    | Verify `serviceSecurityGroup` allows ingress from ALB SG on port 3000                                   |
| Webhook 403                 | Signing secret mismatch | Re-sync `webhookSigningSecret` in Secrets Manager                                                       |
| Lambda timeout (authorizer) | JWKS fetch slow         | Check the VPC NAT instance (t4g.nano, not a managed NAT Gateway — ADR-0004) / outbound route for Lambda |
| ECS task fails health check | DB unreachable          | Verify `DATABASE_URL` uses correct `dbInstanceEndpointAddress`                                          |

---

## Server-Side Handlers Reuse

This feature **does not author new IdP Actions/Triggers**. Existing tenant-template handlers are reused:

| Handler        | Trigger           | Destination                            |
| -------------- | ----------------- | -------------------------------------- |
| `user.created` | Post-registration | POST `/webhooks/users`                 |
| Password reset | User-initiated    | IdP hosted UI                          |
| MFA            | Out of scope      | See [spec.md §Out of Scope](./spec.md) |

---

## References

- [spec.md](spec.md) — canonical FR definitions & acceptance criteria
- [plan.md](plan.md) — architecture & service topology
- [tasks.md](tasks.md) — implementation task tracking
- [verify-report.md](verify-report.md) — build/test verification results

This guide gets a local development environment running for the auth feature: identity provider (IdP) instance, local database, environment variables, and the Lambda functions running locally.

---

## Prerequisites

- Node.js 24+ (`.nvmrc` at repo root — run `nvm use`)
- AWS CLI configured with a dev account (`aws configure`)
- Clerk account (free Hobby plan is sufficient — [dashboard.clerk.com](https://dashboard.clerk.com))
- Docker (for local PostgreSQL)
- `direnv` (for `.envrc` auto-loading — `brew install direnv`)

---

## 1. IdP Instance Setup

### Create Applications

In the [Clerk Dashboard](https://dashboard.clerk.com):

**Web Application (Next.js)**

- Application Type: Regular Web Application
- Allowed Callback URLs: `http://localhost:3000/api/auth/callback`
- Allowed Logout URLs: `http://localhost:3000`
- Allowed Web Origins: `http://localhost:3000`
- Token Expiration: 86400s (24h)
- Refresh Token Rotation: Enabled

**Mobile Application (Expo)**

- Application Type: Native
- Allowed Callback URLs: `commise://auth/callback`, `exp://localhost:8081/auth/callback`
- Allowed Logout URLs: `commise://auth/logout`

**Backend API (Lambda functions — user.created webhook, deletion, reconciliation)**

- Use the **Management API token** (Machine-to-Machine application) for all Backend API calls.
- Required Management API scopes: `read:users`, `update:users`, `delete:users`, `create:users`

### JWT Claims

The IdP embeds the `sub` claim (IdP user ID) natively in all JWTs. No custom Action is required.

The API Gateway authorizer resolves `sub` → internal ULID (`users.id`) and injects `app_user_id` into the downstream request context.

> **Optional**: If you need additional custom claims, configure a JWT Template in the Clerk Dashboard → JWT Templates. For this feature, no custom JWT Template is required.

### user.created Webhook (deployed separately)

The `user.created` webhook Lambda lives in `packages/services/identity-webhooks/`. It is deployed via CDK:

```bash
# Deploy via CDK (see packages/services/identity-webhooks/infra)
npx cdk deploy AuthLayerStack --context environment=dev
```

For local development, webhooks cannot be triggered locally without a tunnel. Use `ngrok` to expose your local endpoint, or use the reconciliation job as a substitute to backfill missing users.

---

## 2. Local Database

```bash
# Start PostgreSQL in Docker
docker run -d \
  --name commise-dev \
  -e POSTGRES_USER=commise \
  -e POSTGRES_PASSWORD=dev_password \
  -e POSTGRES_DB=commise_dev \
  -p 5432:5432 \
  postgres:16-alpine

# Wait for ready
until docker exec commise-dev pg_isready -U commise; do sleep 1; done

# Run migrations (from packages/services/identity-webhooks/infra)
npm run db:migrate --workspace=packages/services/identity-webhooks/infra
```

Schema migration files will be in `packages/services/identity-webhooks/infra/migrations/`.

---

## 3. Environment Variables

Copy `.env.template` to `.env` at the repo root and fill in:

```bash
# Identity Provider (Clerk)
export IDP_JWKS_URL="https://<your-clerk-frontend-api>.clerk.accounts.dev/.well-known/jwks.json"
export IDP_ISSUER="https://<your-clerk-frontend-api>.clerk.accounts.dev"
export IDP_AUDIENCE="https://api.thecommise.app"
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
export CLERK_SECRET_KEY="sk_test_..."
export CLERK_WEBHOOK_SIGNING_SECRET="whsec_..."

# Domain (required for CDK HostedZone lookup)
export DOMAIN_NAME="thecommise.app"

# Database
export DATABASE_URL="postgresql://commise:dev_password@localhost:5432/commise_dev"

# Sentry (optional for local dev — can be empty)
export SENTRY_DSN=""

# AWS (local Lambda testing)
export AWS_REGION="us-east-1"
export ENVIRONMENT="development"
```

Then: `direnv allow`

---

## 4. Install Dependencies

```bash
# From repo root
npm install
```

---

## 5. Running the Web App

```bash
npm run dev --workspace=packages/apps/web
# → http://localhost:3000
```

The Next.js app uses `@clerk/nextjs` with the App Router. The auth middleware (`clerkMiddleware()`) is configured in `proxy.ts` at the app root.

---

## 6. Running the Mobile App

```bash
npm run start --workspace=packages/apps/mobile
# → Expo DevTools at http://localhost:8081
# Scan QR code with Expo Go app
```

---

## 7. Running Lambda Functions Locally

Lambda functions can be invoked locally using `vitest` integration tests or the AWS SAM CLI:

```bash
# Unit tests (fast, no external services)
npm run test --workspace=packages/functions/auth-authorizer

# Integration tests (require local DB + IdP sandbox tokens)
npm run test:integration --workspace=packages/functions/auth-authorizer
```

To test the authorizer locally with a real JWT, sign in via the web app and copy the session token from the browser DevTools, or use the IdP Management API to verify access:

```bash
# Verify Clerk Backend API access (requires CLERK_SECRET_KEY)
curl -X GET "https://api.clerk.com/v1/users?limit=1" \
  -H "Authorization: Bearer ${CLERK_SECRET_KEY}"
```

---

## 8. CDK Deployment (dev environment)

```bash
cd packages/services/identity-webhooks/infra

# Copy env template and set required values
cp .env.template .env
# Edit .env: set DOMAIN_NAME, IDP_JWKS_URL, IDP_ISSUER, IDP_AUDIENCE, AUTH_SECRET_KEY

# Build CDK assets first
npm run infra:build --workspace=@kitchensink/identity-webhooks

# Bootstrap (once per account/region)
npx cdk bootstrap aws://ACCOUNT-ID/us-east-1

# Deploy
npm run infra:deploy --workspace=@kitchensink/identity-webhooks -- --context environment=dev
```

**Required SSM/Secrets Manager values before deploy**:

- `IDP_JWKS_URL` → SSM Parameter Store: `/kitchensink/auth/jwks-url/sandbox`
- `IDP_ISSUER` → SSM Parameter Store: `/kitchensink/auth/issuer/sandbox`
- `IDP_AUDIENCE` → SSM Parameter Store: `/kitchensink/auth/audience/sandbox`
- `AUTH_SECRET_KEY` → SSM Parameter Store: `/kitchensink/sandbox/identity/keys`
- `SENTRY_DSN` → Secrets Manager: `commise/dev/sentry/dsn`

---

## 9. Running All Checks

```bash
# From repo root
npm run typecheck   # turbo run typecheck
npm run lint        # turbo run lint format:check
npm run test        # turbo run test
```

All four must pass before any commit (enforced by `pre-commit` hook via husky).
