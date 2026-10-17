/**
 * No read-only action may sit under the stack-name tag condition of the execution role.
 *
 * CloudFormation's resource handlers READ before they create: an existence or attribute check on a resource that does
 * not exist yet has no tag to match, so a read gated on `aws:ResourceTag/aws:cloudformation:stack-name` is denied at
 * create time ("SNS:GetTopicAttributes ... because no identity-based policy allows", first sandbox probe). The
 * mutating and deleting actions keep the tag; reads are scoped by NAME only (a read changes nothing, and a name that
 * is not ours is refused by the same name patterns and tier Denies).
 *
 * "Read-only" is the Service Authorization Reference's access level (Read or List), carried in the catalogue, not a
 * guess from the verb: `lambda:Invoke*` is not read-only, `sns:ListTagsForResource` is.
 */
import { describe, expect, it } from 'vitest';

import { buildExecutionPolicy } from '../src/executionPolicy.js';
import { iamLike } from '../src/iamPattern.js';
import { readOnlyActionsMatching } from '../src/iamCatalogue.js';
import { QUALIFIERS } from '../src/qualifiers.js';
import { iamCatalogue } from './iamCatalogueFixture.js';

const TAG_KEY = 'aws:ResourceTag/aws:cloudformation:stack-name';

describe('readOnlyActionsMatching', () => {
    it.each([
        ['sns:GetTopicAttributes', ['sns:GetTopicAttributes']],
        ['sns:Get*', true],
        ['sns:Publish', []],
        ['sns:Set*', []],
        ['lambda:Invoke*', []],
        ['lambda:List*', true],
        ['sns:ListTagsForResource', ['sns:ListTagsForResource']],
    ] as const)('%s', (pattern, expected) => {
        const found = readOnlyActionsMatching(iamCatalogue, pattern);

        if (expected === true) {
            expect(found.length).toBeGreaterThan(0);
        } else {
            expect(found).toEqual(expected);
        }
    });
});

describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod, QUALIFIERS.account])('executionPolicy(%s)', (qualifier) => {
    it('grants no read-only action under the stack-name tag condition', () => {
        const leaks = buildExecutionPolicy(qualifier).flatMap((part) =>
            part.document.Statement.filter(
                (statement) =>
                    statement.Effect === 'Allow' && JSON.stringify(statement.Condition ?? {}).includes(TAG_KEY),
            ).flatMap((statement) =>
                statement.Action.flatMap((action) =>
                    readOnlyActionsMatching(iamCatalogue, action).map(
                        (read) => `${statement.Sid}: ${action} -> ${read}`,
                    ),
                ),
            ),
        );

        expect(leaks).toEqual([]);
    });
});

describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])(
    'executionPolicy(%s) — the ungated read statements',
    (qualifier) => {
        it('match only read-only actions: a read verb that is really a write stays under the tag', () => {
            const readStatements = buildExecutionPolicy(qualifier).flatMap((part) =>
                part.document.Statement.filter((statement) => statement.Sid.endsWith('Reads')),
            );
            const writes = readStatements.flatMap((statement) =>
                statement.Action.flatMap((action) => {
                    const [service = '', name = ''] = action.split(':');
                    const entry = iamCatalogue.services[service.toLowerCase()];
                    const matched = (entry?.actions ?? []).filter((candidate) =>
                        iamLike(name.toLowerCase(), candidate.toLowerCase()),
                    );
                    const readOnly = new Set(entry?.readOnly ?? []);

                    return matched
                        .filter((candidate) => !readOnly.has(candidate))
                        .map((candidate) => `${statement.Sid}: ${service}:${candidate}`);
                }),
            );

            expect(readStatements.length).toBeGreaterThan(0);
            expect(readStatements.every((statement) => statement.Condition === undefined)).toBe(true);
            expect(writes).toEqual([]);
        });
    },
);
