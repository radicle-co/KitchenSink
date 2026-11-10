/**
 * Decide a pending food publication request as the sandbox staff principal.
 *
 * Usage: `npm run decide-publication --workspace=@kitchensink/e2e-seed -- <foodId> approve`
 *        `npm run decide-publication --workspace=@kitchensink/e2e-seed -- <foodId> decline "<reason>"`
 *
 * The target is `E2E_SEED_FOOD_URL`, and {@link decidePublication} refuses anything that is not a sandbox before a
 * token is minted. The identity is the `k6` tier's `admin` lane (scope `food:admin`).
 */
import { remintFromSession } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { readFoodOrigin, readSeedEnvironment } from './env.js';
import { decidePublication, type StaffDecision } from './foodStaff.js';
import { memoizingTokenSource } from './tokenSource.js';

/** Read the decision from the command line, refusing anything else. Pure. */
function decisionOf(argv: readonly string[]): { readonly foodId: string; readonly decision: StaffDecision } {
    const [foodId, verb, ...reason] = argv;

    if (foodId === undefined || (verb !== 'approve' && verb !== 'decline')) {
        throw new Error('usage: decide-publication <foodId> approve | decline "<reason>"');
    }

    if (verb === 'approve') {
        return { foodId, decision: { approve: true } };
    }

    if (reason.join(' ').trim() === '') {
        throw new Error('decide-publication: a decline needs a reason, the words the author reads');
    }

    return { foodId, decision: { approve: false, reason: reason.join(' ') } };
}

const env = readSeedEnvironment(process.env);
const foodOrigin = readFoodOrigin(process.env);
const { foodId, decision } = decisionOf(process.argv.slice(2));

await decidePublication({
    foodOrigin,
    foodId,
    decision,
    token: async () => {
        const session = (
            await leaseSession({
                slot: slotFor('k6', 'admin'),
                publishableKey: env.clerkPublishableKey,
                origin: env.webOrigin,
                port: clerkLeasePort(env.clerkSecretKey),
            })
        ).handle;

        return memoizingTokenSource(session, { remint: remintFromSession })();
    },
});

console.error(`decide-publication: ${decision.approve ? 'approved' : 'declined'} food ${foodId} at ${foodOrigin}`);
