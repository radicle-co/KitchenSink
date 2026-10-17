/**
 * The execution role authorizes by the `kitchensink:tier` tag (ADR-0065), not by CloudFormation's own
 * `aws:cloudformation:stack-name`.
 *
 * ## Why the system tag was dropped
 *
 * CloudFormation does not put its `aws:cloudformation:*` tags on ACM certificates, ECS task definitions and services,
 * DynamoDB tables, CloudFront distributions and some older SQS queues. The first `ksnonprod` deploy failed on that:
 * `cdk-ksnonprod-cfn-exec-role ... not authorized to perform: acm:AddTagsToCertificate`. App-level tags DO reach
 * those resources, so every CDK app now tags its tree with `kitchensink:tier` (`tierTagCoverage.test.ts`) and the
 * policy asks for that.
 *
 * ## What an IAM tag condition can silently get wrong, and so what is held here
 *
 * A condition key an action does not honour is ABSENT from the request, so `StringEquals` on it never matches:
 *
 * - on a CREATE, `aws:RequestTag` that the action does not honour denies every create, so a request-tag condition
 *   is allowed only where EVERY action it covers honours `aws:RequestTag` (the Service Authorization Reference,
 *   carried in the catalogue);
 * - on a MODIFY, `aws:ResourceTag` that no matched action honours grants nothing: a dead statement that reads as
 *   scoped. Every explicitly named action must honour it, and a wildcard must match at least one that does;
 * - a TAGGING action cannot require the tag it is adding: it is allowed when the resource already carries the tier
 *   tag OR when the request adds it, in two statements. The second path is also what re-tags a legacy resource.
 */
import { describe, expect, it } from 'vitest';

import { buildExecutionPolicy } from '../src/executionPolicy.js';
import { isTagAddPattern, tagKeySupport } from '../src/iamCatalogue.js';
import type { PolicyDocument, Statement } from '../src/policyDocument.js';
import { QUALIFIERS, STACK_TAG_PATTERNS, TIER_TAG_KEY, tierTagValue, type QualifierName } from '../src/qualifiers.js';
import { iamCatalogue } from './iamCatalogueFixture.js';

const RESOURCE_TAG = `aws:ResourceTag/${TIER_TAG_KEY}`;
const REQUEST_TAG = `aws:RequestTag/${TIER_TAG_KEY}`;
const STACK_NAME_TAG = 'aws:cloudformation:stack-name';
const STACK_NAME_RESOURCE_TAG = `aws:ResourceTag/${STACK_NAME_TAG}`;
/** The one statement that may read the system tag: EC2 tag edits, see the describe block below. */
const EC2_STACK_TAG_SID = 'Ec2TagByStack';

const allQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod, QUALIFIERS.account] as const;
const stageQualifiers = [QUALIFIERS.nonprod, QUALIFIERS.prod] as const;

const documents = (qualifier: QualifierName): readonly PolicyDocument[] =>
    buildExecutionPolicy(qualifier).map((part) => part.document);

const statements = (qualifier: QualifierName): readonly Statement[] =>
    documents(qualifier).flatMap((document) => [...document.Statement]);

const allows = (qualifier: QualifierName): readonly Statement[] =>
    statements(qualifier).filter((statement) => statement.Effect === 'Allow');

/** The values a statement's condition tests a key against (any operator). */
const conditionValues = (statement: Statement, key: string): readonly string[] =>
    Object.values(statement.Condition ?? {}).flatMap((keys) => {
        const value = keys[key];

        return value === undefined ? [] : typeof value === 'string' ? [value] : [...value];
    });

/** The tagging actions that only a `*`-resource statement grants (so they have no request-tag twin by design). */
const tagAddsOnAnyResource = (tagged: readonly Statement[]): Set<string> =>
    new Set(
        tagged
            .filter(
                (statement) => statement.Resource.includes('*') && conditionValues(statement, RESOURCE_TAG).length > 0,
            )
            .flatMap((statement) => statement.Action)
            .filter((action) => isTagAddPattern(iamCatalogue, action)),
    );

describe.each(allQualifiers)('executionPolicy(%s) — dependence on the CloudFormation system tag', (qualifier) => {
    it('mentions aws:cloudformation:stack-name in no statement but the EC2 tag-edit fallback', () => {
        const offenders = statements(qualifier)
            .filter((statement) => JSON.stringify(statement).includes(STACK_NAME_TAG))
            .map((statement) => statement.Sid)
            .filter((sid) => sid !== EC2_STACK_TAG_SID);

        expect(offenders).toEqual([]);
    });
});

