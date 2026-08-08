/**
 * The cdk-nag suppression REGISTER — `AcceptedNagFindings` + `acceptNagFindings` (issue #143).
 *
 * | Invariant                                                                        | Test                                                              |
 * | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
 * | The register is closed: its entry set is pinned, so a new suppression must be reviewed | 'pins the exact set of accepted findings'                    |
 * | Every entry names a real `AwsSolutions-…` rule                                    | 'every entry targets a well-formed AwsSolutions rule id'          |
 * | Every entry carries a SUBSTANTIVE justification, not a placeholder                | 'every entry states a substantive reason'                         |
 * | No entry suppresses the same rule twice (a silent duplicate hides a second reason) | 'no entry suppresses the same rule id twice'                     |
 * | `acceptNagFindings` actually silences the finding it names                         | 'silences exactly the finding it is given'                        |
 * | …and the proof is not vacuous — the finding fires without it                      | 'the fixture reports the finding when nothing is accepted'        |
 * | It does NOT silence findings it was not given                                     | 'leaves every other finding reporting'                            |
 * | A suppression IS a template change, and this is where that is pinned              | 'writes cdk_nag suppression metadata into the template'           |
 * | `applyToChildren` reaches a generated child policy (the IAM5 shape)               | 'reaches a child CfnResource when applyToChildren is set'         |
 *
 * ## Why a register at all, rather than inline `NagSuppressions` calls
 *
 * ADR-0013 records the trap: a suppression is **not** annotation-only — it writes
 * `Metadata.cdk_nag.rules_to_suppress` into the CloudFormation resource, so it is a real template diff on
 * infrastructure whose template stability ADR-0002 and ADR-0008 stake data safety on. Scattering free-text
 * `reason` strings across seven CDK apps would put that decision — "this finding is acceptable, and here is
 * why" — in ~20 places, where the same justification (ECS2 appears on five task definitions across three
 * apps; SQS4 on eight queues across two) would be re-typed and drift.
 *
 * The justification is ONE piece of knowledge, so it has ONE authoritative representation here. Application
 * stays at the construct (`acceptNagFindings(bucket, …)`) rather than by string path, so renaming a construct
 * is a compile error instead of a suppression that silently stops matching.
 */
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { SecurityGroup, Peer, Port, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { describe, expect, it } from 'vitest';

import { AcceptedNagFindings, acceptNagFindings, type AcceptedNagFinding } from '../accepted-nag-findings.js';
import { AdvisoryAwsSolutionsChecks } from '../advisory-aws-solutions-checks.js';
import { collectNagAnnotations, ruleIdsIn } from './__fixtures__/nag-annotations.js';

const env = { account: '123456789012', region: 'us-east-1' };

const entries = Object.entries(AcceptedNagFindings) as ReadonlyArray<readonly [string, readonly AcceptedNagFinding[]]>;

/**
 * Synthesizes a security group with a `0.0.0.0/0` ingress rule — one clear, stable AwsSolutions-EC23
 * finding — optionally accepting a set of findings on it first.
 *
 * EC23 is used as the probe because it fires on a single named construct with no generated children, so a
 * disappearing finding can only mean the suppression matched.
 */
const synthesizeOpenSecurityGroup = (accept?: readonly AcceptedNagFinding[]) => {
    const app = new App();

    Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

    const stack = new Stack(app, 'Probe', { env });
    const vpc = new Vpc(stack, 'Vpc', { maxAzs: 2, natGateways: 0 });
    const securityGroup = new SecurityGroup(stack, 'OpenSg', { vpc, allowAllOutbound: true });

    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(443), 'Public HTTPS ingress');

    if (accept) {
        acceptNagFindings(securityGroup, accept);
    }

    const assembly = app.synth();
    const template = JSON.stringify(assembly.getStackByName('Probe').template, null, 2);

    return { template, annotations: collectNagAnnotations(app) };
};

