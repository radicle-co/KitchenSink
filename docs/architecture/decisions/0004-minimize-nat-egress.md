# 0004 — Minimize NAT: one t4g.nano NAT instance, Fargate egress via the IGW

- **Status:** Accepted — _implemented_ (`NetworkStack` uses `NatProvider.instanceV2`; the identity Fargate service moved to public subnets with `assignPublicIp`). Food's equivalent (API + worker to public subnets; batch jobs as Fargate, not Lambdas) lands with feature 003.
- **Date:** 2026-06-21
- **Area:** AWS network topology · cost · `NetworkStack` NAT · ECS subnet placement · VPC Lambda egress
- **Related:** issue #46, `packages/infra/global/lib/platform/NetworkStack.ts`, `packages/services/identity/infra/lib/IdentityServiceStack.ts`, `packages/infra/global/__tests__/NetworkStack.test.ts`, ADR-0002 (VPC/CIDR — the replacement trap)

## ⚠️ Before you change this — the trap

- **Do not move the webhook lambdas (`webhook`, `deletion-worker`, `reconciliation`, `migrate`) off the NAT, and do not "simplify" by deleting the NAT.** They are VPC-attached for exactly one reason: the RDS is `publiclyAccessible: false` (PRIVATE_ISOLATED), so they can only reach it from inside the VPC — and a VPC Lambda's only outbound paths are a NAT or VPC endpoints. `assignPublicIp` does **not** give a Lambda internet/AWS egress (that works only for Fargate/EC2). Removing the NAT silently breaks their Secrets Manager / CloudWatch Logs / SQS / Clerk access.
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
3. **Minimize NAT membership to the irreducible set.** After (1)+(2), the NAT serves **only** the four DB-bound webhook lambdas — the "no alternative because the DB is private" case. A guard test asserts `NetworkStack` has 0 NAT Gateways and a `t4g.nano` instance.

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
- The NAT instance SG is VPC-CIDR-scoped (`NetworkStack.ts`), not `0.0.0.0/0`.