// Rollback across the migration boundary (ADR-0065 Decision 5a): a stack whose update failed rolls back to its OLD
// template, which has no tier tag. CloudFormation's EC2 tag reconciliation then DeleteTags the tier tag (allowed) and
// CreateTags the old tags, which the tier-tag statement refuses because the resource no longer carries it. EC2 tag
// actions have no request-tag path (their resource is "*"), so the fallback keys on the tag CloudFormation itself puts
// on every EC2 resource, which a user cannot set (the `aws:` prefix is reserved).
describe.each(stageQualifiers)('executionPolicy(%s) — EC2 tag edits fall back to the stack-name tag', (qualifier) => {
    const fallback = (): Statement | undefined =>
        allows(qualifier).find((statement) => statement.Sid === EC2_STACK_TAG_SID);

    it('allows exactly ec2:CreateTags and ec2:DeleteTags, on "*", under StringLike on the stack-name tag only', () => {
        const statement = fallback();

        expect(statement, 'no stack-name fallback for EC2 tag edits').toBeDefined();
        expect([...(statement as Statement).Action].sort()).toEqual(['ec2:CreateTags', 'ec2:DeleteTags']);
        expect((statement as Statement).Resource).toEqual(['*']);
        expect((statement as Statement).Condition).toEqual({
            StringLike: { [STACK_NAME_RESOURCE_TAG]: [...STACK_TAG_PATTERNS[qualifier]] },
        });
    });

    it("uses the qualifier's own KitchenSink stack patterns, which name no other application", () => {
        const patterns = conditionValues(fallback() as Statement, STACK_NAME_RESOURCE_TAG);

        expect(patterns.length).toBeGreaterThan(0);
        expect(patterns.every((pattern) => pattern.startsWith('kitchensink-'))).toBe(true);
    });

    it('is honoured by the actions it covers (else the grant is dead)', () => {
        for (const action of ['ec2:CreateTags', 'ec2:DeleteTags']) {
            expect(tagKeySupport(iamCatalogue, action, 'resourceTag').unsupported, action).toEqual([]);
            expect(tagKeySupport(iamCatalogue, action, 'resourceTag').supported, action).not.toEqual([]);
        }
    });

    it("keeps the cross-tier Deny, which no Allow outranks, so the fallback cannot touch another tier's resource", () => {
        const others = Object.values(QUALIFIERS)
            .filter((other) => other !== qualifier)
            .map(tierTagValue)
            .sort();
        const deny = statements(qualifier).find(
            (statement) => statement.Effect === 'Deny' && conditionValues(statement, RESOURCE_TAG).length > 0,
        );

        expect(deny?.Action).toEqual(['*']);
        expect([...conditionValues(deny as Statement, RESOURCE_TAG)].sort()).toEqual(others);
    });
});

describe('executionPolicy(ksaccount) — has no EC2 stack-name fallback', () => {
    it('grants none, because the account tier owns no EC2 resources', () => {
        expect(allows(QUALIFIERS.account).some((statement) => statement.Sid === EC2_STACK_TAG_SID)).toBe(false);
    });
});

