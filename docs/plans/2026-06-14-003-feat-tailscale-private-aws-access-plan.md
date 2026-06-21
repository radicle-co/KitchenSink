---
title: 'feat: Tailscale subnet-router access to private AWS resources'
date: 2026-06-14
type: feat
depth: deep
origin: docs/brainstorms/2026-06-14-tailscale-private-aws-access-requirements.md
---

# feat: Tailscale subnet-router access to private AWS resources

> **Depends on `docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md`.** That consolidation gives prod and sandbox **distinct CIDRs** (`10.0.0.0/16` / `10.1.0.0/16`), which is the precondition for the single-router + VPC-peering design below. This plan must not start until 004 has landed. The earlier two-routers-plus-4via6 design is superseded: distinct CIDRs remove the site-ID disambiguation entirely.

> Note (2026-06-21): the platform now egresses via a t4g.nano NAT _instance_ (not a managed NAT Gateway) — see ADR-0004. References below to "the existing NAT gateway" mean that NAT instance; the router (a VPC-attached instance in the `private-app` / `PRIVATE_WITH_EGRESS` subnet) still reaches the tailnet through it.

## Summary

Add **one** Tailscale subnet router on a dedicated EC2 instance in the **prod** VPC so a solo Tailscale account can reach private resources in **both** the prod and sandbox VPCs — primarily the isolated RDS PostgreSQL — directly from a laptop. The router runs in the prod `private-app` subnet, advertises both VPC CIDRs (prod directly, sandbox over a VPC peering connection), and each stage's database security group is amended (ingress only) to admit the router. Resources land in the deployed **global** CDK app.

Two reachability details are carried as **working assumptions** (the pre-implementation spike is skipped) and verified early during the router build rather than gated up front: RDS resolves by hostname via Tailscale split-DNS to the VPC resolver, and the router has IP forwarding enabled (the build enables it explicitly). If by-hostname proves unworkable, fall back to addressing RDS by its private IP and amend R3/R5. U1 opens the production DB SG, so U2 confirms router connectivity before anything relies on it.

---

## Problem Frame

The identity RDS lives in `PRIVATE_ISOLATED` subnets with `publiclyAccessible: false`, reachable only from the ECS and Lambda security groups (`packages/infra/global/lib/platform/network-stack.ts:84-94`). There is no bastion, SSM tunnel, or VPN, so the database is unreachable from a laptop. Schema changes can only be applied through the in-VPC `MigrationFunction` Lambda (`packages/services/identity-webhooks/src/handlers/migrate.ts:56-138`); when that path stalls — the tracked "prod schema never migrated" issue — there is no way to connect and inspect the live schema or data. This plan delivers an on-tailnet path to the private databases without exposing anything publicly (see origin: `docs/brainstorms/2026-06-14-tailscale-private-aws-access-requirements.md`).

---

## Requirements

Traceability to the origin requirements doc. Some origin requirements are reshaped by the consolidation (004); the brainstorm is updated in lockstep.

**Routing and reachability**

- R1. A Tailscale subnet router runs in the prod VPC and advertises the prod VPC's address space to the tailnet. (origin R1)
- R2. The same prod router reaches the sandbox VPC's private resources over a VPC peering connection and advertises the sandbox CIDR — there is no separate sandbox router. (origin R2, reshaped by 004)
- R3. A laptop on the tailnet can open a PostgreSQL connection to each stage's private RDS. The exact client-addressing mechanism (RDS hostname vs. a DNS mapping) is settled by U6; if the spike shows by-hostname is unworkable, R3/R5 are amended in the origin rather than silently marked covered. (origin R3, F1)
- R4. Prod and sandbox are reached over **distinct, non-overlapping CIDRs** (from 004) plus a peering connection — no 4via6, no VPC renumbering inside this plan. (origin R4, reshaped by 004)
- R5. RDS is reachable without hardcoding the instance's raw private IP into client configuration, subject to the U6 spike outcome. (origin R5)

**Access control and security boundary**

