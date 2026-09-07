/**
 * Print a service's PUBLIC origin for a stage — so a k6 pipeline never has to know that host shape.
 *
 * The shape lives in exactly ONE place, `publicServiceOriginForStage` in `@kitchensink/infra-alb`
 * (`publicOriginHost.ts`): prod is the bare service label (`recipe.{apex}`), every other stage is the DASH
 * form (`recipe-{stage}.{apex}`) — a 3-label `recipe.pr-7.{apex}` matches no wildcard on the shared ALB
 * certificate and fails the TLS handshake before any listener rule is consulted (ADR-0003 / ADR-0006). This
 * script exposes that one definition to shell callers, which is what stops the k6 workflows from growing a
 * second, drifting copy of it in YAML.
 *
 * ⚠️ THIS EXISTS BECAUSE A HOST LITERAL IN YAML ROTS SILENTLY. `food-loadtest.yml` carried
 * `https://food-pr-59.commise.app` as its dispatch DEFAULT long after PR 59 closed — a name that resolves to
 * nothing, whose failure mode is a run that reports the target as down rather than the default as stale.
 * `packages/infra/global/__tests__/k6TargetsDeployedOrigins.test.ts` fails on any `*.commise.app` literal in
 * a workflow that drives k6, so the only way to name a target now is through this door.
 *
 * It is the sibling of `packages/services/food-service/infra/bin/printFoodHost.ts` — that one is food's own
 * door for the DEPLOY pipelines; this one is service-agnostic, for the LOAD pipeline, and both delegate to
 * the same authority rather than restating it.
 *
 * NOTE: this prints the origin a deploy at that stage WOULD serve. It does not check that anything is
 * actually deployed — that is the caller's business, and in `_ci-heavy.yml` it is the liveness probe that
 * follows, which turns an absent preview into a SKIP rather than a failure.
 *
 * ```sh
 * node packages/tools/loadtest/printPublicOrigin.mjs recipe pr-73 commise.app
 * # → https://recipe-pr-73.commise.app
 * ```
 *
 * @sideEffect Writes to stdout/stderr and sets a non-zero exit code on bad input.
 */
import { EPHEMERAL_SLOT_ORDER, publicServiceOriginForStage } from '@kitchensink/infra-alb';

const service = process.argv[2] ?? process.env['SERVICE'];
const stage = process.argv[3] ?? process.env['STAGE'];
const domainName = process.argv[4] ?? process.env['DOMAIN_NAME'];

const usage =
    'usage: printPublicOrigin.mjs <service> <stage> <domainName>   (or set SERVICE, STAGE and DOMAIN_NAME)\n' +
    `services: ${EPHEMERAL_SLOT_ORDER.join(', ')}\n` +
    'example: printPublicOrigin.mjs recipe pr-73 commise.app\n';

if (!service || !stage || !domainName) {
    process.stderr.write(usage);
    process.exitCode = 1;
} else if (!EPHEMERAL_SLOT_ORDER.includes(service)) {
    // Refused rather than passed through: `publicServiceOriginForStage` is total and would happily print
    // `https://typo-pr-7.commise.app`, and an unresolvable host reads as an outage rather than a typo.
    process.stderr.write(`unknown service '${service}'\n${usage}`);
    process.exitCode = 1;
} else {
    process.stdout.write(`${publicServiceOriginForStage(service, stage, domainName)}\n`);
}
