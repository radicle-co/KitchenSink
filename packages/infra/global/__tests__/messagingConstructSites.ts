/**
 * @module __tests__/messagingConstructSites — where this repository CONSTRUCTS an SQS queue or an SNS topic,
 * read from the source, enumerating nothing.
 *
 * Two guards read this, and they ask different questions of the same fact:
 *
 * - `queueBaselineDeclarations.test.ts` asks whether each queue's construction site DECLARES the baseline
 *   properties (`enforceSSL`, `encryption`, `retentionPeriod`) — a property of the source text.
 * - `tests/nagRulesAtZero.integration.test.ts` uses the SITE COUNT as its non-vacuity floor: cdk-nag must
 *   have evaluated at least as many distinct queues/topics as the repository declares, which is what makes
 *   "no app was silently skipped" an assertion rather than a hope.
 *
 * The census lives here once for the reason ADR-0025 §3 records: a second copy of "which resources exist"
 * is the artefact where one guard drifts from the other while both stay green.
 *
 * Matching is on the LAST segment of the callee reference (`sqs.Queue`, `aws_sqs.Queue`, a bare `Queue`), so
 * `sqs.CfnQueue` and `Queue.fromQueueArn` are correctly not sites this reader governs — the first is the L1
 * escape hatch, the second is an import of something another stack owns. Same for `sns.CfnTopic`,
 * `sns.TopicPolicy` and `Topic.fromTopicArn`.
 *
 * DESIGN PATTERN: Repository — one read-only reading of the messaging topology, shared by the specifications
 * that judge it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { isTestFile, objectProperties, parse, presentFiles, referenceText, repoRoot, visit } from './serviceSources.js';

/** One `new …Queue(scope, id, { … })` / `new …Topic(scope, id, { … })` site, as these guards see it. */
export interface MessagingSite {
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
 * Every construction of `constructName` in one source file.
 *
 * @param file - Repo-relative path, used only in failure messages.
 * @param contents - The file's text.
 * @param constructName - The CDK class, unqualified: `Queue` or `Topic`.
 * @returns One entry per construction site, in source order. Pure.
 */
export function constructionSites(file: string, contents: string, constructName: string): readonly MessagingSite[] {
    const sites: MessagingSite[] = [];

    visit(parse({ file, contents }), (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = referenceText(node.expression);

        if (callee === undefined || callee.split('.').at(-1) !== constructName) {
            return;
        }

        const [, idArgument, propsArgument] = node.arguments ?? [];
        const id =
            idArgument !== undefined && ts.isStringLiteral(idArgument)
                ? idArgument.text
                : `${file} (unnamed ${constructName.toLowerCase()})`;
        // An ABSENT props argument is an empty declaration, never a pass: `new sqs.Queue(this, 'X')` declares
        // none of the baseline, which is exactly what these guards exist to catch.
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

/**
 * Every SQS queue construction in one source file.
 *
 * @param file - Repo-relative path, used only in failure messages.
 * @param contents - The file's text.
 * @returns One entry per construction site, in source order. Pure.
 */
export const queueSites = (file: string, contents: string): readonly MessagingSite[] =>
    constructionSites(file, contents, 'Queue');

/**
 * Every SNS topic construction in one source file.
 *
 * @param file - Repo-relative path, used only in failure messages.
 * @param contents - The file's text.
 * @returns One entry per construction site, in source order. Pure.
 */
export const topicSites = (file: string, contents: string): readonly MessagingSite[] =>
    constructionSites(file, contents, 'Topic');

/**
 * Every construction site of `constructName` in the repository's non-test TypeScript sources.
 *
 * @param constructName - The CDK class, unqualified: `Queue` or `Topic`.
 * @returns One entry per site, across every package. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
export function repositorySites(constructName: string): readonly MessagingSite[] {
    return presentFiles(['packages/**/*.ts'])
        .filter((file) => !isTestFile(file))
        .flatMap((file) => constructionSites(file, readFileSync(path.join(repoRoot, file), 'utf8'), constructName));
}
