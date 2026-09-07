/**
 * The internal-origin hostname resolver (ADR-0020 / plan U15).
 *
 * This is the same class of knowledge as the priority allocator beside it — a fact about the SHARED
 * listener that several independently-deployed stacks must agree on — so it is tested to the same
 * standard. The failure it prevents is specific: the ALB listener rule's host condition, the Route 53
 * record, and (U16) the CloudFront origin must name the SAME host. Three stacks each spelling it
 * themselves is exactly the shape that drifted before, and a mismatch here does not fail at synth; it
 * fails as a TLS handshake error or a 404 from the shared listener's default action, in production.
 */
import { describe, it, expect } from 'vitest';

import { EPHEMERAL_SLOT_ORDER } from '../listenerPriority.js';
import { INTERNAL_ORIGIN_LABEL, internalOriginForStage, type SharedListenerService } from '../internalOriginHost.js';

const domainName = 'commise.app';

describe('internalOriginForStage', () => {
    it('resolves the three-label origin host for each service in prod', () => {
        expect(internalOriginForStage({ service: 'food', stage: 'prod', domainName })?.host).toBe(
            'food.internal.commise.app',
        );
        expect(internalOriginForStage({ service: 'recipe', stage: 'prod', domainName })?.host).toBe(
            'recipe.internal.commise.app',
        );
        expect(internalOriginForStage({ service: 'identity', stage: 'prod', domainName })?.host).toBe(
            'identity.internal.commise.app',
        );
    });

    it('returns a record name that composes with the apex zone back into the host', () => {
        // The listener rule matches `host`; Route 53 publishes `recordName` INSIDE the apex zone. If those
        // two disagree the name resolves to nothing (or the rule never matches) and the origin is dead —
        // so they are one function's two projections, and this is the property that binds them.
        for (const service of EPHEMERAL_SLOT_ORDER) {
            const origin = internalOriginForStage({ service, stage: 'prod', domainName });

            expect(origin).toBeDefined();
            expect(`${origin?.recordName}.${domainName}`).toBe(origin?.host);
        }
    });

    it('places the internal label BETWEEN the service and the apex, never the other way round', () => {
        // `internal.food.commise.app` is a real-looking transposition that the `*.internal.commise.app`
        // certificate does NOT cover — it would fail the handshake in exactly the way U15 exists to prevent.
        const origin = internalOriginForStage({ service: 'food', stage: 'prod', domainName });

        expect(origin?.host).toBe(`food.${INTERNAL_ORIGIN_LABEL}.${domainName}`);
        expect(origin?.host).not.toBe(`${INTERNAL_ORIGIN_LABEL}.food.${domainName}`);
    });

    it('is covered by the single-label wildcard the additive certificate actually issues', () => {
        // `*.internal.commise.app` matches exactly ONE label to the left of `.internal`. A service whose
        // prod host grew a second label would synth clean and fail TLS at the edge.
        for (const service of EPHEMERAL_SLOT_ORDER) {
            const host = internalOriginForStage({ service, stage: 'prod', domainName })?.host ?? '';
            const suffix = `.${INTERNAL_ORIGIN_LABEL}.${domainName}`;

            expect(host.endsWith(suffix)).toBe(true);
            expect(host.slice(0, -suffix.length)).not.toContain('.');
        }
    });

    it('returns undefined for every non-prod stage — only prod has an edge to origin from', () => {
        // KTD-7 scopes CloudFront to prod. Sandbox and per-PR previews reach their own ALB directly on the
        // public name, and no other stage's DomainStack mints the `*.internal` certificate at all, so an
        // internal host there would be a listener rule matching a name that can never terminate TLS.
        for (const stage of ['sandbox', 'pr-91', 'dev', 'test', 'local']) {
            expect(internalOriginForStage({ service: 'food', stage, domainName })).toBeUndefined();
        }
    });

    it('covers every service registered on the shared listener', () => {
        // Typed against the same union as the priority allocator: a service that can claim a rule can
        // resolve an internal origin. This asserts the pairing holds for the whole registry rather than
        // for the three names spelled out above.
        for (const service of EPHEMERAL_SLOT_ORDER) {
            expect(internalOriginForStage({ service, stage: 'prod', domainName })?.host).toBe(
                `${service}.${INTERNAL_ORIGIN_LABEL}.${domainName}`,
            );
        }
    });

    it('composes with any apex domain rather than hard-coding commise.app', () => {
        const service: SharedListenerService = 'recipe';

        expect(internalOriginForStage({ service, stage: 'prod', domainName: 'example.test' })?.host).toBe(
            'recipe.internal.example.test',
        );
    });
});
