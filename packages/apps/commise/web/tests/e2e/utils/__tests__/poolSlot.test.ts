/**
 * Which fixed test-pool slot a Playwright process signs in as.
 *
 * Two facts the suite leans on and cannot see from inside a spec: a SHARD is its own user (so shard 3's
 * session-owning spec can never revoke a session shard 5 is holding), and the STUBBED tier never shares a user
 * with the DEPLOYED tier — both run on the same pull request at the same time.
 */
import { POOL_ROSTER, slotForShard } from '@kitchensink/e2e-fixtures/testPool';
import { describe, expect, it } from 'vitest';

import { webPoolSlot } from '../poolSlot';

describe('webPoolSlot', () => {
    it('leases the deployed tier’s lane for the shard', () => {
        expect(webPoolSlot({ COMMISE_E2E_SHARD: '3' })).toEqual(slotForShard('web', 3));
    });

    it('leases the STUBBED tier’s lane when the run is mocked-only', () => {
        expect(webPoolSlot({ COMMISE_E2E_SHARD: '3', PLAYWRIGHT_MOCKED_ONLY: '1' })).toEqual(
            slotForShard('webStub', 3),
        );
        expect(webPoolSlot({ COMMISE_E2E_SHARD: '3', PLAYWRIGHT_MOCKED_ONLY: '1' }).email).not.toBe(
            webPoolSlot({ COMMISE_E2E_SHARD: '3' }).email,
        );
    });

    it('treats an unsharded run (a developer machine) as shard 1', () => {
        expect(webPoolSlot({})).toEqual(slotForShard('web', 1));
        expect(webPoolSlot({ COMMISE_E2E_SHARD: '' })).toEqual(slotForShard('web', 1));
    });

    it.each(['abc', '0', '-2', '1.5'])('refuses a malformed shard %j rather than guessing a user', (shard) => {
        expect(() => webPoolSlot({ COMMISE_E2E_SHARD: shard })).toThrow(/shard/u);
    });

    it('refuses a shard the tier has no lane for', () => {
        expect(() => webPoolSlot({ COMMISE_E2E_SHARD: String(POOL_ROSTER.web.length + 1) })).toThrow(/declares only/u);
    });

    it('reads only the literal "1" as mocked-only', () => {
        expect(webPoolSlot({ PLAYWRIGHT_MOCKED_ONLY: 'true' }).tier).toBe('web');
        expect(webPoolSlot({ PLAYWRIGHT_MOCKED_ONLY: '0' }).tier).toBe('web');
    });
});
