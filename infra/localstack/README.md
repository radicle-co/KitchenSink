# LocalStack + Docker-Postgres E2E harness

The shared end-to-end harness foundation for the KitchenSink monorepo. It runs identically locally
and in CI, and stands up two containers (see `docker-compose.yml`):

| Container    | Image                         | Purpose                                                                                                                                                       |
| ------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localstack` | `localstack/localstack:4.4.0` | Emulates the AWS services KitchenSink uses: Secrets Manager, EventBridge (`events`), SQS, SNS, STS, IAM, CloudWatch Logs, CloudWatch, SSM. Port `4566`.       |
| `postgres`   | `postgres:16`                 | The database the services connect to — a **plain Postgres** container ("Docker for RDS"), **not** LocalStack RDS. Hosts the `food_e2e` database. Port `5432`. |

KitchenSink services are **NestJS apps on ECS** (not Lambda + API Gateway), so the harness boots a
service's Nest app as a process and runs E2E against its real HTTP API. It does **not** deploy CDK
stacks into LocalStack.

## Quick start

```bash
npm run localstack:up     # start both containers and wait until healthy
npm run localstack:down   # stop and remove containers + volumes
```

`localstack:up` runs `docker compose -f infra/localstack/docker-compose.yml up -d --wait`.

## Running the food-service E2E locally

The food service's E2E suite migrates `food_e2e` from the Phase-1 ordered SQL, boots the real Nest
app on an ephemeral port, and asserts `GET /health` plus end-to-end DB reachability:

```bash
npm run localstack:up
DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_e2e \
  npm run test:e2e --workspace=packages/services/food-service
```

The suite **skips cleanly** when no `DATABASE_URL` (or `TEST_DATABASE_URL`) is set, so it never fails
a developer who has not started the harness.

## Tier: Community (no auth token)

This harness runs entirely on LocalStack's **free Community tier — no `LOCALSTACK_AUTH_TOKEN`
required**, locally or in CI. Every AWS service KitchenSink uses (EventBridge=`events`, SQS, SNS,
Secrets Manager, SSM, IAM, STS, CloudWatch Logs) is Community. The Pro-gated services are
deliberately avoided: the DB is a plain Postgres container (not LocalStack RDS), and the Nest app
boots as a process (not LocalStack ECS). This holds through the Phase 3 (EventBridge) and Phase 8
(SQS / Secrets Manager) E2E flows.

If a Pro-only feature is ever adopted, add `LOCALSTACK_AUTH_TOKEN` back to the compose `environment`
and the `e2e-food` CI job (from a GitHub Actions secret) at that point.

## Status

- **Foundation (in place now):** compose file, `localstack:up` / `localstack:down` scripts, the
  `e2e-food` CI job, and the booted-app + Postgres `/health` E2E.
- **Phase 2/3 (to come):** `GET /api/v1/foods/:id` cache-hit / cache-miss → queue → worker drain, dedup,
  batch partial-success, and the EventBridge fan-out assertion via LocalStack.
