/**
 * Who owns a service's public `{service}.{apex}` A-record — its own stack, or the CloudFront edge (U17).
 *
 * The record is a single Route 53 resource claimed by exactly one CloudFormation stack, and the two
 * candidates deploy independently: the service's stack (aliasing the shared ALB) and `EdgeStack` (aliasing
 * that service's distribution). Nothing at synth time sees both, so the condition selecting between them
 * lives here ONCE rather than being written out in each — the same reason listener priorities are allocated
 * centrally (ADR-0003, where a per-service copy drifted and collided) and internal origin hosts are
 * resolved centrally (`internalOriginHost.ts`).
 *
 * Of the two ways to get it wrong, only one is loud: if both stacks claim the record the second deploy
 * fails on a duplicate, whereas if neither claims it the name stops resolving with every template, synth
 * and test still clean. This module exists for the second.
 *
 * @implements ADR-0020
 */
import { EDGE_STAGE } from './edgeStage.js';
import { EPHEMERAL_SLOT_ORDER, type SharedListenerService } from './listenerPriority.js';

/** The deploy-time variable naming the services whose cutover has already happened. */
export const EDGE_CUTOVER_SERVICES_ENV = 'EDGE_CUTOVER_SERVICES';

/** Which stack creates the public A-record. */
export type PublicRecordOwner = 'edge' | 'service';

/** Everything needed to resolve one service's public-record owner. */
export interface PublicRecordOwnerRequest {
    /** The service claiming the record — the same registry priorities and internal origins are keyed on. */
    readonly service: SharedListenerService;
    /** The deploy stage (`prod`, `sandbox`, `pr-{N}`, …). Only `prod` can move ownership. */
    readonly stage: string;
    /** The services already cut over, from {@link cutOverServicesFromEnv}. */
    readonly cutOverServices: readonly SharedListenerService[];
}

/**
 * Resolve which stack owns one service's public A-record. Pure and total.
 *
 * @param request - The service, its stage, and the set of services already cut over.
 * @returns `edge` when CloudFront owns the name, `service` when the service's own stack still does.
 */
export function publicRecordOwnerFor(request: PublicRecordOwnerRequest): PublicRecordOwner {
    const { service, stage, cutOverServices } = request;

    // Outside prod there is no distribution to alias, so the cut-over set is not merely irrelevant —
    // honouring it would hand the record to a stack that does not exist on that stage.
    if (stage !== EDGE_STAGE) {
        return 'service';
    }

    return cutOverServices.includes(service) ? 'edge' : 'service';
}

/**
 * Parse the cut-over set from the environment.
 *
 * Unset or blank yields the EMPTY set — the safe default, under which every service keeps the record it
 * has today and a deploy that forgets the variable changes nothing.
 *
 * An unrecognized name THROWS rather than being ignored. Ignoring it reads a typo as "this service has not
 * cut over yet", which during a partial cutover leaves the public name owned by nobody, and in the steady
 * state hands a live production record back to a stack that will delete it. Both present as an outage with
 * a clean template.
 *
 * @param env - The environment to read, e.g. `process.env`.
 * @returns The distinct services already cut over, in registry order.
 * @throws When a listed name is not a known service.
 */
export function cutOverServicesFromEnv(
    env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): readonly SharedListenerService[] {
    const raw = env[EDGE_CUTOVER_SERVICES_ENV]?.trim() ?? '';

    if (raw === '') {
        return [];
    }

    const named = new Set(
        raw
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ''),
    );

    for (const entry of named) {
        // Deliberately case-SENSITIVE and exact: the value is compared against the same registry the
        // listener-priority allocator uses, and a lenient match here would be a second, looser definition
        // of what a service is called.
        if (!(EPHEMERAL_SLOT_ORDER as readonly string[]).includes(entry)) {
            throw new Error(
                `${EDGE_CUTOVER_SERVICES_ENV} names an unknown service '${entry}'. ` +
                    `Allowed: ${EPHEMERAL_SLOT_ORDER.join(', ')}. Leaving it unrecognized would read as ` +
                    "'not cut over yet' and take the public record off the internet.",
            );
        }
    }

    // Registry order, not the operator's typing order, so the result is canonical.
    return EPHEMERAL_SLOT_ORDER.filter((service) => named.has(service));
}
