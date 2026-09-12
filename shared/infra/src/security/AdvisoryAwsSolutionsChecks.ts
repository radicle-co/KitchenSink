import { AnnotationLogger, AwsSolutionsChecks, type NagPackProps } from 'cdk-nag';

import { AdvisoryAnnotationLogger } from './AdvisoryAnnotationLogger.js';

/**
 * The full `AwsSolutions` rule pack, in **advisory** mode.
 *
 * Composes two patterns:
 * - **Aspect / Visitor** — inherited from `NagPack`, which visits every `CfnResource` in the construct
 *   tree and evaluates the AwsSolutions rules against it. No rule is added, removed or reordered here:
 *   this IS `AwsSolutionsChecks`, so the review breadth is whatever cdk-nag ships.
 * - **Decorator (logger substitution)** — the pack's built-in `AnnotationLogger` is replaced with
 *   {@link AdvisoryAnnotationLogger}, which downgrades ERROR findings to warnings. That single swap is
 *   what makes findings reportable without failing `cdk synth`/`cdk deploy`.
 *
 * The substitution is a FILTER-then-prepend rather than a map, so the post-condition is unconditional:
 * exactly one annotation logger survives, and it is the advisory one. A future cdk-nag that registered a
 * second `AnnotationLogger` therefore still cannot smuggle an error-raising logger back in.
 *
 * Reporting (`reports`, default on) is left alone: cdk-nag writes one `AwsSolutions-{stack}-NagReport.csv`
 * per stack into the app's output directory, which is the burn-down inventory for free.
 */
export class AdvisoryAwsSolutionsChecks extends AwsSolutionsChecks {
    public constructor(props?: NagPackProps) {
        super(props);

        this.loggers = [
            new AdvisoryAnnotationLogger({ verbose: props?.verbose, logIgnores: props?.logIgnores }),
            ...this.loggers.filter((logger) => !(logger instanceof AnnotationLogger)),
        ];
    }
}