describe.each(stageQualifiers)('executionPolicy(%s) — tier-tag conditions are well formed', (qualifier) => {
    const tagged = allows(qualifier).filter(
        (statement) =>
            conditionValues(statement, RESOURCE_TAG).length > 0 || conditionValues(statement, REQUEST_TAG).length > 0,
    );

    it('has tier-tag statements (a vacuous pass here would hide a policy that stopped scoping)', () => {
        expect(tagged.length).toBeGreaterThan(20);
    });

    it("tests only the qualifier's own tier value, with StringEquals", () => {
        const wrong = tagged.filter((statement) => {
            const values = [...conditionValues(statement, RESOURCE_TAG), ...conditionValues(statement, REQUEST_TAG)];
            const operators = Object.entries(statement.Condition ?? {})
                .filter(([, keys]) => RESOURCE_TAG in keys || REQUEST_TAG in keys)
                .map(([operator]) => operator);

            return (
                values.some((value) => value !== tierTagValue(qualifier)) || operators.some((o) => o !== 'StringEquals')
            );
        });

        expect(wrong.map((statement) => statement.Sid)).toEqual([]);
    });

    it('asks for aws:RequestTag only where EVERY action it covers honours it (else every create is denied)', () => {
        const problems = tagged
            .filter((statement) => conditionValues(statement, REQUEST_TAG).length > 0)
            .flatMap((statement) =>
                statement.Action.flatMap((action) => {
                    const { supported, unsupported } = tagKeySupport(iamCatalogue, action, 'requestTag');

                    return supported.length === 0 || unsupported.length > 0
                        ? [`${statement.Sid}: ${action} does not honour aws:RequestTag (${unsupported.join(', ')})`]
                        : [];
                }),
            );

        expect(problems).toEqual([]);
    });

    it('asks for aws:ResourceTag only where the actions can be authorized by it (else the grant is dead)', () => {
        const problems = tagged
            .filter((statement) => conditionValues(statement, RESOURCE_TAG).length > 0)
            .flatMap((statement) =>
                statement.Action.flatMap((action) => {
                    const { supported } = tagKeySupport(iamCatalogue, action, 'resourceTag');
                    const wildcard = /[*?]/u.test(action.split(':')[1] ?? '');

                    // A wildcard may match actions that honour no resource tag (they are simply not granted: fail
                    // closed); a NAMED action that does not honour it would be a grant that never applies.
                    return supported.length === 0 && !wildcard
                        ? [`${statement.Sid}: ${action} honours no aws:ResourceTag, so this grant never applies`]
                        : supported.length === 0
                          ? [`${statement.Sid}: ${action} matches no action that honours aws:ResourceTag`]
                          : [];
                }),
            );

        expect(problems).toEqual([]);
    });

    it('lets a tagging action through on EITHER path: a resource already tagged, or a request that adds the tag', () => {
        const tagAdds = (kind: 'resource' | 'request', onAnyResource: boolean): Set<string> =>
            new Set(
                tagged
                    .filter(
                        (statement) =>
                            conditionValues(statement, kind === 'resource' ? RESOURCE_TAG : REQUEST_TAG).length > 0 &&
                            statement.Resource.includes('*') === onAnyResource,
                    )
                    .flatMap((statement) => statement.Action)
                    .filter((action) => isTagAddPattern(iamCatalogue, action))
                    .flatMap((action) => {
                        const { supported, unsupported } = tagKeySupport(iamCatalogue, action, 'requestTag');

                        return [...supported, ...unsupported];
                    }),
            );
        const viaResource = tagAdds('resource', false);
        const viaRequest = tagAdds('request', false);

        expect(viaResource.size).toBeGreaterThan(5);
        expect([...viaResource].filter((action) => !viaRequest.has(action))).toEqual([]);
        expect([...viaRequest].filter((action) => !viaResource.has(action))).toEqual([]);
    });

    // A request-added tag on a "*" resource would let a stack claim ANY resource of the account, so the types that are
    // addressed only by "*" take the tag at creation (the CreateAction statements) or from the one-shot admin re-tag.
    // They are named here so that list can only grow on purpose.
    it('names the tagging actions that have no request path because their resource is "*"', () => {
        expect([...tagAddsOnAnyResource(tagged)].sort()).toEqual(['ec2:CreateTags']);
    });

    it("denies the other tiers' resources, so a request-added tag cannot take one over", () => {
        const others = Object.values(QUALIFIERS)
            .filter((other) => other !== qualifier)
            .map(tierTagValue)
            .sort();
        const deny = statements(qualifier).find(
            (statement) => statement.Effect === 'Deny' && conditionValues(statement, RESOURCE_TAG).length > 0,
        );

        expect(deny, "no Deny on another tier's tag").toBeDefined();
        expect(deny?.Action).toEqual(['*']);
        expect([...conditionValues(deny as Statement, RESOURCE_TAG)].sort()).toEqual(others);
    });

    // `events:PutRule` is an UPSERT: CloudFormation calls it to create a rule and again to update one, and only the
    // create carries the tags. A request-tag condition alone would deny every later update of a rule.
    it('also grants an upsert action on an EXISTING tagged resource, not only on a request that adds the tag', () => {
        const viaResource = tagged.filter(
            (statement) =>
                conditionValues(statement, RESOURCE_TAG).length > 0 && statement.Action.includes('events:PutRule'),
        );

        expect(viaResource.map((statement) => statement.Sid)).not.toEqual([]);
    });

    // REWRITTEN: PassRole is gated by `iam:ResourceTag`, not `aws:ResourceTag` (see the PassRole block below).
    it('lets a created role be passed only when it carries this tier', () => {
        const passRole = allows(qualifier).find((statement) => statement.Action.includes('iam:PassRole'));

        expect(conditionValues(passRole as Statement, `iam:ResourceTag/${TIER_TAG_KEY}`)).toEqual([
            tierTagValue(qualifier),
        ]);
    });
});

/**
 * `iam:PassRole` is authorized by IAM's own `iam:ResourceTag`, never `aws:ResourceTag`. Under `aws:ResourceTag` a real
 * PassRole of a correctly tagged role was refused ("no identity-based policy allows the iam:PassRole action") while
 * the policy simulator allowed it, so no offline check could see it: the first scheduler-stack deploy through
 * ksnonprod failed on it, and a probe stack (a tagged role passed to a state machine) reproduced and then cleared it.
 */
describe.each(stageQualifiers)('executionPolicy(%s) — PassRole is gated by iam:ResourceTag', (qualifier) => {
    const passRole = buildExecutionPolicy(qualifier)
        .flatMap((part) => part.document.Statement)
        .filter((statement) => statement.Effect === 'Allow' && statement.Action.includes('iam:PassRole'));

    it('has a PassRole grant (a vacuous pass would hide a deleted one)', () => {
        expect(passRole.length).toBeGreaterThan(0);
    });

    it("tests the qualifier's tier with iam:ResourceTag and never aws:ResourceTag", () => {
        for (const statement of passRole) {
            const condition = JSON.stringify(statement.Condition ?? {});

            expect(condition, statement.Sid).toContain(
                `"iam:ResourceTag/${TIER_TAG_KEY}":"${tierTagValue(qualifier)}"`,
            );
            expect(condition, statement.Sid).not.toContain('aws:ResourceTag');
        }
    });
});
