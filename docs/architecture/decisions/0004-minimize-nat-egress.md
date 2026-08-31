# 0004 — Minimize NAT: one t4g.nano NAT instance, Fargate egress via the IGW

- **Status:** Accepted — _implemented_ (`NetworkStack` uses `NatProvider.instanceV2`; the identity Fargate service moved to public subnets with `assignPublicIp`). Food's equivalent (API + worker to public subnets; batch jobs as Fargate, not Lambdas) lands with feature 003.
- **Date:** 2026-06-21
- **Area:** AWS network topology · cost · `NetworkStack` NAT · ECS subnet placement · VPC Lambda egress
- **Related:** issue #46, `packages/infra/global/lib/platform/NetworkStack.ts`, `packages/services/identity/infra/lib/IdentityServiceStack.ts`, `packages/infra/global/__tests__/NetworkStack.test.ts`, `packages/infra/global/__tests__/natEgressConsumers.test.ts`, ADR-0002 (VPC/CIDR — the replacement trap), ADR-0022 (a migration runner per DB-touching stack), ADR-0024 (the LLM gate whose endpoint this update dropped)

## ⚠️ Before you change this — the trap

- **Do not move the DB-bound lambdas off the NAT, and do not "simplify" by deleting the NAT.** ⚠️ That set is no longer the three webhook handlers plus a migration runner this ADR was written around — it is **18 VPC-attached Lambdas across six stacks**, listed and machine-checked in [the 2026-08-20 update](#update-2026-08-20--the-consumer-list-grew-and-is-now-asserted). Read it before reasoning about "what is on the NAT". They are VPC-attached for exactly one reason: the RDS is `publiclyAccessible: false` (PRIVATE_ISOLATED), so they can only reach it from inside the VPC — and a VPC Lambda's only outbound paths are a NAT or VPC endpoints. `assignPublicIp` does **not** give a Lambda internet/AWS egress (that works only for Fargate/EC2). Removing the NAT silently breaks their Secrets Manager / CloudWatch Logs / SQS / Clerk access.
- **Do not open the NAT instance security group beyond the VPC CIDR.** It is `OUTBOUND_ONLY` by default with inbound restricted to the VPC range so only the private subnets route through it.
- **The single NAT instance is a deliberate single-AZ SPOF + ~5 Gbps cap.** Fine at this scale; revisit (HA NAT instances per-AZ, or back to a managed Gateway) when uptime/throughput demands grow.
- **Tasks now get public IPs.** That is _egress-only_ — inbound is locked to the ALB security group. Do not relax the service SG's inbound rules thinking the task is "already public."

## Context

- The managed NAT **Gateway** was the platform's biggest controllable line item — ~$32/mo/stage + data (confirmed against the actual bill; most of it idle). Issue #46 scoped the options.
- `assignPublicIp` + a public subnet gives **Fargate** tasks free egress via the Internet Gateway — but it does nothing for **VPC Lambdas**, which always need a NAT or VPC endpoints.
- The webhook lambdas are VPC-attached **only** to reach the private RDS; everything else they call (Secrets, Logs, SQS, Clerk) is outside the VPC.
- VPC interface endpoints for the AWS services would cost _more_ than the NAT and still wouldn't cover Clerk/USDA/Sentry (public internet). `log-forwarder` was already non-VPC.

## Decision

1. **NAT Gateway → NAT instance.** `NatProvider.instanceV2` on a `t4g.nano` (`OUTBOUND_ONLY`; inbound opened only to the VPC CIDR). ~$3–4/mo/stage. The `cdk diff` swap is a route **modification** (`NatGatewayId → InstanceId`) — no VPC/subnet/RDS replacement (ADR-0002 gate clean).
2. **Fargate egresses via the IGW, not the NAT.** The identity service moves to **public subnets + `assignPublicIp`**, inbound still locked to the ALB SG; it reaches the private RDS intra-VPC by SG. (Food's API + worker do the same in 003.)
3. **Minimize NAT membership to the irreducible set.** After (1)+(2), the NAT serves **only** Lambdas that are VPC-attached because the RDS is private — the "no alternative" case. Nothing joins it for convenience. ⚠️ The RULE is what this decision fixes; the MEMBERSHIP is not frozen, and it has since grown well past the four functions named when this was written — see the 2026-08-20 update. A guard test asserts `NetworkStack` has 0 NAT Gateways and a `t4g.nano` instance.

## Update (2026-08-20) — the consumer list grew, and is now asserted

**The rule in Decision 3 held. The list under it did not, and nothing failed, because a prose list cannot go
red.** Written in June around three webhook handlers plus a migration runner, the set was by then **17
VPC-attached Lambdas across six stacks**: ADR-0022 gave every DB-touching stack its own in-deploy migration
runner, `recipe-workers` shipped seven Lambdas of its own, `DataStack` grew two database-bootstrap Lambdas,
and identity-webhooks gained two erasure sweepers. (2026-08-31: plan U3's `BandDrainFunction` —
recipe-workers' eighth — makes it **18**; it is VPC-attached solely to read the band tables and the spend
counter in the recipe database, and its role carries no bedrock permission.)

⛔ **This matters because a stale premise gets REUSED.** Feature 004's LLM verification gate was designed
around a `com.amazonaws.<region>.bedrock-runtime` **VPC interface endpoint** whose entire justification was
that a Bedrock call from `recipe-workers` would otherwise "widen ADR-0004's four-consumer list". It would
not: `recipe-workers` Lambdas sit in `PRIVATE_WITH_EGRESS` and have routed through this NAT since they
shipped. The endpoint would not have prevented a widening — it would have bought a second egress path for a
consumer that was already there, at **$0.01 per endpoint-hour per AZ** (AWS Pricing API, us-east-1), which
at this VPC's `maxAzs: 2` is **$14.60/month/stage** to carry **$0.27/month** of inference, or roughly four
times the entire `t4g.nano` NAT instance it was avoiding. Declared in a per-service stack it would also have
been created once per open PR against the shared sandbox VPC. **The endpoint was dropped; the call rides the
NAT.** AWS's own PrivateLink documentation is the reason the privacy argument does not rescue it: of the
NAT→IGW path to an AWS service, _"while this traffic traverses the internet gateway, it does not leave the
AWS network."_

**Still true, and unchanged:** every function below is VPC-attached for exactly one reason — the RDS is
`publiclyAccessible: false`. Fargate still egresses via the IGW and is not on this list. `log-forwarder` is
still deliberately non-VPC.

<!-- nat-consumers:start -->

| Stack                | VPC-attached Lambdas                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DataStack (global)   | `FoodDbBootstrapFunction`, `RecipeDbBootstrapFunction`                                                                                                                                                                                                               |
| WebhooksStack        | `WebhookFunction`, `DeletionWorkerFunction`, `ReconciliationFunction`, `TombstoneSweepFunction`, `ErasureReconciliationFunction`                                                                                                                                     |
| IdentityServiceStack | `IdentityMigrationFunction`                                                                                                                                                                                                                                          |
| FoodServiceStack     | `FoodMigrationFunction`                                                                                                                                                                                                                                              |
| RecipeServiceStack   | `RecipeMigrationFunction`                                                                                                                                                                                                                                            |
| RecipeWorkersStack   | `VersionArchiveWorkerFunction`, `ArchiveSweeperFunction`, `AccountErasureWorkerFunction`, `HandleSyncWorkerFunction`, `ErasureSweeperFunction`, `ErasureOrphanSweeperFunction`, `IngredientVerificationFunction`, `BandDrainFunction`, `RecipeSchemaMigrationRunner` |

<!-- nat-consumers:end -->

`packages/infra/global/__tests__/natEgressConsumers.test.ts` discovers that set from the infra tree and
asserts **exact equality** with the table above — in both directions, so a function the table has not heard
of and a name the table still claims after deletion fail identically. The same suite asserts that **no
interface VPC endpoint exists anywhere in the tree**, which is what makes "VPC-attached" and "NAT consumer"
the same set rather than two that happen to coincide. Adding one is a cost decision that belongs in this
ADR first, then in the guard. Gateway endpoints (S3, DynamoDB) are free and deliberately **not** gated.

## Consequences

**Positive**

- ~$30/mo/stage saved (~$60/mo across both stages once each runs it), the bulk of the NAT bill.
- The blast radius / attack surface of "what's on the NAT" shrinks to the minimum the private DB forces.

**Negative / costs**

- Single-AZ NAT instance: a SPOF and a throughput ceiling; an EC2 to (rarely) patch — `instanceV2` uses a maintained AL2023 AMI.
- Tasks carry egress-only public IPs (inbound SG-locked).
- **Future food work (003):** the food batch jobs should be **Fargate scheduled tasks, not Lambdas**, so they egress to USDA via the IGW and add nothing to the NAT; if any food workload must be a VPC Lambda + internet, it joins the NAT set.

## Alternatives considered

- **Keep the NAT Gateway** — rejected; ~10× the cost for no benefit at this scale.
- **Public RDS + IAM auth, lambdas non-VPC, no NAT at all ($0)** — rejected for now: saves only ~$3/mo over the NAT instance, exposes Postgres to the internet (IAM+TLS-gated), and is more work + a posture to undo before launch.
- **VPC endpoints instead of a NAT** — rejected; more expensive than the NAT and doesn't cover public-internet egress (Clerk/USDA/Sentry).
- **Rearchitect all DB lambdas to Fargate / route DB through the service** — the only true-$0 path that keeps the DB private, but a multi-stack rebuild; deferred.

## Implementation guards

- `packages/infra/global/__tests__/NetworkStack.test.ts` asserts `AWS::EC2::NatGateway` count 0 and a `t4g.nano` NAT instance — fails if a Gateway is reintroduced.
- `packages/infra/global/__tests__/natEgressConsumers.test.ts` asserts the consumer table above matches the
  infra tree exactly, and that no interface VPC endpoint exists — the two facts every later decision about
  "what is on the NAT" is made against.
- The NAT instance SG is VPC-CIDR-scoped (`NetworkStack.ts`), not `0.0.0.0/0`.
