/**
 * THE authority for each service's PUBLIC origin hostname (plan U18) — the sibling of
 * `internalOriginHost.ts`, for the outside face.
 *
 * ## Why this moved here from per-service stack modules
 *
 * `foodSubdomainForStage` lived in `FoodServiceStack.ts` and `recipeSubdomainForStage` in
 * `RecipeServiceStack.ts` — one shape, two copies, exactly the drift `listenerPriority.ts` and
 * `internalOriginHost.ts` were extracted to end. The moment U18 gave the food service a runtime call INTO
 * the recipe service (the authored-food delete's reference check), a third restatement was about to appear
 * in food's stack. The shape lives here once; the per-service modules now delegate and re-export.
 *
 * ## The shape (ADR-0003 / ADR-0006)
 *
 * Prod is the bare service label (`recipe.{apex}`); every other stage is the DASH form
 * (`recipe-{stage}.{apex}`) — a 3-label `recipe.pr-7.{apex}` matches no wildcard on the shared ALB
 * certificate and fails the TLS handshake before any listener rule is consulted.
 */

import { type SharedListenerService } from './listenerPriority.js';

/**
 * A service with a public origin of its own: every shared-listener service, and the remote search CDN (ADR-0055),
 * which has a hostname on the same certificate but no listener rule, so it takes no priority band.
 */
export type PublicOriginService = SharedListenerService | 'remote-search';

/**
 * The subdomain label a service's public origin uses at a stage. Pure, total.
 *
 * @param service - The service.
 * @param stage - The deploy stage.
 * @returns The single left-hand DNS label.
 */
export function publicSubdomainForStage(service: PublicOriginService, stage: string): string {
    return stage === 'prod' ? service : `${service}-${stage}`;
}

/**
 * A service's full public origin for a stage — `https://`, no trailing slash. Pure, total.
 *
 * @param service - The service.
 * @param stage - The deploy stage.
 * @param domainName - The apex domain.
 * @returns The origin.
 */
export function publicServiceOriginForStage(service: PublicOriginService, stage: string, domainName: string): string {
    return `https://${publicSubdomainForStage(service, stage)}.${domainName}`;
}