- R6. Each stage's RDS security group admits `5432` from the prod router's security group (prod directly; sandbox cross-VPC over the peering connection), with the paired source-side egress rule required by the `allowAllOutbound: false` convention; the ingress rules share the router's lifecycle so they never outlive a working router. (origin R6)
- R7. The router exposes no public inbound; administrative access is over the tailnet or SSM Session Manager, not a public SSH rule. Session Manager access is IAM-gated and must be denied to the CI role (see U5). (origin R7)
- R8. Route reachability is restricted to the owner's identity via an explicit tailnet policy stanza (U5), not open to any future member. (origin R8)

**Operability**

- R9. The router node's key expiry is disabled so routes survive stop/start and the default expiry window; this is a per-node setting that must be re-applied after any instance replacement. (origin R9)
- R10. The router, peering, and supporting AWS resources are defined as CDK IaC in the deployed global app. (origin R10)
- R11. The router runs on a non-burstable Graviton instance in the prod `private-app` subnet, reaching Tailscale via the existing NAT gateway with no public IP. (origin R11)
- R12. The router is stopped when idle and started manually before a session; while stopped, both stages are unreachable by design. (origin R12)

---

## Key Technical Decisions

- **One prod router + VPC peering (set by 004).** With distinct CIDRs, a single prod-resident router advertises both `10.0.0.0/16` and `10.1.0.0/16`; sandbox traffic crosses a prod↔sandbox VPC peering connection. This is simpler than two routers and removes 4via6 entirely. The accepted trade-off is a deliberate prod↔sandbox network coupling, gated by route tables, the cross-VPC DB SG rule, and the tailnet ACL. Stopping the single router takes both stages offline (acceptable for solo, manual use).

- **RDS-by-hostname reachability — working assumption, verified in U2 (spike skipped).** RDS publishes only an IPv4 endpoint and the private IP can move on failover. The design assumes Tailscale split-DNS (a nameserver pointing at the VPC resolver, restricted to `*.rds.amazonaws.com`) makes `psql -h <name>` resolve to the private IP over the route. Rather than pre-proving this with a throwaway spike, U2 verifies connectivity right after the router comes up. If by-hostname fails, fall back to the private IP and amend R3/R5.

- **Deploys must fail loud, not half-open.** Opening a DB SG while the router silently fails to connect (missing SSM secret, unapproved route) leaves standing DB ingress with no benefit, and CloudFormation reports success because userdata exit codes aren't gated. Mitigation: (a) the instance carries a `CreationPolicy`/`cfn-signal` so userdata failure fails the deploy; (b) the DB ingress rules share the router's `tailscaleRouterEnabled` lifecycle so a rule and a working router are created/destroyed together.

- **Router in the global app; separate stack to avoid blast-radius coupling.** The deployed stacks are `packages/infra/global/lib/platform/`. The prod DB-ingress amendment stays inside the global `NetworkStack` (object-reference SG wiring, avoiding cross-stack-export pain). The EC2 instance, peering, and cross-VPC routes live in a **dedicated stack** in the same global app importing the already-exported subnet/SG IDs, so iterating on the router doesn't force the full service+webhooks+migration redeploy that any `NetworkStack` change triggers. (This resolves the earlier open question in favor of a separate stack.)

- **Paired ingress/egress on 5432 is mandatory.** Source SGs use `allowAllOutbound: false`; a DB ingress rule alone silently times out (`ENI_SG_RULES_MISMATCH`). The router SG (`allowAllOutbound: false`) gets egress _to_ each DB on 5432; each DB SG gets ingress _from_ the router. The router SG's `443/TCP` egress uses `ec2.Peer.anyIpv4()` and covers Tailscale control plane/DERP **and** SSM Session Manager **and** SSM Parameter Store. Router SG also needs UDP 3478 (STUN), UDP 41641, and DNS (53) to the VPC resolver.

- **Non-burstable Graviton, first raw EC2 construct.** No EC2/userdata/AMI precedent exists. Amazon Linux 2023 ARM64, `c7g.medium` (cheapest non-burstable Graviton; `m7g.medium` alternative). Stop-when-idle keeps cost to roughly $1.5–3/mo (one instance). The root EBS volume is encrypted (it holds the `tailscaled` node private key). AMI selection resolves at synth time, so an AMI roll on an unrelated global deploy could replace the instance — see replacement consequences.

