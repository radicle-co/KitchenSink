---
date: 2026-06-14
topic: tailscale-private-aws-access
---

# Tailscale access to private AWS resources — Requirements

> **Reconciled with the VPC consolidation (`docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md`).** That work gives prod and sandbox distinct CIDRs and peers them, so the original two-routers-plus-4via6 approach is superseded by **one prod router reaching both VPCs over peering**. Sections below are updated accordingly.

> Note (2026-06-21): the platform now egresses via a t4g.nano NAT _instance_ (not a managed NAT Gateway) — see ADR-0004. References below to "the existing NAT gateway" mean that NAT instance; the router's NAT dependency and "already-billed / no new fixed cost" framing still hold.

## Summary

Stand up a single Tailscale subnet router on a dedicated EC2 instance in the prod VPC, reaching private resources in **both** the prod and sandbox VPCs (sandbox over a VPC peering connection), so the developer's solo Tailscale account can reach private VPC resources — primarily the isolated RDS PostgreSQL instances — directly from a laptop. This replaces "no developer access exists" with an on-tailnet path to run and verify migrations and inspect data, without exposing anything to the public internet.

## Problem Frame

The identity service's RDS PostgreSQL lives in `PRIVATE_ISOLATED` subnets with `publiclyAccessible: false`, and its security group admits port `5432` only from the ECS and Lambda security groups (`packages/services/identity/infra/lib/network-stack.ts:84-94`). There is no bastion, no SSM Session Manager, and no VPN. From a laptop the database is simply unreachable.

The cost shows up at exactly the moments that matter. Schema changes can only be applied through the in-VPC `MigrationFunction` Lambda invoked by CI (`packages/services/identity-webhooks/src/handlers/migrate.ts:56-138`), and when that path stalls — the "prod schema never migrated" issue tracked in project memory — there is no way to connect and see the live schema, confirm a migration landed, or inspect prod data while debugging. Every investigation that needs the real database is blocked on shipping more code through CI.

## Key Decisions

- **EC2 subnet router, not a container.** Tailscale's own AWS reference architecture recommends running subnet routers external to ECS/EKS so connectivity survives cluster problems, and Fargate forces userspace networking with no kernel forwarding and no persistent state. The router runs on a dedicated EC2 instance, not as a Fargate task.
- **Non-burstable instance, stopped when idle.** The router uses a non-burstable (non-T-series) Graviton instance type per Tailscale's production guidance, and is stopped when not in active use and started on demand. This trades always-on availability for cost: the non-burstable hourly rate is only paid while running, and a stopped instance bills only its EBS volume.
- **Private-subnet placement.** Each router sits in the `private-app` subnet with no public IP and reaches Tailscale's control plane and DERP relays through the VPC's existing NAT gateway. This is both the cheaper option (no billed public IPv4 per router) and the smaller exposed surface; reachability from the laptop is identical to a public placement because the router dials out to the tailnet.
- **Whole-VPC routing via subnet routes.** The router advertises each VPC CIDR rather than exposing individual endpoints, so any current or future private resource is reachable without per-resource setup. RDS is the driving case, not the boundary.
- **Distinct CIDRs + VPC peering, not 4via6.** The consolidation gives prod (`10.0.0.0/16`) and sandbox (`10.1.0.0/16`) distinct CIDRs and peers them, so the single prod router advertises both ranges and reaches sandbox over the peering connection. This supersedes the original 4via6 site-ID workaround, which only existed because both VPCs shared `10.0.0.0/16`.
- **Tagged device via OAuth client for auth.** The router authenticates as a tagged, non-user-owned device using an OAuth client rather than a hand-managed auth key, so credentials don't expire under it and identity is least-privilege.
- **Solo scope now, no HA.** One prod router for one user, reaching both stages over peering. No high-availability second router and no multi-user ACL fan-out in this iteration.

## Requirements

**Routing and reachability**

- R1. A Tailscale subnet router runs in the prod VPC and advertises that VPC's private address space to the tailnet.
- R2. The same prod router reaches the sandbox VPC's private resources over a VPC peering connection and advertises the sandbox CIDR — no separate sandbox router.
- R3. The developer's laptop, once on the tailnet, can open a PostgreSQL connection to each environment's private RDS instance using its standard `*.rds.amazonaws.com` hostname.
- R4. Prod and sandbox are reached over distinct, non-overlapping CIDRs (from the consolidation) plus a peering connection — no 4via6.
- R5. RDS hostnames resolve to private VPC addresses for tailnet clients, so connections use the DNS name rather than a hardcoded IP.

**Access control and security boundary**

- R6. Each RDS security group admits port `5432` from its subnet router's security group; advertising the route alone must not be relied on to grant database access.
- R7. The router instances expose no public inbound access beyond what Tailscale itself requires; administrative access to the router is over the tailnet, not a public SSH rule.
- R8. Reachability of the advertised routes is restricted to the owner's identity via tailnet policy, not left open to any future tailnet member by default.

