import { Aspects, type App } from 'aws-cdk-lib';

import { AdvisoryAwsSolutionsChecks } from './AdvisoryAwsSolutionsChecks.js';

/**
 * Attaches the repository's IaC security review to a CDK app. Call this ONCE, from the app entrypoint,
 * immediately after the `App` is constructed.
 *
 * This is the single authoritative representation of "how this repo security-lints its infrastructure":
 * which pack, at which severity posture, attached where. Every `bin/app.ts` calls this rather than
 * constructing a pack itself, so the posture is changed in one place — and
 * `packages/infra/global/__tests__/cdkNagAttachment.test.ts` discovers every CDK app in the workspace
 * and fails if one does not call it, so a new app cannot ship unreviewed.
 *
 * **Advisory, by design.** Findings are reported as CDK warnings; the build is NOT failed. There is a
 * live-stack backlog to burn down, and blocking deploys on it would be an outage risk, not a security
 * win. See `AdvisoryAnnotationLogger` for the mechanism.
 *
 * **It does not change synthesized output.** cdk-nag's rules are read-only predicates and its findings are
 * construct *annotations*, which land in the cloud-assembly manifest, not in the CloudFormation template.
 * That is load-bearing rather than incidental: ADR-0002 keeps prod on `10.0.0.0/16` specifically so the
 * prod template does not move (a replaced VPC replaces the prod RDS — `DESTROY`, no snapshot), and
 * ADR-0008 makes the same no-prod-diff promise. `cdkNagTemplateParity.test.ts` asserts byte-identical
 * templates with and without this call, and proves the comparison can detect a mutating Aspect.
 *
 * ⚠️ A cdk-nag **suppression** is NOT annotation-only — `NagSuppressions` writes
 * `Metadata.cdk_nag.rules_to_suppress` into the CloudFormation resource, so it IS a template change.
 * Suppressions are therefore deliberately absent here; each one must be landed as its own reviewed diff,
 * with its justification. cdk-nag itself rejects a `reason` shorter than 10 characters at synth time, so
 * a suppression can never be added without a stated one.
 *
 * @param app The CDK app to review. Attaching at the root covers every stack the app defines.
 * @sideEffect registers an Aspect on `app`.
 */
export const attachSecurityChecks = (app: App): void => {
    Aspects.of(app).add(new AdvisoryAwsSolutionsChecks());
};