- **OAuth client secret, fetched at boot from SSM, with bounded IAM.** The router authenticates with a Tailscale **OAuth client secret** (scope `auth_keys`, bound to `tag:subnet-router`) — not a personal API token, not a hand-rotated auth key. Tailscale accepts the OAuth secret directly as `--auth-key` and auto-mints a tagged key, so it never expires and survives instance replacement. Stored as an SSM **SecureString** at `/kitchensink/prod/tailscale/oauth-client-secret`, fetched at boot via the instance role. CDK L2 `StringParameter` cannot create a SecureString, so the parameter is created out-of-band as a deploy prerequisite (same pattern as the Clerk SSM params at `identity-service-stack.ts:181-189`). The instance role attaches `AmazonSSMManagedInstanceCore` for Session Manager, which grants broad `ssm:GetParameter*`; a permission boundary restricts parameter reads to `/kitchensink/prod/tailscale/*` so a compromised router can't read other secrets.

- **Instance replacement re-introduces failures the per-node settings prevent.** Stop/start preserves the EBS volume and `tailscaled` state, so R9 (key expiry disabled) and AE4 (no re-auth) hold. Replacement (userdata/AMI/instance-type change) provisions a fresh volume: the OAuth secret re-registers a **new node** with default 180-day expiry re-enabled and leaves a ghost node. So disable-key-expiry must be re-applied after replacement (runbook step), and AMI selection should be pinned or its replacement effect accepted explicitly.

- **Whole-VPC routes are a documented blast-radius tradeoff.** The router advertises full VPC CIDRs (origin decision) so future internal resources need no per-resource setup; the consequence is that a compromised laptop reaches every private-subnet resource in both VPCs for the session. The ADR names this; advertising only the `private-data` CIDRs is the considered tighter alternative.

- **Tailnet-side config is out-of-repo and operational.** The ACL grant (R8), `autoApprovers`, `tag:subnet-router` ownership, split-DNS for RDS hostnames, and disable-key-expiry (R9) are managed in the Tailscale admin console / tailnet policy file. They are captured as a runbook with literal policy fragments and as deploy prerequisites.

---

## High-Level Technical Design

Component and boot-time view. Directional, not implementation specification.

```mermaid
flowchart TB
  subgraph laptop[Developer laptop]
    TS[Tailscale client]
    PG[psql / ORM]
  end
  subgraph tailnet[Tailnet]
    CP[Control plane + DERP]
  end
  subgraph prod[Prod VPC 10.0.0.0/16]
    R[EC2 subnet router<br/>tailscaled, c7g.medium]
    PDB[(prod RDS)]
  end
  subgraph sb[Sandbox VPC 10.1.0.0/16]
    SDB[(sandbox RDS)]
  end
  SSM[SSM SecureString<br/>/kitchensink/prod/tailscale/*]

  PG --> TS
  TS <-->|encrypted| CP
  R <-->|outbound via NAT| CP
  R -.advertises 10.0.0.0/16 + 10.1.0.0/16.-> CP
  R -->|5432| PDB
  R -->|5432 over VPC peering| SDB
  R -->|GetParameter at boot| SSM
```

Boot sequence (userdata): enable IPv4 forwarding (sysctl) → install `tailscaled` (Amazon Linux 2023 ARM repo) → read OAuth client secret from SSM via instance role → `tailscale up --auth-key=<oauth-secret> --advertise-tags=tag:subnet-router --advertise-routes=10.0.0.0/16,10.1.0.0/16 --accept-dns=false` → on success `cfn-signal` success so the deploy passes; on any failure signal failure so the deploy goes red rather than leaving a DB SG open with a dead router → systemd keeps `tailscaled` running across stop/start using persisted state on the encrypted EBS volume.

---

## Implementation Units

**Sequencing:** plan 004 (VPC consolidation, distinct CIDRs) must land first. The pre-implementation reachability spike is **skipped** — its questions (RDS-by-hostname resolution, IP forwarding) are carried as working assumptions (see Key Technical Decisions) and verified early in U2's connectivity check, not as a separate blocking unit.

### U1. Router security group and prod RDS ingress

