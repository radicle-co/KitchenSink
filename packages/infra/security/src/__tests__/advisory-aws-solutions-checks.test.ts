/**
 * `AdvisoryAwsSolutionsChecks` — the `AwsSolutionsChecks` pack, made non-blocking (U9).
 *
 * | Invariant                                                                   | Test                                                    |
 * | --------------------------------------------------------------------------- | ------------------------------------------------------- |
 * | It IS the AwsSolutions pack (full rule set, not a subset)                    | 'reports under the AwsSolutions pack name'              |
 * | It actually evaluates rules (no vacuous pass)                                | 'reports findings against a non-compliant stack'        |
 * | NO finding is ever recorded at error level                                   | 'records zero error-level findings'                     |
 * | The findings still name their rules, so the backlog is actionable            | 'names the violated rule ids in the warnings'           |
 * | The undecorated pack DOES record errors (negative control)                   | 'the stock pack records errors — this one does not'     |
 * | A suppression without a real justification is rejected by the toolchain      | 'rejects a suppression whose reason is under 10 chars'  |
 *
 * The last test is not about this class: it pins the guarantee the whole "every suppression carries a
 * concrete justification" rule rests on. cdk-nag itself requires a `reason` of >= 10 characters and
 * throws during synthesis otherwise, so the rule is enforced by the toolchain rather than by review
 * vigilance. No wrapper is added around `NagSuppressions` because that intent is already satisfied.
 */
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import { AdvisoryAwsSolutionsChecks } from '../advisory-aws-solutions-checks.js';
import { collectNagAnnotations, ruleIdsIn } from './__fixtures__/nag-annotations.js';
import { makeNonCompliantStack } from './__fixtures__/non-compliant-stack.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** Synthesizes the non-compliant fixture under the given pack and returns what the pack recorded. */
const findingsUnder = (pack: AwsSolutionsChecks) => {
    const app = new App();

    Aspects.of(app).add(pack);
    makeNonCompliantStack(app, 'NonCompliant', { env });
    app.synth();

    return collectNagAnnotations(app);
};

describe('AdvisoryAwsSolutionsChecks', () => {
    it('reports under the AwsSolutions pack name', () => {
        expect(new AdvisoryAwsSolutionsChecks({ reports: false }).readPackName).toBe('AwsSolutions');
    });

    it('reports findings against a non-compliant stack', () => {
        const { warnings } = findingsUnder(new AdvisoryAwsSolutionsChecks({ reports: false }));

        expect(warnings.filter((message) => message.startsWith('AwsSolutions-')).length).toBeGreaterThan(0);
    });

    it('records zero error-level findings, so synthesis is never failed by a finding', () => {
        const { errors } = findingsUnder(new AdvisoryAwsSolutionsChecks({ reports: false }));

        expect(errors).toEqual([]);
    });

    it('names the violated rule ids in the warnings', () => {
        const { warnings } = findingsUnder(new AdvisoryAwsSolutionsChecks({ reports: false }));

        // S1 (no server access logs) and IAM5 (wildcard permissions) are unambiguous properties of the
        // fixture, so they pin that real rules ran — not merely that "some" message appeared.
        expect(ruleIdsIn(warnings)).toContain('AwsSolutions-S1');
        expect(ruleIdsIn(warnings)).toContain('AwsSolutions-IAM5');
    });

    it('the stock pack records errors for the same stack — this one does not', () => {
        // Negative control / mutation guard: proves the advisory behaviour comes from THIS class. If the
        // logger swap is removed, 'records zero error-level findings' fails with exactly this output.
        const { errors } = findingsUnder(new AwsSolutionsChecks({ reports: false }));

        expect(errors.length).toBeGreaterThan(0);
        expect(ruleIdsIn(errors)).toContain('AwsSolutions-S1');
    });

    it('rejects a suppression whose reason is under 10 characters', () => {
        const app = new App();

        Aspects.of(app).add(new AdvisoryAwsSolutionsChecks({ reports: false }));

        const stack = makeNonCompliantStack(app, 'NonCompliant', { env });

        // cdk-nag validates eagerly, at the call site — so a thin justification fails the app process
        // (and therefore `cdk synth`/`cdk deploy`) rather than being discovered in review.
        expect(() =>
            NagSuppressions.addResourceSuppressions(stack, [{ id: 'AwsSolutions-S1', reason: 'because' }], true),
        ).toThrow(/'reason' of 10 characters or more/);

        // A properly justified suppression is accepted — the rule is "state a reason", not "never suppress".
        expect(() =>
            NagSuppressions.addResourceSuppressions(
                stack,
                [{ id: 'AwsSolutions-S1', reason: 'access logs are covered by the account-wide CloudTrail trail' }],
                true,
            ),
        ).not.toThrow();
    });
});
