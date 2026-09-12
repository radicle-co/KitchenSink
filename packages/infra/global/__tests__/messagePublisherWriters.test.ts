/**
 * ⛔ THE ASSUMPTION ADR-0013's `DDB3` ACCEPTANCE RESTS ON: exactly ONE module in this repository writes to
 * the message substrate, and it is the one that populates `ttl`.
 *
 * | Invariant                                                              | Test                                                     |
 * | ---------------------------------------------------------------------- | -------------------------------------------------------- |
 * | Exactly one production module imports a DynamoDB client                | 'names exactly one production DynamoDB writer'            |
 * | …and it is the publisher whose `ttl` the integration tier verifies     | (same test — set equality, both directions)              |
 * | The discovery is not vacuous — it finds the writer it is about         | 'finds the publisher through the same reading'            |
 *
 * ## Why this guard exists, and why a comment would not have done
 *
 * `MessageSubstrateStack` declares `timeToLiveAttribute: 'ttl'`, which tells DynamoDB WHICH attribute to
 * expire — it does not oblige anybody to write one. Nothing at the infrastructure layer can. So the claim
 * "these rows expire in three days", which is the second of the three grounds on which
 * `MESSAGE_SUBSTRATE_ROWS_OUTLIVE_NOTHING` accepts `AwsSolutions-DDB3`, is really a claim about the WRITERS:
 * it holds because there is exactly one, and `messageSubstrate.integration.test.ts` verifies that one writes
 * a NUMBER-typed `ttl` three days out against a real table.
 *
 * ⚠️ That premise is one commit from being false, and silently. `OutboundMessage.ts` already admits
 * `recipe-import` as a `groupType` with no code behind it; a second adapter landing without a `ttl` would
 * make the table grow forever — and the failure is invisible, because DynamoDB does not error on a row with
 * no TTL attribute, the write succeeds, and every test that checks "TTL is enabled on the table" keeps
 * passing. An accepted nag finding whose justification has quietly become untrue is worse than an open one.
 *
 * ## Set equality, both directions — the `natEgressConsumers.test.ts` / `llmSpendGuards.test.ts` shape
 *
 * The subject set is DISCOVERED (every tracked production TypeScript file that imports a DynamoDB client)
 * and compared by EQUALITY to the one module named here. A new writer reds it. Deleting or renaming the
 * known writer reds it too, which is what stops the guard from passing vacuously the day its subject moves.
 *
 * ⚠️ Deliberately about the CLIENT IMPORT rather than about `PutCommand`: a writer that reached DynamoDB
 * through some other call shape would still have to import the SDK, and a guard keyed on one command name
 * is a guard that a different command walks past.
 *
 * DESIGN PATTERN: Specification over a discovered subject set, compared by set equality in both directions.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTestFile, moduleSpecifiers, presentFiles, repoRoot } from './serviceSources.js';
import { readFileSync } from 'node:fs';

/**
 * The one module allowed to write to the message substrate.
 *
 * It is named, rather than discovered, because it is the thing being asserted ABOUT — the discovery is the
 * other half of the comparison. `DynamoPublisher` is the adapter behind `@kitchensink/messaging`'s `publish`
 * port; `ttlFor` there is what makes every row expire.
 */
const SOLE_WRITER = 'packages/services/food-service/src/events/DynamoPublisher.ts';

/** Any AWS SDK entrypoint that can reach DynamoDB. Reaching the table at all requires one of these. */
const DYNAMODB_CLIENT = /^@aws-sdk\/(?:client-dynamodb|lib-dynamodb)(?:\/|$)/u;

/**
 * Every tracked production TypeScript module that imports a DynamoDB client.
 *
 * Test files and infrastructure are excluded: a test may legitimately read the table to verify it (the
 * integration tier does exactly that), and a CDK stack imports `aws-cdk-lib`'s construct, never the SDK.
 *
 * @returns Repo-relative paths, sorted. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function dynamoImportingModules(): readonly string[] {
    return presentFiles(['packages'])
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .filter((file) => !isTestFile(file) && !file.includes('/infra/') && !file.includes('/__fixtures__/'))
        .filter((file) =>
            moduleSpecifiers({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }).some((specifier) =>
                DYNAMODB_CLIENT.test(specifier),
            ),
        )
        .toSorted();
}

describe('exactly one module writes to the message substrate', () => {
    it('names exactly one production DynamoDB writer', () => {
        expect(
            dynamoImportingModules(),
            'ADR-0013 accepts AwsSolutions-DDB3 on the message table partly because every row carries a ' +
                '3-day `ttl`. Nothing in the INFRASTRUCTURE enforces that — it holds because one adapter ' +
                'writes, and its `ttl` is verified against a real table. A second writer must either populate ' +
                '`ttl` (and be added here, with that verification) or the acceptance must be reopened.',
        ).toEqual([SOLE_WRITER]);
    });

    it('finds the publisher through the same reading it judges by', () => {
        // Anti-vacuity: an import reader that silently stopped matching would answer `[]`, and `[]` is not
        // the expectation above — but it WOULD be if someone ever "simplified" this to a subset check. This
        // asserts the reader can actually see the module it is about.
        expect(
            moduleSpecifiers({
                file: SOLE_WRITER,
                contents: readFileSync(path.join(repoRoot, SOLE_WRITER), 'utf8'),
            }).some((specifier) => DYNAMODB_CLIENT.test(specifier)),
        ).toBe(true);
    });
});
