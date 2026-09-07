/**
 * ⛔ THE ACCEPTANCE CRITERION for who owns a service's PUBLIC `{service}.{apex}` A-record (plan U17).
 *
 * ## Why this is a resolver and not an `if` in each stack
 *
 * The public record is claimed by exactly one CloudFormation stack. Today it is the service's own stack
 * (`FoodServiceStack.ts` and its two siblings each create a `{Service}ServiceAliasRecord` aliased to the
 * shared ALB); after U17's cutover it is `EdgeStack`, aliased to that service's CloudFront distribution.
 *
 * Those are two independently-deployed stacks, and **nothing at synth time can see both**. That leaves
 * exactly two ways to be wrong, and they fail at opposite ends:
 *
 * | Both claim it    | The second `cdk deploy` fails — Route 53 refuses a duplicate record. Loud, recoverable. |
 * | Neither claims it| The name stops resolving. The service is simply GONE from the internet, and every synth,     |
 * |                  | every unit test and every template diff is clean. Silent, and discovered by users.         |
 *
 * The second is the one that matters, and it is why ownership is a single total function over the same
 * service registry the listener-priority allocator and the internal-origin resolver are keyed on, rather
 * than a condition written out twice and free to drift — precisely the drift ADR-0003 records for listener
 * priorities, where a per-service copy put `recipe-pr-{N}` on food's priority.
 *
 * ## Why a typo has to be fatal
 *
 * The cut-over set arrives as an operator-supplied string at deploy time. `EDGE_CUTOVER_SERVICES=fod`
 * must not mean "food has not cut over yet" — under a partial cutover that reading silently produces the
 * "neither claims it" outage above, and under the steady state it hands a live production record back to
 * a stack that will then delete it. An unrecognized name is therefore a synth failure, never a default.
 */
import { describe, expect, it } from 'vitest';

import { EPHEMERAL_SLOT_ORDER } from '../listenerPriority.js';
import { cutOverServicesFromEnv, publicRecordOwnerFor } from '../publicRecordOwner.js';

const domainStage = 'prod';

describe('publicRecordOwnerFor', () => {
    it('gives every service to its OWN stack outside prod, whatever the cut-over set says', () => {
        // Sandbox and every per-PR preview have no distribution at all (ADR-0020 is prod-only). If a
        // stray `EDGE_CUTOVER_SERVICES` in a sandbox deploy could move ownership, the record would be
        // claimed by a stack that does not exist on that stage — the silent-outage half of the table above.
        for (const stage of ['sandbox', 'pr-91', 'dev', 'test', 'local']) {
            for (const service of EPHEMERAL_SLOT_ORDER) {
                expect(publicRecordOwnerFor({ service, stage, cutOverServices: EPHEMERAL_SLOT_ORDER })).toBe('service');
            }
        }
    });

    it('gives a prod service to the EDGE once it is in the cut-over set, and to its own stack until then', () => {
        const [first, ...rest] = EPHEMERAL_SLOT_ORDER;

        expect(publicRecordOwnerFor({ service: first, stage: domainStage, cutOverServices: [first] })).toBe('edge');

        // The whole point of a per-service set: the others must be untouched by the first one's cutover,
        // because U17 cuts one service at a time and verifies between each.
        for (const service of rest) {
            expect(publicRecordOwnerFor({ service, stage: domainStage, cutOverServices: [first] })).toBe('service');
        }
    });

    it('leaves every prod service with its own stack when nothing has cut over', () => {
        // The SAFE default, and the one an unset variable produces. A deploy that forgets the flag must
        // change nothing rather than cut all three at once.
        for (const service of EPHEMERAL_SLOT_ORDER) {
            expect(publicRecordOwnerFor({ service, stage: domainStage, cutOverServices: [] })).toBe('service');
        }
    });

    it('gives every prod service to the edge once all of them have cut over — the steady state', () => {
        for (const service of EPHEMERAL_SLOT_ORDER) {
            expect(publicRecordOwnerFor({ service, stage: domainStage, cutOverServices: EPHEMERAL_SLOT_ORDER })).toBe(
                'edge',
            );
        }
    });
});

describe('cutOverServicesFromEnv', () => {
    it('reads nothing as nobody — an unset variable is the safe default, not an error', () => {
        expect(cutOverServicesFromEnv({})).toEqual([]);
        expect(cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: '' })).toEqual([]);
        expect(cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: '   ' })).toEqual([]);
    });

    it('parses a comma-separated list, tolerating the spacing a human types', () => {
        const [first, second] = EPHEMERAL_SLOT_ORDER;

        expect(cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: `${first}, ${second}` })).toEqual([first, second]);
        expect(cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: ` ${first} ,${second} ` })).toEqual([first, second]);
    });

    it('accepts a repeated name without claiming the record twice', () => {
        const [first] = EPHEMERAL_SLOT_ORDER;

        expect(cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: `${first},${first}` })).toEqual([first]);
    });

    it('⛔ REFUSES an unrecognized name rather than reading it as "not cut over yet"', () => {
        // The defect this exists to prevent: a typo that synthesizes clean, deploys clean, and takes the
        // public name off the internet. The message has to name the offender and what is allowed, because
        // whoever sees it is mid-cutover on production.
        expect(() => cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: 'fod' })).toThrow(/fod/);
        expect(() => cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: 'fod' })).toThrow(
            new RegExp(EPHEMERAL_SLOT_ORDER.join('.*')),
        );
    });

    it('⛔ refuses an unrecognized name even when the rest of the list is valid', () => {
        // The realistic shape of the mistake — three names typed at 1am, one of them wrong.
        const valid = EPHEMERAL_SLOT_ORDER.join(',');

        expect(() => cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: `${valid},identiy` })).toThrow(/identiy/);
    });

    it('⛔ refuses a name that differs only in case, rather than silently matching it', () => {
        const [first] = EPHEMERAL_SLOT_ORDER;

        expect(() => cutOverServicesFromEnv({ EDGE_CUTOVER_SERVICES: first.toUpperCase() })).toThrow();
    });
});
