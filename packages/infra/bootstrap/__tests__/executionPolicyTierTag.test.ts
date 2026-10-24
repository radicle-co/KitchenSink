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
import { ACCOUNT, REGION, type PolicyDocument, type Statement } from '../src/policyDocument.js';
import { QUALIFIERS, STACK_TAG_PATTERNS, TIER_TAG_KEY, tierTagValue, type QualifierName } from '../src/qualifiers.js';
import { allows as evaluates } from './boundaryEval.js';
import { iamCatalogue } from './iamCatalogueFixture.js';

const RESOURCE_TAG = `aws:ResourceTag/${TIER_TAG_KEY}`;
const REQUEST_TAG = `aws:RequestTag/${TIER_TAG_KEY}`;
const STACK_NAME_TAG = 'aws:cloudformation:stack-name';
const STACK_NAME_RESOURCE_TAG = `aws:ResourceTag/${STACK_NAME_TAG}`;
/** The one statement that may read the system tag: EC2 tag edits, see the describe block below. */
const EC2_STACK_TAG_SID = 'Ec2TagByStack';
/** The PassRole grant for EC2 instance profiles, scoped by name: see its describe block. */
const EC2_PASS_ROLE_SID = 'IamPassRoleToEc2';

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

    /**
     * The one statement that may use `StringEqualsIfExists`: CloudFormation sets a new rule's targets before it tags the
     * rule, so the tag is absent at that moment. Every other tier-tag condition is a plain `StringEquals`.
     */
    const IF_EXISTS_ALLOWED: ReadonlySet<string> = new Set(['EventsRuleTargets']);

    it("tests only the qualifier's own tier value, with StringEquals", () => {
        const wrong = tagged.filter((statement) => {
            const values = [...conditionValues(statement, RESOURCE_TAG), ...conditionValues(statement, REQUEST_TAG)];
            const operators = Object.entries(statement.Condition ?? {})
                .filter(([, keys]) => RESOURCE_TAG in keys || REQUEST_TAG in keys)
                .map(([operator]) => operator);

            return (
                values.some((value) => value !== tierTagValue(qualifier)) ||
                operators.some(
                    (o) =>
                        o !== 'StringEquals' && !(o === 'StringEqualsIfExists' && IF_EXISTS_ALLOWED.has(statement.Sid)),
                )
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

    // REWRITTEN (2026-10-24): every PassRole grant EXCEPT the EC2 one is tag-gated. EC2's instance-profile PassRole
    // carries no role tags at all, so its grant is scoped by name instead (the describe block below).
    it("tests the qualifier's tier with iam:ResourceTag and never aws:ResourceTag", () => {
        for (const statement of passRole.filter((entry) => entry.Sid !== EC2_PASS_ROLE_SID)) {
            const condition = JSON.stringify(statement.Condition ?? {});

            expect(condition, statement.Sid).toContain(
                `"iam:ResourceTag/${TIER_TAG_KEY}":"${tierTagValue(qualifier)}"`,
            );
            expect(condition, statement.Sid).not.toContain('aws:ResourceTag');
        }
    });
});

/**
 * EC2 evaluates the PassRole of an instance profile's role with NO role tags in its context: a dry-run
 * `ec2:RunInstances` with the production NAT instance profile, from a principal holding the deployed
 * `kitchensink-ci-exec-ksprod-iam` policy, was refused `iam:PassRole` while the role carried `kitchensink:tier=prod`,
 * and the decoded authorization context held only `iam:RoleName` (2026-10-24). The same probe was allowed by a grant
 * scoped by role NAME to the tier and passed to EC2 only. The production deploy failed on exactly this, replacing the
 * NAT instance (`kitchensink-network-prod`).
 */
describe.each(stageQualifiers)('executionPolicy(%s) — an EC2 instance profile role is passed by name', (qualifier) => {
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const merged: PolicyDocument = { Version: '2012-10-17', Statement: statements(qualifier) };
    const roleArn = (name: string): string => `arn:aws:iam::${ACCOUNT}:role/${name}`;
    const own = nonprod
        ? ['kitchensink-network-sandbox-VpcpublicSubnet1NatInstanc-AbC123', 'kitchensink-food-service-pr-91-TaskRole-x']
        : ['kitchensink-network-prod-VpcpublicSubnet1NatInstanc-vPi0Kdk31iyx'];
    const other = nonprod
        ? ['kitchensink-network-prod-VpcpublicSubnet1NatInstanc-vPi0Kdk31iyx']
        : [
              'kitchensink-network-sandbox-VpcpublicSubnet1NatInstanc-AbC123',
              'kitchensink-food-service-pr-91-TaskRole-x',
          ];
    const toEc2 = { 'iam:PassedToService': 'ec2.amazonaws.com' };

    it('grants it in ONE statement, to ec2.amazonaws.com only, with no tag condition', () => {
        const grants = allows(qualifier).filter(
            (statement) =>
                statement.Action.includes('iam:PassRole') &&
                conditionValues(statement, 'iam:PassedToService').includes('ec2.amazonaws.com'),
        );

        expect(grants.map((statement) => statement.Sid)).toEqual([EC2_PASS_ROLE_SID]);
        expect(conditionValues(grants[0] as Statement, 'iam:PassedToService')).toEqual(['ec2.amazonaws.com']);
        expect(JSON.stringify(grants[0]?.Condition ?? {})).not.toContain('ResourceTag');
    });

    it("passes the tier's own role to EC2 with no tag in the request", () => {
        for (const name of own) {
            expect(evaluates(merged, 'iam:PassRole', roleArn(name), toEc2), name).toBe(true);
        }
    });

    it("never passes another tier's role, nor a role that is not KitchenSink's", () => {
        for (const name of [...other, 'armoury-prod-NatRole', 'some-other-role']) {
            expect(evaluates(merged, 'iam:PassRole', roleArn(name), toEc2), name).toBe(false);
        }
    });

    it('keeps the tag gate for every other service: the name alone passes nothing to Lambda', () => {
        for (const name of own) {
            expect(
                evaluates(merged, 'iam:PassRole', roleArn(name), { 'iam:PassedToService': 'lambda.amazonaws.com' }),
                name,
            ).toBe(false);
        }
    });
});

/**
 * CloudFormation tags a CloudWatch Logs delivery resource when it creates it, and `logs:*Delivery*` (on `*`) does not
 * include `logs:TagResource`. The first production edge deploy through ksprod failed creating its access-log
 * destination: "not authorized to perform: logs:TagResource on resource: ...:delivery-destination:
 * kitchensink-edge-access-logs-prod" (2026-10-24). The sandbox never creates one, so only production showed it.
 */
describe.each(stageQualifiers)('executionPolicy(%s) — CloudWatch Logs delivery tags', (qualifier) => {
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const stage = nonprod ? 'sandbox' : 'prod';
    const merged: PolicyDocument = { Version: '2012-10-17', Statement: statements(qualifier) };
    const logsArn = (resource: string): string => `arn:aws:logs:${REGION}:${ACCOUNT}:${resource}`;
    const resources = [
        logsArn(`delivery-destination:kitchensink-edge-access-logs-${stage}`),
        logsArn(`delivery-source:kitchensink-edge-identity-${stage}`),
        logsArn('delivery:AbCdEf0123456789'),
    ];
    const own = tierTagValue(qualifier);
    const other = tierTagValue(nonprod ? QUALIFIERS.prod : QUALIFIERS.nonprod);

    it('lets a new delivery resource receive its own tier tag (the create path)', () => {
        for (const resource of resources) {
            expect(
                evaluates(merged, 'logs:TagResource', resource, { [REQUEST_TAG]: own, 'aws:TagKeys': TIER_TAG_KEY }),
                resource,
            ).toBe(true);
        }
    });

    it('lets a delivery resource of its own tier change its tags', () => {
        for (const resource of resources) {
            expect(evaluates(merged, 'logs:TagResource', resource, { [RESOURCE_TAG]: own }), resource).toBe(true);
            expect(evaluates(merged, 'logs:UntagResource', resource, { [RESOURCE_TAG]: own }), resource).toBe(true);
        }
    });

    it("never tags another tier's delivery resource, nor stamps the other tier's tag", () => {
        for (const resource of resources) {
            expect(evaluates(merged, 'logs:TagResource', resource, { [RESOURCE_TAG]: other }), resource).toBe(false);
            expect(evaluates(merged, 'logs:TagResource', resource, { [REQUEST_TAG]: other }), resource).toBe(false);
        }
    });

    it("never tags a delivery destination or source that is not KitchenSink's", () => {
        for (const resource of [logsArn('delivery-destination:armoury-logs'), logsArn('delivery-source:other-app')]) {
            expect(evaluates(merged, 'logs:TagResource', resource, { [REQUEST_TAG]: own }), resource).toBe(false);
        }
    });
});

/**
 * An event-source mapping is addressed by an id, so only the tier tag scopes it. A mapping created before the tier tag
 * existed must still RECEIVE it: the sandbox identity-webhooks deploy was refused `lambda:TagResource` on
 * `event-source-mapping:9b324d52-...` (2026-10-17), and production holds mappings of the same age.
 */
describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])('executionPolicy(%s) — event-source mapping tags', (qualifier) => {
    const own = tierTagValue(qualifier);
    const other = tierTagValue(qualifier === QUALIFIERS.nonprod ? QUALIFIERS.prod : QUALIFIERS.nonprod);
    const rendered = (): PolicyDocument =>
        JSON.parse(
            JSON.stringify({
                Version: '2012-10-17',
                Statement: buildExecutionPolicy(qualifier).flatMap((part) => part.document.Statement),
            })
                .replaceAll('<region>', 'us-east-1')
                .replaceAll('<account>', '040663841500'),
        ) as PolicyDocument;
    const mapping = 'arn:aws:lambda:us-east-1:040663841500:event-source-mapping:9b324d52-c1e3-46e0-b518-eebd40b61274';

    it('lets an untagged mapping receive its own tier tag', () => {
        expect(evaluates(rendered(), 'lambda:TagResource', mapping, { [REQUEST_TAG]: own })).toBe(true);
    });

    it('lets a mapping of its own tier change its tags', () => {
        expect(evaluates(rendered(), 'lambda:TagResource', mapping, { [RESOURCE_TAG]: own })).toBe(true);
        expect(evaluates(rendered(), 'lambda:UntagResource', mapping, { [RESOURCE_TAG]: own })).toBe(true);
    });

    it("never touches a mapping of the other tier, nor stamps the other tier's tag", () => {
        expect(evaluates(rendered(), 'lambda:TagResource', mapping, { [RESOURCE_TAG]: other })).toBe(false);
        expect(evaluates(rendered(), 'lambda:UntagResource', mapping, { [RESOURCE_TAG]: other })).toBe(false);
        expect(evaluates(rendered(), 'lambda:TagResource', mapping, { [REQUEST_TAG]: other })).toBe(false);
    });
});

/**
 * Two creates the first per-PR deploy refused (Sandbox Up, 2026-10-17), judged against the rendered policy.
 *
 * - CloudFormation calls `events:PutRule` with NO tags and tags the rule in a second call (CloudTrail, every PutRule
 *   since 2026-10-10), so a request-tag condition can never pass for a new rule: the name is its scope.
 * - A preview's public hosts are `<service>-pr-N.commise.app` and `<service>-sandbox.commise.app`, beside the
 *   `*.sandbox.commise.app` names, so the non-production record grant must admit them and production must not.
 */
describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])('executionPolicy(%s) — per-PR creates', (qualifier) => {
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const rendered = (): PolicyDocument =>
        JSON.parse(
            JSON.stringify({
                Version: '2012-10-17',
                Statement: buildExecutionPolicy(qualifier).flatMap((part) => part.document.Statement),
            })
                .replaceAll('<region>', 'us-east-1')
                .replaceAll('<account>', '040663841500'),
        ) as PolicyDocument;
    const rule = (name: string) => `arn:aws:events:us-east-1:040663841500:rule/${name}`;
    const records = (name: string) => ({ 'route53:ChangeResourceRecordSetsNormalizedRecordNames': name });
    const zone = 'arn:aws:route53:::hostedzone/Z0474040RGDAGYCWHZ7M';

    it.each(
        nonprod
            ? ['kitchensink-recipe-analytics-retention-pr-91', 'kitchensink-recipe-erasure-orphan-sweep-sandbox']
            : ['kitchensink-recipe-analytics-retention-prod'],
    )('creates its own rule %s with an untagged PutRule', (name) => {
        expect(evaluates(rendered(), 'events:PutRule', rule(name))).toBe(true);
    });

    it.each(
        nonprod ? ['kitchensink-recipe-analytics-retention-prod'] : ['kitchensink-recipe-analytics-retention-pr-91'],
    )("never creates the other tier's rule %s", (name) => {
        expect(evaluates(rendered(), 'events:PutRule', rule(name))).toBe(false);
    });

    it.each(
        nonprod ? ['remote-search-pr-91.commise.app', 'remote-search-sandbox.commise.app'] : ['search.commise.app'],
    )('writes its own service record %s', (name) => {
        expect(evaluates(rendered(), 'route53:ChangeResourceRecordSets', zone, records(name))).toBe(true);
    });

    it.each(
        nonprod
            ? ['remote-search.commise.app', 'commise.app', 'identity.commise.app']
            : ['remote-search-pr-91.commise.app', 'remote-search-sandbox.commise.app', 'pr-91.sandbox.commise.app'],
    )("never writes the other tier's record %s", (name) => {
        expect(evaluates(rendered(), 'route53:ChangeResourceRecordSets', zone, records(name))).toBe(false);
    });
});

