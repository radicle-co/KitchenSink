/**
 * A service's public origin for a stage, and the services that have one.
 *
 * ⛔ A DELIBERATE COPY of `@radicle-co/infra-shared/alb`, and the duplication is FORCED rather than careless.
 * That package is CDK's, and CDK deliberately installs outside the npm workspace so 149 MB of `aws-cdk-lib`
 * stops being hoisted into the root tree and shipped inside every service image. `@kitchensink/loadtest` is a
 * workspace package, so it cannot import the published one without dragging the registry dependency — and its
 * peer CDK — back into the root install this separation exists to keep clean.
 *
 * ⚠️ These two functions are pure, total and three lines long; what is expensive to lose is their AGREEMENT
 * with the constructs that create the DNS records, because a load test that resolves a host nothing serves
 * fails as a connection error rather than as a wrong answer. `publicOriginHostParity.test.ts` is the guard:
 * it runs both implementations over every service and stage shape and fails when they diverge, the same way
 * `messageTableNameParity.test.ts` guards the substrate table's name and ADR-0014 guards each service's
 * committed wire schemas.
 *
 * @module
 */

/**
 * The services registered on the shared ALB listener, in slot order.
 *
 * ⚠️ ORDER IS MEANING, not presentation — a service's ephemeral priority band is its INDEX here. Reordering
 * this tuple silently moves live listener-rule priorities.
 */
export const EPHEMERAL_SLOT_ORDER = ['identity', 'food', 'recipe'];

/**
 * The subdomain label a service's public origin uses at a stage. Pure, total.
 *
 * @param {string} service - The shared-listener service.
 * @param {string} stage - The deploy stage.
 * @returns {string} The single left-hand DNS label.
 */
export function publicSubdomainForStage(service, stage) {
    return stage === 'prod' ? service : `${service}-${stage}`;
}

/**
 * A service's full public origin for a stage — `https://`, no trailing slash. Pure, total.
 *
 * @param {string} service - The shared-listener service.
 * @param {string} stage - The deploy stage.
 * @param {string} domainName - The apex domain.
 * @returns {string} The origin.
 */
export function publicServiceOriginForStage(service, stage, domainName) {
    return `https://${publicSubdomainForStage(service, stage)}.${domainName}`;
}
