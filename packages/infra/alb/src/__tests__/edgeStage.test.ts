/**
 * ⛔ THE ACCEPTANCE CRITERION for the ONE fact four resolvers in this package depend on: which stage is
 * fronted by the CloudFront edge.
 *
 * Four modules gate on it — `internalOriginHost` (only that stage has an origin name), `publicRecordOwner`
 * (only that stage can hand its public record to the edge), `originLockdown` (only that stage restricts
 * `:443` to CloudFront) and `edgeOriginHeader` (only that stage sends the secret origin header). Each
 * briefly kept its own private `const EDGE_STAGE = 'prod'`.
 *
 * That is duplicated KNOWLEDGE, not a look-alike. The test in `docs/CODING_STANDARDS.md`'s DRY rule is
 * whether the fragments change for the SAME reason, and these do: standing an edge up in front of sandbox
 * would move all four together, and moving three of the four is a configuration that cannot work — an ALB
 * locked to CloudFront on a stage with no distribution is unreachable, and a distribution whose origin has
 * no internal name resolves to nothing.
 *
 * So the constant lives once, and this file asserts the property that actually matters: **the four
 * resolvers agree, for every stage**. A shared constant alone would not prove that — one of them could
 * still compare it with `startsWith` or lowercase the input and drift while importing the same string.
 */
import { describe, expect, it } from 'vitest';

import { EDGE_STAGE } from '../edgeStage.js';
import { EPHEMERAL_SLOT_ORDER } from '../listenerPriority.js';
import { albHttpsIngressPrefixListFor } from '../originLockdown.js';
import { edgeOriginHeaderFor } from '../edgeOriginHeader.js';
import { internalOriginForStage } from '../internalOriginHost.js';
import { publicRecordOwnerFor } from '../publicRecordOwner.js';

/** Stages the repo actually deploys, plus the near-misses most likely to be matched loosely. */
const STAGES = ['prod', 'sandbox', 'pr-1', 'pr-91', 'dev', 'test', 'local', 'PROD', 'prod-2', 'preprod', ''];

describe('the edge stage is one fact', () => {
    it('names prod — the only stage with a distribution (ADR-0020)', () => {
        expect(EDGE_STAGE).toBe('prod');
    });

    it('⛔ has all four edge resolvers agree on every stage, not merely share a constant', () => {
        // The invariant a shared constant does NOT buy. Each resolver answers "is this the edge stage?" in
        // its own vocabulary; they must never disagree, because every disagreement is an unreachable
        // deployment rather than a degraded one.
        for (const stage of STAGES) {
            const isEdge = stage === EDGE_STAGE;

            expect(
                internalOriginForStage({ service: 'food', stage, domainName: 'example.com' }) !== undefined,
                `internalOriginForStage disagreed for '${stage}'`,
            ).toBe(isEdge);

            expect(
                albHttpsIngressPrefixListFor(stage) !== undefined,
                `albHttpsIngressPrefixListFor disagreed for '${stage}'`,
            ).toBe(isEdge);

            expect(edgeOriginHeaderFor(stage) !== undefined, `edgeOriginHeaderFor disagreed for '${stage}'`).toBe(
                isEdge,
            );

            // `publicRecordOwnerFor` is the odd one out by construction: outside the edge stage it returns
            // `service` no matter what the cut-over set says, so the equivalent question is whether the
            // edge can EVER own the record there.
            const canReachEdge =
                publicRecordOwnerFor({ service: 'food', stage, cutOverServices: EPHEMERAL_SLOT_ORDER }) === 'edge';

            expect(canReachEdge, `publicRecordOwnerFor disagreed for '${stage}'`).toBe(isEdge);
        }
    });

    it('⛔ is matched EXACTLY by every resolver — a near-miss stage must light up none of them', () => {
        // `prod-2` and `preprod` are the realistic typos, and a loose match on any ONE resolver is enough
        // to strand a stage: locking an ALB to CloudFront where no distribution exists takes it off the
        // internet, with a clean template and a green deploy.
        for (const stage of ['PROD', 'Prod', 'prod-2', 'preprod', 'prod ', ' prod', 'production']) {
            expect(internalOriginForStage({ service: 'food', stage, domainName: 'example.com' })).toBeUndefined();
            expect(albHttpsIngressPrefixListFor(stage)).toBeUndefined();
            expect(edgeOriginHeaderFor(stage)).toBeUndefined();
        }
    });
});