- **Goal:** Create the router security group and open the prod database to it, following the paired-rule convention, with the ingress rule tied to the router's lifecycle.
- **Requirements:** R6, R7, R11
- **Dependencies:** none (plan 004 landed)
- **Files:**
    - `packages/infra/global/lib/platform/network-stack.ts` (prod DB ingress from router SG)
- **Approach:** Create a `tailscaleRouterSecurityGroup` (`allowAllOutbound: false`). Gate the SG and the prod DB ingress rule on a `tailscaleRouterEnabled` signal so they never exist without a router. Add `databaseSecurityGroup.addIngressRule(routerSg, ec2.Port.tcp(5432), ...)` and the paired `routerSg.addEgressRule(databaseSecurityGroup, ec2.Port.tcp(5432), ...)`. Add router egress: `ec2.Port.tcp(443)` to `ec2.Peer.anyIpv4()` (Tailscale control plane/DERP + SSM Session Manager + SSM Parameter Store), `ec2.Port.udp(3478)`, `ec2.Port.udp(41641)`, DNS (`udp/tcp 53`) to the VPC resolver. Export the router SG id so the sandbox cross-VPC rule (U3) and the router stack (U2) can reference it. (Note: the duplicate `network-stack.ts` copies are removed by plan 004/U4 — no mirroring needed once 004 lands.)
- **Patterns to follow:** SG idiom and paired-egress comment at `network-stack.ts:39-109`; the `443` anyIpv4 + comment style at `:72-82`.
- **Test scenarios:**
    - Covers AE2. Synth asserts the prod DB SG has an ingress rule on 5432 from the router SG.
    - Synth asserts the router SG has the paired egress to the DB on 5432.
    - Synth asserts router SG egress on 443/TCP and 3478,41641/UDP.
    - Synth asserts the router SG has no 0.0.0.0/0 ingress.
    - Synth with `tailscaleRouterEnabled` off asserts neither the router SG nor the ingress rule is created.
- **Verification:** `npm run infra:synth --workspace=packages/infra/global` succeeds; `Template` assertions pass.

### U2. Router EC2 instance, IAM role, and userdata (dedicated stack)

- **Goal:** Stand up the single prod subnet-router instance in a dedicated stack, with boot-time Tailscale registration, SSM-sourced credentials, encrypted storage, fail-loud signaling, and a post-deploy connectivity check.
- **Requirements:** R1, R2, R3, R5, R7, R9, R10, R11
- **Dependencies:** U1
- **Files:**
    - `packages/infra/global/lib/platform/tailscale-router-stack.ts` (new dedicated stack; imports prod subnet + router SG ids)
    - `packages/infra/global/lib/platform/global-stack.ts` (instantiate the new stack for prod)
- **Approach:** Create an `ec2.Instance` in the prod `private-app` subnet (`PRIVATE_WITH_EGRESS`), `c7g.medium`, Amazon Linux 2023 ARM64, the router SG from U1, `associatePublicIpAddress: false`, **encrypted** root volume. IAM role with `ServicePrincipal('ec2.amazonaws.com')`, `AmazonSSMManagedInstanceCore`, a least-privilege inline grant for `ssm:GetParameter*` + `kms:Decrypt` scoped to `/kitchensink/prod/tailscale/*`, and a permission boundary restricting parameter reads to that path. Add a `CreationPolicy` so userdata must `cfn-signal` success. Userdata runs the HTD boot sequence advertising **both** CIDRs (`10.0.0.0/16,10.1.0.0/16`), `tag:subnet-router`, `--accept-dns=false`; enable IP forwarding.
- **Execution note:** Add the CDK `Template` test before wiring userdata details so the instance/role/policy/CreationPolicy shape is pinned first.
- **Technical design (directional):** userdata is a shell template; do not embed the resolved secret into the synthesized template — fetch at boot.
- **Patterns to follow:** IAM role + `grantRead` and SSM-resolved config at `identity-service-stack.ts:110-195`; SSM path layout `ssmParamPath` at `packages/services/identity-webhooks/infra/lib/config.ts:11`.
- **Test scenarios:**
    - Synth asserts exactly one `AWS::EC2::Instance` of type `c7g.medium`, no public IP, in a prod private-app subnet, encrypted root volume.
    - Synth asserts a `CreationPolicy`/signal on the instance.
    - Synth asserts the role attaches `AmazonSSMManagedInstanceCore` and an inline policy + boundary scoping `ssm:GetParameter*` to `/kitchensink/prod/tailscale/*`.
    - Synth asserts userdata advertises both CIDRs, uses `--advertise-tags=tag:subnet-router` and `--accept-dns=false`, and contains no literal secret.
