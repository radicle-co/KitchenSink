/**
 * No read-only action may sit under the tier-tag condition of the execution role.
 *
 * CloudFormation's resource handlers READ before they create: an existence or attribute check on a resource that does
 * not exist yet has no tag to match, so a read gated on `aws:ResourceTag/kitchensink:tier` is denied at
 * create time ("SNS:GetTopicAttributes ... because no identity-based policy allows", first sandbox probe). The
 * mutating and deleting actions keep the tag; reads are scoped by NAME only (a read changes nothing, and a name that
 * is not ours is refused by the same name patterns and tier Denies).
 *
 * "Read-only" is the Service Authorization Reference's access level (Read or List), carried in the catalogue, not a
 * guess from the verb: `lambda:Invoke*` is not read-only, `sns:ListTagsForResource` is.
 */
import { describe, expect, it } from 'vitest';

import { buildExecutionPolicy, TAG_GATED_READS } from '../src/executionPolicy.js';
import { iamLike } from '../src/iamPattern.js';
import { isReadOnlyPattern, readOnlyActionsMatching } from '../src/iamCatalogue.js';
import { QUALIFIERS, TIER_TAG_KEY } from '../src/qualifiers.js';
import { iamCatalogue } from './iamCatalogueFixture.js';

const TAG_KEY = `aws:ResourceTag/${TIER_TAG_KEY}`;

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

describe('isReadOnlyPattern: a pattern is a read only when EVERY action it matches is one', () => {
    it.each([
        ['sns:GetTopicAttributes', true],
        ['sns:Get*', true],
        ['sns:ListTagsForResource', true],
        ['apigateway:GET', true],
        ['sns:Publish', false],
        ['sns:Set*', false],
        ['lambda:Invoke*', false],
        ['sns:*', false],
        ['sns:*Topic', false],
        ['nosuchservice:Get*', false],
        ['sns:NoSuchAction', false],
    ] as const)('%s -> %s', (pattern, expected) => {
        expect(isReadOnlyPattern(iamCatalogue, pattern)).toBe(expected);
    });
});

describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod, QUALIFIERS.account])('executionPolicy(%s)', (qualifier) => {
    it('grants no read-only action under the tier-tag condition', () => {
        const leaks = buildExecutionPolicy(qualifier).flatMap((part) =>
            part.document.Statement.filter(
                (statement) =>
                    statement.Effect === 'Allow' && JSON.stringify(statement.Condition ?? {}).includes(TAG_KEY),
            ).flatMap((statement) =>
                statement.Action.filter((action) => !TAG_GATED_READS.includes(action)).flatMap((action) =>
                    readOnlyActionsMatching(iamCatalogue, action).map(
                        (read) => `${statement.Sid}: ${action} -> ${read}`,
                    ),
                ),
            ),
        );

        expect(leaks).toEqual([]);
    });
});

/**
 * The one exception: a secret's VALUE. CloudFormation reads it only to resolve a dynamic reference to a secret that
 * already exists (an RDS instance's `{{resolve:secretsmanager:...}}`), so there is no create-time read to protect,
 * and an ungated `GetSecretValue` on `secret:*` would hand the other application's secret values to this role. The
 * generated secret names (`DatabaseCredentialsSecret...`) carry no `kitchensink` prefix, so it cannot be scoped by
 * name either: the tier tag is the only scope it has (first sandbox deploy, `kitchensink-data-sandbox`: "not
 * authorized to perform: secretsmanager:GetSecretValue on ... DatabaseCredentialsSecret").
 */
describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])('executionPolicy(%s) — secret values', (qualifier) => {
    const valueGrants = buildExecutionPolicy(qualifier)
        .flatMap((part) => part.document.Statement)
        .filter(
            (statement) =>
                statement.Effect === 'Allow' &&
                statement.Action.some((action) => iamLike(action, 'secretsmanager:GetSecretValue')),
        );

    it('grants GetSecretValue (a vacuous pass would leave a dynamic reference unresolvable)', () => {
        expect(valueGrants.length).toBeGreaterThan(0);
    });

    it("grants it only under the qualifier's own tier tag", () => {
        for (const statement of valueGrants) {
            expect(JSON.stringify(statement.Condition ?? {}), statement.Sid).toContain(TAG_KEY);
        }
    });

    it('names exactly the reads that stay tag-gated, and every one is a real read', () => {
        expect(TAG_GATED_READS).toEqual(['secretsmanager:GetSecretValue']);
        expect(TAG_GATED_READS.every((action) => isReadOnlyPattern(iamCatalogue, action))).toBe(true);
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