/**
 * The second round of per-PR creates (Sandbox Up rerun, 2026-10-17). Each acts on a resource BEFORE CloudFormation has
 * tagged it, so a tier-tag condition cannot hold and the resource's own name is its scope:
 * a new mapping (no grant existed), a new rule's targets and its delete (set before the rule is tagged, deleted by a rollback that lands before it), a
 * dashboard's tags, and the tags of a table's stream (refused, so CloudFormation made the table with NO tags at all).
 */
describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])('executionPolicy(%s) — acts before the tag', (qualifier) => {
    const nonprod = qualifier === QUALIFIERS.nonprod;
    const stage = nonprod ? 'pr-91' : 'prod';
    const otherStage = nonprod ? 'prod' : 'pr-91';
    const rendered = (): PolicyDocument =>
        JSON.parse(
            JSON.stringify({
                Version: '2012-10-17',
                Statement: buildExecutionPolicy(qualifier).flatMap((part) => part.document.Statement),
            })
                .replaceAll('<region>', 'us-east-1')
                .replaceAll('<account>', '040663841500'),
        ) as PolicyDocument;
    const a = (service: string, resource: string) => `arn:aws:${service}:us-east-1:040663841500:${resource}`;

    it('creates a mapping for a kitchensink function, never for another function', () => {
        const mapping = a('lambda', 'event-source-mapping:*');

        expect(
            evaluates(rendered(), 'lambda:CreateEventSourceMapping', mapping, {
                'lambda:FunctionArn': a('lambda', `function:kitchensink-recipe-workers-${stage}-ParseLine`),
            }),
        ).toBe(true);
        expect(
            evaluates(rendered(), 'lambda:CreateEventSourceMapping', mapping, {
                'lambda:FunctionArn': a('lambda', 'function:armoury-api-prod'),
            }),
        ).toBe(false);
    });

    // Measured 2026-10-18 on kitchensink-recipe-workers-pr-91: CloudFormation's first DeleteEventSourceMapping removed
    // each mapping, and its confirming call then met a mapping that no longer existed. AWS authorizes that call on "*"
    // with no lambda:FunctionArn, so a strict ArnLike refused it, the handler read AccessDenied as a failure, and the
    // stack sat in DELETE_FAILED with all five mappings already gone.
    it.each(['lambda:DeleteEventSourceMapping', 'lambda:GetEventSourceMapping'])(
        '%s on a mapping that no longer exists (resource "*", no function key) is allowed',
        (action) => {
            expect(evaluates(rendered(), action, '*', {})).toBe(true);
        },
    );

    it.each(['lambda:DeleteEventSourceMapping', 'lambda:GetEventSourceMapping'])(
        "%s on an existing mapping: a kitchensink function's, never another application's",
        (action) => {
            const mapping = a('lambda', 'event-source-mapping:22ae0dc5-542f-400a-bb92-ffd208fe4ead');

            expect(
                evaluates(rendered(), action, mapping, {
                    'lambda:FunctionArn': a('lambda', `function:kitchensink-recipe-workers-${stage}-ParseLine`),
                }),
            ).toBe(true);
            expect(
                evaluates(rendered(), action, mapping, {
                    'lambda:FunctionArn': a('lambda', 'function:armoury-api-prod'),
                }),
            ).toBe(false);
        },
    );

    it('does not widen UpdateEventSourceMapping to a mapping with no function key', () => {
        expect(evaluates(rendered(), 'lambda:UpdateEventSourceMapping', '*', {})).toBe(false);
        expect(
            evaluates(rendered(), 'lambda:UpdateEventSourceMapping', a('lambda', 'event-source-mapping:x'), {}),
        ).toBe(false);
    });

    it.each(['events:PutTargets', 'events:RemoveTargets', 'events:DeleteRule'])(
        '%s on its own untagged rule, never on the other tier rule',
        (action) => {
            expect(evaluates(rendered(), action, a('events', `rule/kitchensink-recipe-band-drain-${stage}`))).toBe(
                true,
            );
            expect(evaluates(rendered(), action, a('events', `rule/kitchensink-recipe-band-drain-${otherStage}`))).toBe(
                false,
            );
        },
    );

    it("tags its own dashboard, never the other tier's", () => {
        const own = nonprod ? 'dashboard/pr-91-food-data' : 'dashboard/food-data';
        const other = nonprod ? 'dashboard/food-data' : 'dashboard/pr-91-food-data';

        expect(evaluates(rendered(), 'cloudwatch:TagResource', `arn:aws:cloudwatch::040663841500:${own}`)).toBe(true);
        expect(evaluates(rendered(), 'cloudwatch:TagResource', `arn:aws:cloudwatch::040663841500:${other}`)).toBe(
            false,
        );
    });

    it("tags its own table's stream, never the other tier's", () => {
        const stream = (name: string) => a('dynamodb', `table/${name}/stream/2026-10-17T19:26:40.298`);

        expect(evaluates(rendered(), 'dynamodb:TagResource', stream(`kitchensink-messages-${stage}`))).toBe(true);
        expect(evaluates(rendered(), 'dynamodb:TagResource', stream(`kitchensink-messages-${otherStage}`))).toBe(false);
    });
});

