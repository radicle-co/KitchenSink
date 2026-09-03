// @vitest-environment node
/**
 * ⛔ EVERY SQS QUEUE IN THIS REPOSITORY DECLARES ITS BASELINE PROPERTIES — subject set DISCOVERED, never listed.
 *
 * | Invariant                                                                  | Test                                                     |
 * | -------------------------------------------------------------------------- | -------------------------------------------------------- |
 * | The reader actually finds the queues the repository defines                  | 'finds every queue construction in the repository'        |
 * | Every construction site denies non-TLS access (`enforceSSL: true`)           | 'declares enforceSSL: true at every construction site'    |
 * | Every construction site declares encryption at rest                          | 'declares encryption at every construction site'          |
 * | Every construction site declares its own message retention                   | 'declares retentionPeriod at every construction site'     |
 * | The reader can DETECT an omission (negative control, per property)           | 'reports a construction site that omits a baseline …'     |
 *
 * ## What actually went wrong: a recorded ADR outcome regressed, because nothing asserted it
 *
 * ⛔ This is not a new rule. ADR-0013's burn-down #1 table records `SQS4 / SNS3 no TLS-only policy | 13 | 0 |
 * FIXED — enforceSSL / an explicit deny statement`, measured **across the seven prod apps**. That zero had no
 * mechanism behind it — it was a one-time count — and it has since gone back to TWO: `RecipeParseQueue` and
 * `RecipeParseDlq` shipped with no `enforceSSL` while their eight siblings in the same file had it. cdk-nag
 * still saw it and still reported `AwsSolutions-SQS4` against exactly those two, into the ADVISORY channel
 * that app runs (`recipe-workers/infra/bin/app.ts`: "reported as warnings, never fails the build"), where
 * nothing gates on it. A recorded result that nothing re-checks is a claim, not a control.
 *
 * ⛔ Nor was suppressing it ever an option: ADR-0013 requires every `NagSuppressions` entry to be "its own
 * reviewed change with its own diff", through the `AcceptedNagFindings` register. Fixing is the only route.
 *
 * ## ⚠️ What this file is NOT, since 2026-09-03: it is no longer the SQS4 control
 *
 * When this guard was written it stood in for `AwsSolutions-SQS4` itself, and its own header conceded that
 * it was "a PROXY for this table's row, not the row itself". That gap is now closed by
 * `tests/nagRulesAtZero.integration.test.ts`, which synthesizes EVERY CDK app hermetically and asserts that
 * the real `AwsSolutions-SQS4` / `-SNS3` rules report zero non-compliance — so the proxy argument
 * ("declaration implies the policy, because CDK emits it") no longer has to be believed.
 *
 * This file keeps the half that guard cannot make: `encryption` and `retentionPeriod` raise NO cdk-nag
 * finding at all (see the two sections below — SSE-SQS is a default, and there is no retention rule), so
 * they are invisible to a rule-driven control and visible only here. `enforceSSL` stays in the baseline
 * because the three properties are one baseline, argued together, and because a source guard names the LINE
 * to edit where a rule names a synthesized resource path.
 *
 * ⛔ Three suites now make three DIFFERENT claims about the same resources, and they must not be merged.
 * `transportSecurity.test.ts` answers *"does `enforceSSL` produce a real deny, in the emitted template?"*;
 * `nagRulesAtZero.integration.test.ts` answers *"does the RULE report zero, in every app?"*; this file
 * answers *"is any construction site missing a baseline property?"*. Merging any two would trade a claim for
 * a shorter file.
 *
 * ## ⚠️ Scope: it asserts DECLARATION, never VALUE (except `enforceSSL`)
 *
 * Do not "strengthen" this into `retentionPeriod === 14 days`. The queues legitimately disagree — 14 days on
 * three DLQs, 3 on the verification DLQ, 4 on every source queue — and each disagreement is argued where it
 * is declared. `enforceSSL` is the one exception, because there the VALUE is the control: `enforceSSL: false`
 * declares the property and denies nothing.
 *
 * ## Why RETENTION is a baseline property and not merely a preference
 *
 * `RecipeParseQueue` declared no `retentionPeriod`, so its window came from AWS's four-day default — while
 * the same four days is stated in PROSE twice (the redrive comment on `RecipeParseQueue`, and the
 * `PINNED_CONSUMER_REDELIVERY_FLOOR` docstring in `RecipeWorkersStack.test.ts`, both "inside the queue's
 * 4-day retention") as the bound that makes `maxReceiveCount: 20` safe. Stated twice, declared zero times:
 * a DRY defect where the authoritative copy is AWS's default. A console `SetQueueAttributes` lowering it
 * persists across every subsequent deploy — CloudFormation does not restore a property it never declared —
 * and the sizing argument becomes quietly false with nothing reporting it.
 *
 * The same reasoning covers `encryption`. SSE-SQS is on by default for a NEW queue (AWS: "When you create a
 * new queue, it will be encrypted by SSE-SQS by default"), so declaring it closes no live gap — and cdk-nag's
 * `SQSQueueSSE` fails only on an explicit `false`, so an absent property raises no finding either. What the
 * declaration buys is CloudFormation OWNERSHIP: the SQS docs are explicit that a queue's encryption can be
 * disabled later ("Any encrypted message remains encrypted even if the encryption of its queue is disabled"),
 * and a declared property is corrected on the next deploy where an undeclared one is not. This guard is the
 * only thing that notices the omission at all.
 *
 * DESIGN PATTERN: Specification — one predicate over a discovered subject set, applied uniformly. The
 * discovery is deliberately the same shape as `natEgressConsumers.test.ts`'s: read the source, enumerate
 * nothing, so a queue declared tomorrow joins the subject set the day it is written. It moved to
 * `messagingConstructSites.ts` when the rule-level guard needed the same census as its non-vacuity floor.
 */
