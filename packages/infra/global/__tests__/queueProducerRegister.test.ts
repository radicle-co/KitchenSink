// @vitest-environment node
/**
 * Repo-wide guard: **every SQS or SNS authority in this repository is in the register below, and nothing may
 * purge or drain a queue it does not consume.**
 *
 * ## Why
 *
 * A queue's contents are only trustworthy if the set of principals that can write to it is known. "Only a
 * queue's own producer may send to it" is the claim that makes a message with no owning row *junk by
 * definition* rather than merely unexplained — the consumer-side rule the queue guarantees rest on. A claim
 * like that has to be checked rather than described: `deletionWorker.ts` promised a DLQ alarm for months
 * while none existed, and ADR-0004's consumer table went stale three times before it was asserted.
 *
 * ## Why it reads TWO idioms
 *
 * This repository grants queue access two ways, and a guard that saw one would report a clean tree while the
 * other drifted:
 *
 * - CDK's own helpers — `queue.grantSendMessages(role)`, `grantConsumeMessages`, `topic.grantPublish`.
 * - Hand-written statements — `new iam.PolicyStatement({ actions: ['sqs:SendMessage'], … })`, which
 *   `RecipeServiceStack` uses because it reaches its queues by ARN through SSM rather than by construct.
 *
 * Both are discovered here. `serviceInfraWiringInvariants.test.ts` (W1) asks a different question — whether a
 * service that is HANDED a queue URL can act on it — and neither replaces the other.
 */
import { describe, expect, it } from 'vitest';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/**
 * Who may do what, per infra file. Each entry is `<subject>.<authority>(<grantee>)` exactly as the source
 * spells it, or `iam:<action>` for a hand-written statement.
 *
 * ⚠️ `parseQueue.grantConsumeMessages(verificationRole)` is not a typo: the parse and verification consumers
 * deliberately share ONE role, because ADR-0024 layer 4b grants `bedrock:InvokeModel` to exactly one
 * execution role and both legs call Bedrock. `llmSpendGuards.test.ts` is what holds that to one grantee.
 */
const REGISTER: Readonly<Record<string, readonly string[]>> = {
    'packages/services/identity-webhooks/infra/lib/WebhooksStack.ts': [
        // The queue BACKSTOP (plan U12) reads depth and nothing else. `iam:sqs:GetQueueAttributes` appears
        // beside these because the raw-action regex also matches the action string inside `grant(…)` — the
        // same authority seen twice, by two readers, which is the redundancy that makes a dropped `.grant`
        // visible rather than silent.
        "deletionDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        "deletionQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        'deletionQueue.grantConsumeMessages(deletionWorkerRole)',
        'deletionQueue.grantSendMessages(tombstoneSweepRole)',
        'deletionQueue.grantSendMessages(webhookRole)',
        'handleSyncTopic.grantPublish(webhookRole)',
        'iam:sqs:GetQueueAttributes',
    ],
    'packages/services/identity/infra/lib/IdentityServiceStack.ts': [
        'deletionQueue.grantSendMessages(taskRole)',
        'handleSyncTopic.grantPublish(taskRole)',
    ],
    'packages/services/recipe-service/infra/lib/RecipeServiceStack.ts': ['iam:sqs:SendMessage'],
    'packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts': [
        'iam:sqs:GetQueueAttributes',
        // The queue BACKSTOP (plan U12) reads depth on eight queues and holds NO other authority on any of
        // them. Enumerated one per line rather than looped, so a ninth queue joining its reach is a visible
        // change to this register — see the stack's own note at the grants.
        "parseDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        "parseQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        'parseQueue.grantConsumeMessages(verificationRole)',
        "this.archiveDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        "this.archiveQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        'this.archiveQueue.grantConsumeMessages(workerRole)',
        'this.archiveQueue.grantSendMessages(sweeperRole)',
        'this.erasureQueue.grantConsumeMessages(erasureRole)',
        'this.erasureQueue.grantSendMessages(erasureSweeperRole)',
        "this.handleSyncDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        "this.handleSyncQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        'this.handleSyncQueue.grantConsumeMessages(handleSyncRole)',
        "verificationDlq.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        "verificationQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')",
        'verificationQueue.grantConsumeMessages(verificationRole)',
        'verificationQueue.grantSendMessages(bandDrainRole)',
    ],
};

