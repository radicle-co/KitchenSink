/**
 * ⛔ THE ACCEPTANCE CRITERION for who may reach the shared ALB on `:443` (plan U17, ADR-0020).
 *
 * The behaviour these values produce is asserted where it can actually be seen — across BOTH the
 * `NetworkStack` and `SharedAlbStack` templates, in `SharedAlbStack.test.ts`, because the defect this
 * lockdown is most likely to hit is a second opener in the OTHER stack. What belongs here is the rule
 * itself: prod locks down, every other stage must not, and the prefix-list id is a deliberate literal.
 */
import { describe, expect, it } from 'vitest';

import {
    CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST,
    CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT,
    albHttpsIngressPrefixListFor,
} from '../originLockdown.js';

describe('albHttpsIngressPrefixListFor', () => {
    it('locks prod down to the CloudFront origin-facing prefix list', () => {
        expect(albHttpsIngressPrefixListFor('prod')).toBe(CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST);
    });

    it('⛔ leaves every other stage open — no distribution fronts them, so a lockdown strands them', () => {
        // The failure this prevents is total and silent: a sandbox or per-PR ALB that answers only to
        // CloudFront, when no CloudFront distribution exists for that stage, is simply unreachable. Every
        // preview would 100% fail, with a green deploy.
        for (const stage of ['sandbox', 'pr-91', 'pr-1', 'dev', 'test', 'local', 'staging']) {
            expect(albHttpsIngressPrefixListFor(stage), `stage ${stage}`).toBeUndefined();
        }
    });

    it('⛔ is exact about the stage name — a near-miss must not lock anything down', () => {
        // `prod-2`, `preprod` and `PROD` are not prod. Matching them loosely would lock down a stage with
        // no distribution; the strictness IS the safety here.
        for (const stage of ['PROD', 'Prod', 'prod-2', 'preprod', 'prod ', ' prod']) {
            expect(albHttpsIngressPrefixListFor(stage), `stage ${stage}`).toBeUndefined();
        }
    });

    it('names a well-formed prefix-list id, not a CIDR or a security-group id', () => {
        // A `sg-` or a CIDR here would synthesize and deploy — into a rule admitting something entirely
        // different from CloudFront.
        expect(CLOUDFRONT_ORIGIN_FACING_PREFIX_LIST).toMatch(/^pl-[0-9a-f]+$/);
    });

    it('⛔ records a rule weight that leaves room for exactly ONE such rule', () => {
        // The quota trap, pinned as a number so it cannot drift out of the docstring silently. The weight
        // is what counts against the 60-rules-per-security-group quota — NOT the list's current entry
        // count, which was 46 when this was written. Two of these rules is 110 and the deploy fails.
        expect(CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT).toBe(55);
        expect(CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT * 2).toBeGreaterThan(60);
        expect(CLOUDFRONT_PREFIX_LIST_RULE_WEIGHT + 1).toBeLessThanOrEqual(60);
    });
});