import { describe, expect, it } from 'vitest';

import { queueSites, repositorySites } from './messagingConstructSites.js';

/**
 * The properties every SQS queue in this repository must declare at its construction site.
 *
 * A CLOSED set rather than a growing one: each entry costs every future queue a line, so each has to earn
 * its place from a failure that actually happened here (see the header).
 */
const BASELINE_PROPERTIES = ['enforceSSL', 'encryption', 'retentionPeriod'] as const;

const sites = repositorySites('Queue');

describe('SQS queue baseline declarations', () => {
    it('finds every queue construction in the repository', () => {
        // Non-vacuity, BOTH ways. A reader that found nothing would make every assertion below trivially
        // true; one that found sites in a single file would mean the traversal is not reaching the whole
        // tree, which is the failure that let the parse pair ship unguarded in the first place.
        //
        // 12 is the current census: `RecipeWorkersStack`'s ten and `DataStack`'s two. A floor rather than an
        // equality, so declaring a new queue does not fail this test — declaring one that omits a baseline
        // property fails the three below, which is where the failure belongs.
        expect(sites.length).toBeGreaterThanOrEqual(12);
        expect(new Set(sites.map((site) => site.file)).size).toBeGreaterThanOrEqual(2);
    });

    it('declares enforceSSL: true at every construction site', () => {
        expect(sites.filter((site) => !site.enforcesSsl).map((site) => `${site.file}:${site.id}`)).toEqual([]);
    });

    it('declares encryption at every construction site', () => {
        expect(
            sites.filter((site) => !site.declared.has('encryption')).map((site) => `${site.file}:${site.id}`),
        ).toEqual([]);
    });

    it('declares retentionPeriod at every construction site', () => {
        expect(
            sites.filter((site) => !site.declared.has('retentionPeriod')).map((site) => `${site.file}:${site.id}`),
        ).toEqual([]);
    });

    it('reports a construction site that omits a baseline property, one property at a time', () => {
        // The negative control the three assertions above are worthless without: it proves the READER can
        // see an omission, rather than that the repository happens to contain none. Driven per property, so
        // a reader that silently stopped looking at one of them fails here instead of reporting green.
        const complete = `new sqs.Queue(this, 'Complete', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
        });`;

        expect(queueSites('fake.ts', complete)).toHaveLength(1);
        expect(queueSites('fake.ts', complete)[0]?.enforcesSsl).toBe(true);

        for (const omitted of BASELINE_PROPERTIES) {
            const withoutIt = complete
                .split('\n')
                .filter((line) => !line.trimStart().startsWith(`${omitted}:`))
                .join('\n');
            const [site] = queueSites('fake.ts', withoutIt);

            expect(site?.declared.has(omitted), `omitting ${omitted} must be visible to the reader`).toBe(false);
        }

        // ⛔ SHORTHAND IS A DECLARATION. This reader first read presence through `objectProperties`, which
        // skips shorthand by design — so `{ retentionPeriod }` would have been reported as an OMISSION and
        // this guard would have failed a queue that complies. Presence now comes from the raw property list.
        const [shorthand] = queueSites(
            'fake.ts',
            `new sqs.Queue(this, 'Shorthand', { enforceSSL: true, encryption, retentionPeriod });`,
        );

        expect(shorthand?.declared.has('encryption')).toBe(true);
        expect(shorthand?.declared.has('retentionPeriod')).toBe(true);

        // …but a shorthand `enforceSSL` is still refused, because its VALUE is the control and the reader
        // cannot resolve it. Unresolvable is not a pass for the one property that IS the deny.
        expect(
            queueSites(
                'fake.ts',
                `new sqs.Queue(this, 'ShorthandSsl', { enforceSSL, encryption, retentionPeriod });`,
            )[0]?.enforcesSsl,
        ).toBe(false);

        // `enforceSSL: false` DECLARES the property and denies nothing — the case a presence check passes.
        expect(queueSites('fake.ts', complete.replace('enforceSSL: true', 'enforceSSL: false'))[0]?.enforcesSsl).toBe(
            false,
        );

        // A neighbouring constructor is not a queue: `CfnQueue` is the L1 escape hatch and `fromQueueArn` is
        // an import. Matching them would make this guard fail on code it has no rule for.
        expect(queueSites('fake.ts', `new sqs.CfnQueue(this, 'Raw', {});`)).toEqual([]);
    });
});
