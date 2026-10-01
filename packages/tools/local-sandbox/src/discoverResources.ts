/**
 * @module discoverResources — what a synthesised CDK template says the sandbox must stand up.
 *
 * ⛔ DERIVED FROM THE TEMPLATE, NEVER FROM A LIST. The CDK app is the only authority on what infrastructure
 * exists; a hand-maintained inventory of "the services we have" is precisely the artefact that rots. This
 * repo has the scars — `natEgressConsumers` was written around four Lambdas and had reached seventeen
 * before anyone noticed, and the ADR it belonged to had a live decision taken on the stale figure.
 *
 * So a new queue, bucket, parameter or database is picked up the day it synthesises, with no edit here.
 */
import { localSupportFor, type LocalSupport } from './localSupport.js';

/** One resource a template declares, reduced to what a local sandbox cares about. */
export interface DiscoveredResource {
    /** The stack the resource was declared in. */
    readonly stack: string;
    /** The template's logical id. */
    readonly logicalId: string;
    /** The CloudFormation type. */
    readonly type: string;
    /** How it is stood up locally, or `undefined` when the support table has never seen this type. */
    readonly support: LocalSupport | undefined;
}

/** The shape of a synthesised template, narrowed to the part this module reads. */
export interface SynthesizedTemplate {
    readonly Resources?: Readonly<Record<string, { readonly Type?: unknown }>> | undefined;
}

/**
 * Reduce one synthesised template to its local-sandbox inventory.
 *
 * ⚠️ A resource whose `Type` is absent or not a string is SKIPPED rather than guessed at. A template that
 * malformed is a CDK bug, and inventing a type for it would put a fictional resource in the report.
 *
 * @param stack - The stack name, carried through so a finding can be traced back.
 * @param template - The synthesised template.
 * @returns One entry per declared resource. Pure.
 */
export function discoverResources(stack: string, template: SynthesizedTemplate): readonly DiscoveredResource[] {
    return Object.entries(template.Resources ?? {}).flatMap(([logicalId, resource]) => {
        const type = resource.Type;

        if (typeof type !== 'string') {
            return [];
        }

        return [{ stack, logicalId, type, support: localSupportFor(type) }];
    });
}

/** What a local sandbox must actually run, folded across every discovered resource. */
export interface SandboxRequirements {
    /** LocalStack `SERVICES` entries, sorted and de-duplicated. */
    readonly localstackServices: readonly string[];
    /** Stock container images that must be running (real, pullable references). */
    readonly containers: readonly string[];
    /**
     * OUR services, as resources rather than types.
     *
     * ⛔ Resources, not a `Set<string>` of types. Which image, which port and which environment a service
     * needs are per-RESOURCE facts carried in the template's `Properties`; folding them to a type would
     * throw away exactly the data a runner needs and leave the caller with the word "service".
     */
    readonly services: readonly DiscoveredResource[];
    /** Resources that represent ordered SQL which must be applied before anything starts (ADR-0022). */
    readonly migrations: readonly DiscoveredResource[];
    /** Types that cannot be emulated, with the reason, so a local run never claims to cover them. */
    readonly unsupported: readonly { readonly type: string; readonly why: string }[];
    /**
     * Types the support table has never seen.
     *
     * ⛔ THE POINT OF THE WHOLE MODULE. A type landing here means infrastructure was added that nobody has
     * decided how to run locally — the exact drift a hand-kept list hides. It is reported as a finding, and
     * the audit exits non-zero on it, so the decision is forced rather than deferred.
     */
    readonly undecided: readonly string[];
}

/**
 * Fold discovered resources into what must be started.
 *
 * @param resources - Every resource across every stack.
 * @returns The requirements, each list sorted so the output is stable to diff. Pure.
 */
export function summarizeRequirements(resources: readonly DiscoveredResource[]): SandboxRequirements {
    const localstack = new Set<string>();
    const containers = new Set<string>();
    const services: DiscoveredResource[] = [];
    const migrations: DiscoveredResource[] = [];
    const unsupported = new Map<string, string>();
    const undecided = new Set<string>();

    for (const resource of resources) {
        if (resource.support === undefined) {
            undecided.add(resource.type);
            continue;
        }

        switch (resource.support.kind) {
            case 'localstack':
                localstack.add(resource.support.service);
                break;
            case 'container':
                containers.add(resource.support.image);
                break;
            case 'service':
                services.push(resource);
                break;
            case 'migration':
                migrations.push(resource);
                break;
            case 'unsupported':
                unsupported.set(resource.type, resource.support.why);
                break;
            case 'not-needed':
                break;
        }
    }

    return {
        localstackServices: [...localstack].sort(),
        containers: [...containers].sort(),
        services,
        migrations,
        // ⚠️ `unsupported.entries()`, NOT `[...unsupported].entries()`. The second spreads the Map into an
        // array of pairs and then indexes THAT, yielding `[0, ['type', 'why']]` — a shape that satisfies a
        // length assertion and carries nothing readable.
        unsupported: [...unsupported.entries()]
            .map(([type, why]) => ({ type, why }))
            .sort((a, b) => a.type.localeCompare(b.type)),
        undecided: [...undecided].sort(),
    };
}