- **Verification:** global synth succeeds for `STAGE=prod`; rendered userdata has the expected flags and `cfn-signal`; no secret literal in the template. After deploy, the connectivity check that replaces the spike: confirm the router registers, IP forwarding is on (enable in userdata), and a psql session reaches prod RDS **by hostname** via split-DNS; if hostname fails, fall back to the private IP and amend R3/R5.

### U3. VPC peering, cross-VPC routes, and sandbox RDS ingress

- **Goal:** Connect prod↔sandbox so the prod router reaches the sandbox RDS, and open the sandbox DB to the router.
- **Requirements:** R2, R4, R6
- **Dependencies:** U1, U2; plan 004 (distinct CIDRs)
- **Files:**
    - `packages/infra/global/lib/platform/tailscale-router-stack.ts` (peering connection + route entries)
    - `packages/infra/global/lib/platform/network-stack.ts` (sandbox DB SG ingress from the router SG)
- **Approach:** Create a VPC peering connection between the prod and sandbox VPCs (same account, same region — auto-accept). Add route-table entries: prod private-app subnets route `10.1.0.0/16` to the peering connection; sandbox private-data subnets route `10.0.0.0/16` back. Add `sandboxDatabaseSecurityGroup.addIngressRule(routerSg, ec2.Port.tcp(5432), ...)` with the paired router egress to the sandbox DB. Gate all of this on `tailscaleRouterEnabled`. Note: same-region same-account peering permits referencing the prod router SG as the source on the sandbox DB SG; confirm at implementation, else fall back to the prod CIDR as source.
- **Patterns to follow:** the paired-rule SG convention; standard `ec2.CfnVPCPeeringConnection` + route additions.
- **Test scenarios:**
    - Synth asserts a peering connection between the prod and sandbox VPCs.
    - Synth asserts prod route tables route the sandbox CIDR to the peering connection and vice versa.
    - Synth asserts the sandbox DB SG admits 5432 from the router SG (or prod CIDR) with the paired router egress.
- **Verification:** synth succeeds; a laptop session reaches the sandbox RDS through the prod router over peering (validated operationally per U5).

### U4. CDK assertion tests

- **Goal:** Lock the router, peering, and SG-rule pairing with `Template` assertions in the global package's test harness (added by plan 004/U4).
- **Requirements:** R6, R7, R10, R11
- **Dependencies:** U1, U2, U3
- **Files:**
    - `packages/infra/global/__tests__/tailscale-router.test.ts` (new)