/**
 * The CDK helpers that confer a queue or topic authority. `grantPurge` is present on purpose — see the purge
 * assertion below, which needs to SEE one in order to refuse it.
 *
 * ⛔ `grant` IS IN THE LIST, and it is the one that carries an ACTION rather than implying one. Without it,
 * `queue.grant(role, 'sqs:GetQueueAttributes')` was discovered only by the raw-action regex — as a bare
 * `iam:sqs:GetQueueAttributes` with the GRANTEE thrown away — and the register could then record that some
 * role in the file may read some queue's attributes. The queue backstop's whole claim is about WHICH role
 * (plan U12: the check role holds no queue mutation), and a register that cannot name the grantee cannot
 * carry that claim.
 *
 * ⚠️ It is safe to add because the alternation is anchored on `(`: `grantSendMessages(` cannot match
 * `grant` followed by `(`, so the longer names still win. No production infra file used a bare `.grant(`
 * before the backstop landed.
 */
const GRANT_METHODS = ['grantSendMessages', 'grantConsumeMessages', 'grantPublish', 'grantPurge', 'grant'] as const;

/** SQS actions a hand-written policy statement may name. */
const SQS_ACTION = /['"`]sqs:([A-Za-z]+)['"`]/gu;

/**
 * Every queue or topic authority `source` confers, as `<subject>.<method>(<grantee>)` or `iam:<action>`.
 *
 * @param source - Source with its comments removed.
 * @returns The authorities, deduplicated and sorted. Pure.
 */
export function queueAuthorities(source: string): readonly string[] {
    const helper = new RegExp(`([A-Za-z_$][\\w$.]*)\\.(${GRANT_METHODS.join('|')})\\(([^)]*)\\)`, 'gu');
    const found = [...source.matchAll(helper)].map((match) => `${match[1]}.${match[2]}(${(match[3] ?? '').trim()})`);
    const statements = [...source.matchAll(SQS_ACTION)].map((match) => `iam:sqs:${match[1] ?? ''}`);

    return [...new Set([...found, ...statements])].sort();
}

/**
 * Whether an authority is the queue backstop's one permitted power: reading a queue's attributes.
 *
 * ⛔ AN ALLOWLIST OF ONE SHAPE, never a denylist of mutations. A denylist has to enumerate every spelling of
 * "can change the queue" — `grantConsumeMessages`, `grantPurge`, a raw `sqs:DeleteMessage`, and whichever
 * helper CDK adds next — and the one it has not heard of passes. This asks the opposite question, so a new
 * spelling fails by default.
 *
 * @param authority - An authority as `queueAuthorities` spells it.
 * @returns `true` only for `<queue>.grant(<role>, 'sqs:GetQueueAttributes')`. Pure.
 */
export function readsAttributesOnly(authority: string): boolean {
    return /\.grant\(\w+, 'sqs:GetQueueAttributes'\)$/u.test(authority);
}

/** Every authority, per production infra file. */
function discovered(): Record<string, readonly string[]> {
    const authorities: Record<string, readonly string[]> = {};

    for (const path of productionSources()) {
        const found = queueAuthorities(withoutTsComments(readSource(path)));

        if (found.length > 0) {
            authorities[path] = found;
        }
    }

    return authorities;
}

describe('queue and topic authorities', () => {
    it('reads BOTH idioms — the CDK helper and the hand-written statement', () => {
        // Fired at fakes rather than at the tree, so the extractor is proved to see a violation even when the
        // real sources contain none.
        expect(queueAuthorities('parseQueue.grantSendMessages(someRole);')).toEqual([
            'parseQueue.grantSendMessages(someRole)',
        ]);
        expect(queueAuthorities("new iam.PolicyStatement({ actions: ['sqs:PurgeQueue'] })")).toEqual([
            'iam:sqs:PurgeQueue',
        ]);
        expect(queueAuthorities('topic.grantPublish(role)')).toEqual(['topic.grantPublish(role)']);
        expect(queueAuthorities('const x = 1;')).toEqual([]);
    });

    it('discovers authorities — an empty scan would pass everything below', () => {
        expect(Object.keys(discovered()).length).toBeGreaterThanOrEqual(4);
    });

    it('match the register exactly, in both directions', () => {
        expect(discovered()).toEqual(REGISTER);
    });

    it('⛔ grant NOBODY the right to purge or drain a queue it does not consume', () => {
        // A purge deletes in-flight messages and cannot be undone, and SQS gives no per-message delete to a
        // non-consumer. Nothing in this repository purges today, and the queue backstop is specified to hold
        // no such right — so the safe state is asserted rather than assumed.
        const purges = Object.values(discovered())
            .flat()
            .filter((authority) => /grantPurge|iam:sqs:PurgeQueue/u.test(authority));

        expect(purges).toEqual([]);
    });

    /**
     * ⛔ U12's VERIFICATION, stated in the plan as "the guard fails if the check role is granted any queue
     * mutation".
     *
     * The register above already fails on ANY new authority, which is a strong but GENERIC net: it says
     * "something changed", not "the backstop can now delete messages". This says the second thing, so the
     * failure names the rule rather than leaving the next reader to work out whether the new line is
     * harmless. A backstop that could receive would take a message from the consumer it is watching; one that
     * could delete or purge could destroy the evidence it exists to report — and it would still pass every
     * other test in this file, because taking a message is what a legitimate consumer does.
     */
    it('⛔ grant the queue BACKSTOP no authority beyond reading attributes', () => {
        const backstop = Object.values(REGISTER)
            .flat()
            .filter((authority) => authority.includes('queueCheckRole'));

        // A scan that found nothing would pass this vacuously, which is how a guard quietly stops guarding —
        // the backstop reads eight queues in recipe-workers and two in identity-webhooks.
        expect(backstop.length).toBe(10);

        const mutations = backstop.filter((authority) => !/\.grant\(\w+, 'sqs:GetQueueAttributes'\)$/u.test(authority));

        expect(mutations, 'the backstop may only READ queue attributes').toEqual([]);
    });

    it('⛔ fires at a backstop handed a mutation, rather than only at the register', () => {
        // Fired at a fake rather than at the tree, so the rule above is proved to detect a violation even
        // while the real register contains none. Every spelling a reviewer might wave through is here: the
        // bundled consume grant, the raw action, and a purge.
        const fakes = [
            'parseQueue.grantConsumeMessages(queueCheckRole)',
            "parseQueue.grant(queueCheckRole, 'sqs:DeleteMessage')",
            'parseQueue.grantPurge(queueCheckRole)',
        ];

        for (const fake of fakes) {
            expect(readsAttributesOnly(fake), fake).toBe(false);
        }

        // And the shape it DOES admit, so a predicate that answered `false` to everything — which would pass
        // every assertion above — is caught here.
        expect(readsAttributesOnly("parseQueue.grant(queueCheckRole, 'sqs:GetQueueAttributes')")).toBe(true);
    });

    it('⛔ keep the erasure-bearing queue consumable by exactly one role', () => {
        // The deletion queue carries GDPR Art. 17 erasure alongside closure and reactivation. Two consumers
        // would mean two interpretations of the same message.
        const consumers = (REGISTER['packages/services/identity-webhooks/infra/lib/WebhooksStack.ts'] ?? []).filter(
            (authority) => authority.startsWith('deletionQueue.grantConsumeMessages'),
        );

        expect(consumers).toEqual(['deletionQueue.grantConsumeMessages(deletionWorkerRole)']);
    });
});