**Operability**

- R9. The router node's Tailscale key expiry is disabled so advertised routes do not silently drop after the default expiry window across stop/start cycles.
- R10. The routers and their supporting AWS resources are defined as infrastructure-as-code in the CDK app, consistent with the existing stack topology, not configured by hand.
- R11. Each router runs on a non-burstable (non-T-series) Graviton instance type placed in the `private-app` subnet, reaching the Tailscale control plane via the existing NAT gateway with no public IP.
- R12. Routers are stopped when not in active use and started on demand. While a router is stopped, its advertised routes are unavailable by design, and the developer starts it before a session.

## Key Flows

- F1. Developer reaches prod RDS from a laptop
    - **Trigger:** Developer needs to run or verify a migration, or inspect prod data.
    - **Steps:** Developer is signed in to the tailnet on the laptop; opens a Postgres client against the prod RDS hostname; traffic routes through the prod subnet router into the isolated data subnet; the RDS security group admits the router's SG on `5432`; the session connects with the existing `identity_app` credentials from Secrets Manager.
    - **Outcome:** A live psql/ORM session against prod, with no public exposure and nothing started or torn down per session.
    - **Covered by:** R1, R3, R5, R6.

## Acceptance Examples

- AE1. **Covers R4, R5.** Given the prod router is connected with peering established, when the developer connects to the prod RDS hostname and then the sandbox RDS hostname, then each resolves to its own environment's database over its distinct CIDR, with no cross-environment bleed.
- AE2. **Covers R6.** Given a router is advertising a VPC route but the RDS security group has not been updated, when the developer attempts to connect to that VPC's RDS, then the connection is refused/times out — confirming the security-group ingress, not the route, is the gate.
- AE3. **Covers R9.** Given the router has been running past the default node-key expiry window, when the developer connects, then routes remain advertised and the connection succeeds because key expiry is disabled on the router node.
- AE4. **Covers R12.** Given an environment's router is stopped, when the developer attempts to connect to that environment's RDS, then the connection fails until the router is started; after starting it, the same connection succeeds without re-authenticating the node.

## Scope Boundaries

**Deferred for later**

- High-availability routers (a second instance per VPC advertising the same prefix with automatic failover).
- Multi-user / team access: tailnet ACL grants and tags scoped per engineer, group-based route approval.
- Routing additional environments beyond prod and sandbox.

**Outside this iteration's shape**

- App-connector (DNS-name-based) access instead of subnet routing — viable for RDS per Tailscale but unnecessary given the whole-VPC decision.
- SSM Session Manager port-forwarding as the access mechanism — the honest fallback only if scope later collapses to "reach the DB occasionally"; not pursued because whole-VPC mesh was chosen.
- 4via6 and a second per-VPC router — superseded by the consolidation's distinct CIDRs + peering.

## Dependencies / Assumptions

- A Tailscale account/tailnet exists and the developer's laptop is enrolled.
- The VPC consolidation (`docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md`) has landed, giving prod and sandbox distinct CIDRs and a peering connection — the precondition for the single-router design.
- The router reaches Tailscale's control plane and DERP relays via the existing NAT gateway from the private-app subnet; this reuses infrastructure already billed, so the router adds no new fixed network cost.
- Always-on availability is intentionally given up in favor of cost: routes are reachable only while the router is started.
- Existing `identity_app` RDS credentials in Secrets Manager remain the connection credentials; this work changes network reachability, not database auth.

## Outstanding Questions

**Deferred to planning**

- Exact non-burstable Graviton instance size (e.g., `c7g.medium` / `m7g.medium` as the floor).
- Mechanism for stop-when-idle: manual start/stop vs. a scheduled auto-stop, and how the developer triggers a start before a session.
- Whether the sandbox DB SG can reference the prod router SG directly across the peering connection, or must use the prod CIDR as the source.
- Whether route approval is manual (admin console) or delegated via `autoApprovers` in the tailnet policy.
- Whether `--accept-dns=false` plus split-DNS, or another DNS arrangement, is used to resolve RDS hostnames.

## Sources / Research

- Tailscale, "Access AWS RDS privately using Tailscale" — the directly applicable guide (EC2 subnet router, RDS security-group ingress, split DNS): https://tailscale.com/kb/1141/aws-rds
- Tailscale, "Connect to an AWS VPC using subnet routes": https://tailscale.com/docs/install/cloud/aws
- Tailscale AWS reference architecture (run subnet routers external to ECS/EKS): https://tailscale.com/docs/reference/reference-architectures/aws
- Tailscale, OAuth clients and tagged devices for headless routers: https://tailscale.com/docs/features/oauth-clients
- Tailscale, key expiry (disable for server nodes): https://tailscale.com/kb/1028/key-expiry
- Current network/SG state: `packages/services/identity/infra/lib/network-stack.ts:17-37,84-94`
- Current migration path: `packages/services/identity-webhooks/src/handlers/migrate.ts:56-138`
