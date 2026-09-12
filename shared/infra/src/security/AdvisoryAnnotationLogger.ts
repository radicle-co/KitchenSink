import { AnnotationLogger, NagMessageLevel, type NagLoggerNonComplianceData } from 'cdk-nag';

/**
 * **Decorator** over cdk-nag's `AnnotationLogger`: reports every finding, but never at a level that
 * fails the build.
 *
 * cdk-nag reports through the CDK Annotations system, and its `AnnotationLogger` calls
 * `Annotations.addError` for every ERROR-level rule — which is most of `AwsSolutionsChecks`. The CDK CLI
 * exits 1 when any error-level annotation is present, so attaching the stock pack to an app with an
 * existing backlog does not "report" anything: it blocks `cdk synth`, and therefore `cdk deploy`, on live
 * infrastructure. Measured directly: a bare `AwsSolutionsChecks` over a single default S3 bucket makes
 * `cdk synth` exit 1.
 *
 * This decorator downgrades ERROR to WARN and passes everything else through untouched — WARN stays WARN
 * and INFO stays INFO, so the level distinction cdk-nag draws is preserved rather than flattened. Only
 * `onNonCompliance` needs overriding: the base class already reports validation failures (`onError`) and
 * suppressed findings (`onSuppressed`) at warning/info level.
 *
 * This is the ADVISORY half of the U9 posture. Findings become a visible, growing warning stream to burn
 * down; promoting them to a blocking gate is a separate, deliberate decision, made by choosing a
 * different logger here rather than by editing seven app entrypoints.
 */
export class AdvisoryAnnotationLogger extends AnnotationLogger {
    /**
     * Records a non-suppressed finding, downgrading ERROR to WARN so no finding can fail synthesis.
     *
     * @sideEffect adds CDK annotation metadata to the offending construct.
     */
    public override onNonCompliance(data: NagLoggerNonComplianceData): void {
        super.onNonCompliance(
            data.ruleLevel === NagMessageLevel.ERROR ? { ...data, ruleLevel: NagMessageLevel.WARN } : data,
        );
    }
}