describe.each([QUALIFIERS.nonprod, QUALIFIERS.prod])('executionPolicy(%s) — rules of the other tier', (qualifier) => {
    const other = tierTagValue(qualifier === QUALIFIERS.nonprod ? QUALIFIERS.prod : QUALIFIERS.nonprod);
    const rendered = (): PolicyDocument =>
        JSON.parse(
            JSON.stringify({
                Version: '2012-10-17',
                Statement: buildExecutionPolicy(qualifier).flatMap((part) => part.document.Statement),
            })
                .replaceAll('<region>', 'us-east-1')
                .replaceAll('<account>', '040663841500'),
        ) as PolicyDocument;
    // A truncated generated name carries no stage: only the other tier's TAG can refuse it.
    const truncated =
        'arn:aws:events:us-east-1:040663841500:rule/kitchensink-identity-webh-ReconciliationScheduleAC1-ZT61';

    it.each(['events:DeleteRule', 'events:PutTargets', 'events:RemoveTargets', 'events:DisableRule'])(
        '%s is refused on a truncated rule tagged for the other tier',
        (action) => {
            expect(evaluates(rendered(), action, truncated, { [RESOURCE_TAG]: other })).toBe(false);
        },
    );
});

/**
 * CloudFormation reads the OIDC provider's tags whenever the account stack's tags change (every commit moves
 * `CommitSha`): the account deploy of 2026-10-17 was refused `iam:ListOpenIDConnectProviderTags` and stuck in a
 * rollback on the same call.
 */
describe('executionPolicy(ksaccount) — the GitHub OIDC provider', () => {
    const rendered = (): PolicyDocument =>
        JSON.parse(
            JSON.stringify({
                Version: '2012-10-17',
                Statement: buildExecutionPolicy(QUALIFIERS.account).flatMap((part) => part.document.Statement),
            })
                .replaceAll('<region>', 'us-east-1')
                .replaceAll('<account>', '040663841500'),
        ) as PolicyDocument;

    it('reads the provider tags, and only on the GitHub provider', () => {
        const provider = 'arn:aws:iam::040663841500:oidc-provider/token.actions.githubusercontent.com';
        const other = 'arn:aws:iam::040663841500:oidc-provider/accounts.google.com';

        expect(evaluates(rendered(), 'iam:ListOpenIDConnectProviderTags', provider)).toBe(true);
        expect(evaluates(rendered(), 'iam:ListOpenIDConnectProviderTags', other)).toBe(false);
    });
});