- **Approach:** `Template.findResources('AWS::EC2::Instance')`, peering-connection and route assertions, and SG-rule pairing assertions covering U1–U3. Pre-seed VPC lookup context to avoid live AWS calls. (Plan 004/U4 establishes the global package's vitest harness; this builds on it.)
- **Test scenarios:** the consolidated assertions from U1–U3 run green. AE3 (key expiry) and AE4 (stop/start) are tailnet/runtime behaviors verified manually per U5, not asserted here.
- **Verification:** `npm run test --workspace=packages/infra/global` passes.

### U5. ADR, runbook, and tailnet/prerequisite setup

- **Goal:** Capture the decision and every out-of-repo prerequisite, security control, and operational procedure.
- **Requirements:** R3, R5, R7, R8, R9, R12
- **Dependencies:** U1–U4
- **Files:**
    - `docs/architecture/decisions/0003-tailscale-private-aws-access.md` (new ADR; 0002 is taken by the consolidation — confirm numbering)
    - `docs/runbooks/tailscale-subnet-router.md` (new)
- **Approach:** ADR records the EC2-over-Fargate choice, the one-router + peering decision (cross-referencing 004's Option A), the SG-pairing trap (ADR-0001 guard style), the SSM-SecureString deviation, the whole-VPC blast-radius tradeoff, the separate-stack decision, and the fail-loud deploy design. Runbook documents:
    1. **Prerequisites:** create the Tailscale OAuth client (`auth_keys` scope, `tag:subnet-router`) and the SSM SecureString; create the tailnet policy entries (note `tag:subnet-router` must be in `tagOwners` before first boot or the OAuth auto-mint is rejected).
    2. **Tailnet policy (literal):** the `autoApprovers` block for the advertised routes and the `grants`/`acls` stanza restricting both route sets to the owner identity (e.g., `autogroup:owner`) — with the stated blast radius if misconfigured (any tailnet member reaches prod + sandbox RDS).
    3. **Security controls:** IAM deny on `ssm:StartSession` for the router in the CI role (closes the CI-key→Session-Manager→VPC lateral path); enable RDS `log_connections`/`log_disconnections` and confirm VPC Flow Logs on the data subnets.
    4. **DNS/addressing:** the by-hostname mechanism for RDS confirmed in U2's connectivity check (split-DNS nameserver at the VPC resolver, restricted to `*.rds.amazonaws.com`), or the private-IP fallback if hostname resolution doesn't work.
    5. **Key expiry (AE3/R9):** disable on the node after first boot; re-apply after any instance replacement; reap ghost nodes.
    6. **Secret rotation/revocation:** rotate the OAuth client secret (new client → update SSM → restart) and revoke on suspected compromise.
    7. **Use (R12/AE4):** start/stop the instance for a session (note: stopping takes both stages offline); break-glass fallback to SSM port-forwarding if the Tailscale control plane is unavailable.
- **Test scenarios:** Test expectation: none — documentation/external config. Success: a psql session opens and `\dt` runs against both stages, independent of schema state.
- **Verification:** a reader can connect to prod and sandbox RDS by following the runbook; AE3/AE4 confirmed manually; ADR discoverable.

---

## Scope Boundaries

**Deferred for later** (from origin)

- High-availability routers (a second instance with failover).
- Multi-user / team access: per-engineer ACL grants and tags.
- Routing additional stages beyond prod and sandbox.

**Outside this iteration's shape** (from origin)

- App-connector (DNS-name) access instead of subnet routing.
- SSM Session Manager port-forwarding as the RDS access mechanism (used only for box administration and the break-glass fallback).
- Two routers / 4via6 — superseded by the consolidation's distinct CIDRs + peering.

**Deferred to Follow-Up Work** (plan-local)

- EventBridge scheduled auto-stop as a cost safety net (manual start/stop for v1).
- Narrowing the advertised routes from whole-VPC to the `private-data` CIDRs if blast radius becomes a concern.
- Optionally migrating the Tailscale OAuth secret from SSM SecureString to Secrets Manager to match repo norm.

---

## Risks & Dependencies

- **Hard dependency on plan 004.** The single-router + peering design requires distinct CIDRs. If 004 hasn't landed, peering is illegal (overlapping `10.0.0.0/16`). Mitigation: sequencing note at the top; U6 depends on 004.
- **RDS-by-hostname reachability may need a maintained DNS mapping.** RDS publishes only IPv4 and the private IP can move. Carried as a working assumption (split-DNS) with the spike skipped; mitigation: U2's post-deploy connectivity check confirms it, and R3/R5 fall back to the private IP if hostname resolution doesn't work.
- **Half-open exposure on deploy.** Mitigation: `CreationPolicy`/`cfn-signal` (U2) + ingress rules tied to the enable flag (U1/U3).
- **prod↔sandbox coupling (accepted, from 004 Option A).** Peering bridges the environments. Controls: scoped routes, the cross-VPC DB SG rule, and the tailnet ACL; reversible in ~5 minutes.
- **Instance replacement re-enables key expiry and discards EBS state.** Mitigation: AMI pinning or accepting replacement; runbook re-applies disable-key-expiry and reaps ghost nodes.
- **CI-key → Session Manager → VPC lateral movement.** Mitigation: IAM deny on the router for the CI role (U5).
- **Tailnet ACL misconfiguration.** A default-allow policy or over-broad `autoApprovers` lets any member reach both RDS instances. Mitigation: literal owner-scoped stanza (U5/R8).
- **Deploy prerequisites are out-of-band.** The SSM SecureString and Tailscale OAuth client/tailnet policy (incl. `tag:subnet-router` in `tagOwners`) must exist before deploy; gated by the `CreationPolicy`.

---

## Alternatives Considered

- **Two routers, one per VPC, no peering** — superseded by 004's Option A decision; kept AWS-layer isolation but cost a second instance, and the laptop bridges both VPCs regardless once the router lands.
- **4via6 to disambiguate identical CIDRs** — obviated by 004's distinct CIDRs.
- **Tailscale's official CloudFormation quick-create template for the prod router** — considered (preferred default for official vendor tooling), not adopted for the _deployed_ router. Specific reason: its userdata does not enable kernel IP forwarding, which a subnet router requires, and the quick-create exposes no hook to add it (`ExtraArgs` only passes flags to `tailscale up`; no flag enables forwarding). Patching it would mean wrapping the template in CDK and editing its userdata — more work than a native CDK instance. And the surrounding work (peering, cross-VPC routes, prod+sandbox DB-SG rules) is CDK in the global app regardless, so a standalone template stack adds a second deploy mechanism plus a cross-tool SG reference for no saved effort. Its `install + tailscale up` userdata is reused as the reference for the CDK userdata. The template **is** used for the throwaway reachability checks (`docs/runbooks/u6-rds-hostname-spike.md`).
- **Tailscale router on Fargate** — rejected; Tailscale recommends subnet routers external to ECS/EKS, and Fargate forces userspace networking with no persistent state.
- **Whole-VPC routes vs. data-subnet-only** — whole-VPC kept for future-resource convenience; data-subnet-only is the tighter alternative recorded in the ADR.
- **Deploy-time secret embedding** — rejected for boot-time SSM fetch so the resolved token never lands in the template.
- **Plain reusable auth key instead of OAuth client** — rejected; auth keys expire (90-day max) and would need manual rotation on instance replacement.

---

## Open Questions (Deferred to Implementation)

- RDS-by-hostname vs private-IP: confirmed in U2's post-deploy connectivity check; R3/R5 fall back to the IP mechanism if hostname resolution doesn't work.
- Whether the sandbox DB SG can reference the prod router SG directly across peering, or must use the prod CIDR as the source (confirmed at implementation).
- Final userdata package-install specifics for the Amazon Linux 2023 ARM Tailscale repo.

---

## System-Wide Impact

- **Security posture:** opens both DB SGs to a new source and places a VPN ingress into the prod VPC, bridged to sandbox via peering — the first non-AWS-native path into prod data. The tailnet ACL (R8), the CI-role Session Manager deny, and the bounded instance IAM are load-bearing controls. Threat model centers on a compromised laptop (network access to both advertised VPCs for the session) and CI-key lateral movement into the router.
- **Cost:** roughly $1.5–3/mo for the single router with manual stop-when-idle; peering connection is free (cross-AZ data transfer negligible).
- **CI/CD:** the router lives in a dedicated stack, so iterating on it does not force the full service/webhooks/migration redeploy. The first deploy requires SSM/tailnet prerequisites; the `CreationPolicy` makes a missing prerequisite a red deploy rather than a silent half-open state.

---

## Sources & Research

- Prerequisite: `docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md` (distinct CIDRs + Option A peering decision).
- Origin requirements: `docs/brainstorms/2026-06-14-tailscale-private-aws-access-requirements.md` (embeds the Tailscale documentation research — subnet routers, OAuth clients, the AWS RDS guide, key expiry).
- Deployed infra: `packages/infra/global/lib/platform/network-stack.ts:17-141`, `data-stack.ts:40-98`, `identity-global-stack.ts:33-49`.
- SG paired-egress convention and `443` anyIpv4 idiom: `packages/infra/global/lib/platform/network-stack.ts:72-109`.
- Compute/IAM/secret precedent: `packages/services/identity/infra/lib/identity-service-stack.ts:110-195`.
- SSM path convention: `packages/services/identity-webhooks/infra/lib/config.ts:11`.
- ADR precedent and "trap" guard style: `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`.
- Project memory: `prod-identity-db-access.md`, `clerk-instance-domains.md`.
