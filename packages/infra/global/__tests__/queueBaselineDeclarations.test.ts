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
 * ## Why this is a SOURCE guard rather than a template one
 *
 * `transportSecurity.test.ts` proves the MECHANISM end to end — that `enforceSSL` emits a real
 * `AWS::SQS::QueuePolicy` carrying an `aws:SecureTransport: false` Deny, and that cdk-nag's own rule agrees —
 * but it synthesizes ONE app: the prod platform. It cannot simply be widened, and the reason is measured
 * rather than aesthetic: `infrastructureManifest.test.ts` records that "every service app calls
 * `ec2.Vpc.fromLookup` … so synth needs AWS credentials and an uncached context; `RecipeWorkersStack`
 * additionally throws unless the service has been BUILT; and each entrypoint requires between one and nine
 * environment variables." A completeness claim therefore cannot be discharged at template level, and a
 * mechanism claim cannot be discharged at source level.
 *
 * ⛔ So the two suites make DIFFERENT claims and are verified DIFFERENTLY, and must not be merged — the
 * two-map shape ADR-0027 §6 argues for. `transportSecurity.test.ts` answers *"does this property produce the
 * control?"*; this file answers *"is any construction site missing the property?"*, across every CDK app.
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
 * nothing, so a queue declared tomorrow joins the subject set the day it is written.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isTestFile, objectProperties, parse, presentFiles, referenceText, repoRoot, visit } from './serviceSources.js';

/**
 * The properties every SQS queue in this repository must declare at its construction site.
 *
 * A CLOSED set rather than a growing one: each entry costs every future queue a line, so each has to earn
 * its place from a failure that actually happened here (see the header).
 */
const BASELINE_PROPERTIES = ['enforceSSL', 'encryption', 'retentionPeriod'] as const;

/** One `new …Queue(scope, id, { … })` site, as this guard sees it. */
interface QueueSite {
    /** Repo-relative path of the file that constructs it. */
    readonly file: string;
    /** The construct id literal, when it is a plain string — for a readable failure. */
    readonly id: string;
    /** Property names declared in the props object literal. */
    readonly declared: ReadonlySet<string>;
    /** Whether `enforceSSL` is the `true` keyword (not merely present). */
    readonly enforcesSsl: boolean;
}

/**
 * Every SQS queue construction in one source file.
 *
 * Matched on the LAST segment of the callee reference (`sqs.Queue`, `aws_sqs.Queue`, a bare `Queue`), so
 * `sqs.CfnQueue` and `Queue.fromQueueArn` are correctly not queues this rule governs — the first is the
 * escape hatch a template-level guard would have to judge instead, the second is an import.
 *
 * @param file - Repo-relative path, used only in failure messages.
 * @param contents - The file's text.
 * @returns One entry per construction site, in source order. Pure.
 */
export function queueSites(file: string, contents: string): readonly QueueSite[] {
    const sites: QueueSite[] = [];

    visit(parse({ file, contents }), (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = referenceText(node.expression);

        if (callee === undefined || callee.split('.').at(-1) !== 'Queue') {
            return;
        }

        const [, idArgument, propsArgument] = node.arguments ?? [];
        const id =
            idArgument !== undefined && ts.isStringLiteral(idArgument) ? idArgument.text : `${file} (unnamed queue)`;
        // An ABSENT props argument is an empty declaration, never a pass: `new sqs.Queue(this, 'X')` declares
        // none of the baseline, which is exactly what this guard exists to catch.
        const literal =
            propsArgument !== undefined && ts.isObjectLiteralExpression(propsArgument) ? propsArgument : undefined;
        // ⛔ PRESENCE is read from the RAW property list, not from `objectProperties` — which skips shorthand
        // by design (`serviceSources.ts`: "a gate that needs a literal VALUE cannot resolve either"). Here the
        // question is only whether the property was DECLARED, and `{ retentionPeriod }` declares it. Reading
        // presence through `objectProperties` would report a legitimate shorthand as an omission — the same
        // false negative `natEgressConsumers.test.ts` records having to handle.
        const declared = new Set(
            (literal?.properties ?? []).flatMap((property) => {
                if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
                    return [];
                }

                return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? [property.name.text] : [];
            }),
        );

        sites.push({
            file,
            id,
            declared,
            // `true` the KEYWORD, not merely present: `enforceSSL: false` and `enforceSSL: someFlag` both
            // declare the property while denying nothing, and a presence check would pass both. ⚠️ A SHORTHAND
            // `{ enforceSSL }` is therefore refused too, deliberately: this is the one baseline property whose
            // VALUE is the control, and a value the reader cannot resolve is not a value it may assume.
            enforcesSsl:
                literal !== undefined &&
                objectProperties(literal).get('enforceSSL')?.kind === ts.SyntaxKind.TrueKeyword,
        });
    });

    return sites;
}

/** Every queue construction site in the repository's non-test TypeScript sources. */
function repositoryQueueSites(): readonly QueueSite[] {
    return presentFiles(['packages/**/*.ts'])
        .filter((file) => !isTestFile(file))
        .flatMap((file) => queueSites(file, readFileSync(path.join(repoRoot, file), 'utf8')));
}

const sites = repositoryQueueSites();

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