describe('the AcceptedNagFindings register is closed and justified', () => {
    it('pins the exact set of accepted findings', () => {
        // Deliberate friction. Every suppression writes template metadata onto live infrastructure, so
        // adding one must not be possible without a reviewer seeing this list move.
        expect(Object.keys(AcceptedNagFindings).sort()).toEqual([
            'ALB_ACCESS_LOG_BUCKET_IS_THE_LOG_TARGET',
            'CLERK_WEBHOOK_VERIFIES_ITS_OWN_SIGNATURE',
            'CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE',
            'ERASURE_WORKER_OBJECT_PREFIX_WILDCARD',
            'MIGRATION_PLAN_SECRET_HOLDS_NO_CREDENTIAL',
            'PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY',
            'REST_API_EDGE_CONTROLS_NOT_PROPORTIONATE',
            'TASK_ENVIRONMENT_HOLDS_NO_SECRET',
        ]);
    });

    it('every entry targets a well-formed AwsSolutions rule id', () => {
        for (const [key, findings] of entries) {
            expect(findings.length, `${key} accepts nothing`).toBeGreaterThan(0);

            for (const finding of findings) {
                expect(finding.id, `${key} → ${finding.id}`).toMatch(/^AwsSolutions-[A-Z]+[0-9]+$/u);
            }
        }
    });

    it('every entry states a substantive reason', () => {
        // cdk-nag's own floor is 10 characters, which "not needed" clears. A suppression is a security
        // decision recorded on production infrastructure; it has to say WHY, and cite where the decision
        // is recorded (an ADR, a verified property) so a reviewer can check it rather than trust it.
        for (const [key, findings] of entries) {
            for (const finding of findings) {
                expect(
                    finding.reason.length,
                    `${key} → ${finding.id} reason is too short to be a reason`,
                ).toBeGreaterThan(80);
                expect(finding.reason, `${key} → ${finding.id} reason is a placeholder`).not.toMatch(
                    /^(n\/?a|not needed|by design|wontfix|todo)/iu,
                );
            }
        }
    });

    it('every reason survives into the template as READABLE text', () => {
        // A non-obvious cdk-nag trap, found empirically. `NagSuppressionHelper.toCfnFormat` does:
        //     if ([...reason].some((c) => c.codePointAt(0)! > 255)) { is_reason_encoded = true;
        //                                                             reason = base64(reason) }
        // So ONE em-dash, curly quote or arrow anywhere in a reason replaces the entire justification with
        // an opaque base64 blob in the CloudFormation template — and therefore in every `cdk diff` a
        // reviewer reads. The whole value of a suppression is that the next engineer can read WHY and
        // disagree; an unreadable reason is a silenced finding with no argument attached. Repo prose style
        // uses em-dashes freely (this comment does), so this is easy to reintroduce and invisible without a
        // test. Reasons stay in the Latin-1 range; use `--` and `->`.
        for (const [key, findings] of entries) {
            for (const finding of findings) {
                const offending = [...finding.reason].filter((character) => (character.codePointAt(0) ?? 0) > 255);

                expect(
                    offending,
                    `${key} → ${finding.id}: these characters would base64-encode the whole reason in the template`,
                ).toEqual([]);
            }
        }
    });

    it('no entry suppresses the same rule id twice', () => {
        for (const [key, findings] of entries) {
            const ids = findings.map((finding) => finding.id);

            expect(new Set(ids).size, `${key} lists a rule twice, so one of the two reasons is dead`).toBe(ids.length);
        }
    });
});

describe('acceptNagFindings', () => {
    it('the fixture reports the finding when nothing is accepted', () => {
        // Negative control: without this, 'silences exactly the finding it is given' could pass because the
        // Aspect never ran, or because EC23 stopped firing.
        expect(ruleIdsIn(synthesizeOpenSecurityGroup().annotations.warnings)).toContain('AwsSolutions-EC23');
    });

    it('silences exactly the finding it is given', () => {
        const { annotations } = synthesizeOpenSecurityGroup(
            AcceptedNagFindings.PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY,
        );

        expect(ruleIdsIn(annotations.warnings)).not.toContain('AwsSolutions-EC23');
        expect(annotations.errors).toEqual([]);
    });

    it('leaves every other finding reporting', () => {
        // A suppression that swallowed neighbouring rules would turn the register into a mute button. The
        // probe VPC has no flow log, so VPC7 must survive EC23 being accepted.
        const before = ruleIdsIn(synthesizeOpenSecurityGroup().annotations.warnings);
        const after = ruleIdsIn(
            synthesizeOpenSecurityGroup(AcceptedNagFindings.PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY).annotations
                .warnings,
        );

        expect(before).toContain('AwsSolutions-VPC7');
        expect(after).toEqual(before.filter((id) => id !== 'AwsSolutions-EC23'));
    });

    it('writes cdk_nag suppression metadata into the template', () => {
        // THE trap ADR-0013 records, pinned as a fact rather than a comment: a suppression is a real
        // template diff, which is why the prod-template parity suites must expect it explicitly.
        const { template } = synthesizeOpenSecurityGroup(
            AcceptedNagFindings.PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY,
        );

        expect(template).toContain('cdk_nag');
        expect(template).toContain('rules_to_suppress');
        expect(template).toContain('AwsSolutions-EC23');
        // …and the justification travels WITH it in PLAIN TEXT, so the template — and the prod `cdk diff` a
        // human approves — carries the evidence rather than a base64 blob. See 'every reason survives into
        // the template as READABLE text' for the encoding trap this guards.
        expect(template).toContain('ADR-0003');
        expect(template).not.toContain('is_reason_encoded');
    });

    it('does not write suppression metadata when nothing is accepted', () => {
        expect(synthesizeOpenSecurityGroup().template).not.toContain('cdk_nag');
    });

    it('reaches a child CfnResource when applyToChildren is set', () => {
        // The IAM5 shape: the finding lands on `<Role>/DefaultPolicy/Resource`, a generated child, so a
        // suppression on the role alone would not match it.
        const app = new App();

        Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

        const stack = new Stack(app, 'Probe', { env });
        const role = new Role(stack, 'WildcardRole', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });

        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3:DeleteObject'],
                resources: ['arn:aws:s3:::b/*'],
            }),
        );
        acceptNagFindings(role, AcceptedNagFindings.ERASURE_WORKER_OBJECT_PREFIX_WILDCARD, {
            applyToChildren: true,
        });
        app.synth();

        expect(ruleIdsIn(collectNagAnnotations(app).warnings)).not.toContain('AwsSolutions-IAM5');
    });

    it('does NOT reach a child CfnResource by default', () => {
        // Proves `applyToChildren` is load-bearing above rather than incidental.
        const app = new App();

        Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());

        const stack = new Stack(app, 'Probe', { env });
        const role = new Role(stack, 'WildcardRole', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });

        role.addToPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ['s3:DeleteObject'],
                resources: ['arn:aws:s3:::b/*'],
            }),
        );
        acceptNagFindings(role, AcceptedNagFindings.ERASURE_WORKER_OBJECT_PREFIX_WILDCARD);
        app.synth();

        expect(ruleIdsIn(collectNagAnnotations(app).warnings)).toContain('AwsSolutions-IAM5');
    });
});
