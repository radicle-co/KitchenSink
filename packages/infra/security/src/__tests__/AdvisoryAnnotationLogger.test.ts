/**
 * `AdvisoryAnnotationLogger` — the Decorator that makes cdk-nag ADVISORY (U9).
 *
 * | Invariant                                                          | Test                                          |
 * | ------------------------------------------------------------------ | --------------------------------------------- |
 * | An ERROR-level finding is recorded as a WARNING, never as an error  | 'records an ERROR-level finding as a warning' |
 * | A WARN-level finding keeps its level                                | 'leaves a WARN-level finding as a warning'    |
 * | An INFO-level finding keeps its level (not upgraded)                | 'leaves an INFO-level finding as info'        |
 * | The finding TEXT survives the downgrade (nothing is swallowed)      | 'preserves the rule id and message'           |
 * | The decorator is doing real work (negative control)                 | 'the undecorated logger records an error'     |
 *
 * WHY this exists: cdk-nag's own `AnnotationLogger` calls `Annotations.addError` for every ERROR-level
 * rule, and the CDK CLI exits 1 when any error annotation is present — verified: a bare
 * `AwsSolutionsChecks` over a single default S3 Bucket makes `cdk synth` exit 1. Attaching the pack
 * unmodified would therefore turn a security backlog into a hard deploy gate on live infrastructure,
 * which is the opposite of "advisory first". The last test is the mutation guard: it fails if the
 * override is deleted, so the suite cannot pass against a logger that still raises errors.
 */
import { App, CfnResource, Stack } from 'aws-cdk-lib';
import { ArtifactMetadataEntryType } from 'aws-cdk-lib/cloud-assembly-schema';
import { AnnotationLogger, NagMessageLevel, type NagLoggerNonComplianceData } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import { AdvisoryAnnotationLogger } from '../AdvisoryAnnotationLogger.js';

/** A `CfnResource` to hang annotations off, plus a reader for the metadata they land in. */
const makeResource = (): CfnResource => {
    const stack = new Stack(new App(), 'AnnotationTarget');

    return new CfnResource(stack, 'Resource', { type: 'AWS::S3::Bucket' });
};

const makeFinding = (
    resource: CfnResource,
    ruleLevel: NagMessageLevel,
    overrides: Partial<NagLoggerNonComplianceData> = {},
): NagLoggerNonComplianceData => ({
    nagPackName: 'AwsSolutions',
    resource,
    ruleId: 'AwsSolutions-S1',
    ruleOriginalName: 'S3BucketLoggingEnabled',
    ruleInfo: 'The S3 Bucket has server access logs disabled.',
    ruleExplanation: 'Access logs help identify would-be attackers.',
    ruleLevel,
    findingId: '',
    ...overrides,
});

const levelsRecordedOn = (resource: CfnResource): string[] =>
    resource.node.metadata
        .filter((entry) =>
            (
                [
                    ArtifactMetadataEntryType.ERROR,
                    ArtifactMetadataEntryType.WARN,
                    ArtifactMetadataEntryType.INFO,
                ] as string[]
            ).includes(entry.type),
        )
        .map((entry) => entry.type);

describe('AdvisoryAnnotationLogger', () => {
    it('records an ERROR-level finding as a warning', () => {
        const resource = makeResource();

        new AdvisoryAnnotationLogger().onNonCompliance(makeFinding(resource, NagMessageLevel.ERROR));

        expect(levelsRecordedOn(resource)).toEqual([ArtifactMetadataEntryType.WARN]);
        expect(levelsRecordedOn(resource)).not.toContain(ArtifactMetadataEntryType.ERROR);
    });

    it('leaves a WARN-level finding as a warning', () => {
        const resource = makeResource();

        new AdvisoryAnnotationLogger().onNonCompliance(makeFinding(resource, NagMessageLevel.WARN));

        expect(levelsRecordedOn(resource)).toEqual([ArtifactMetadataEntryType.WARN]);
    });

    it('leaves an INFO-level finding as info', () => {
        // The decorator DOWNGRADES; it must not flatten every level to WARN, or an informational
        // finding would be promoted into the warning stream and add noise to every deploy log.
        const resource = makeResource();

        new AdvisoryAnnotationLogger().onNonCompliance(makeFinding(resource, NagMessageLevel.INFO));

        expect(levelsRecordedOn(resource)).toEqual([ArtifactMetadataEntryType.INFO]);
    });

    it('preserves the rule id and message so the finding is still actionable', () => {
        const resource = makeResource();

        new AdvisoryAnnotationLogger().onNonCompliance(makeFinding(resource, NagMessageLevel.ERROR));

        const warning = resource.node.metadata.find((entry) => entry.type === ArtifactMetadataEntryType.WARN);

        expect(String(warning?.data)).toContain('AwsSolutions-S1');
        expect(String(warning?.data)).toContain('The S3 Bucket has server access logs disabled.');
    });

    it('the undecorated cdk-nag logger records an ERROR — the decorator is what changes that', () => {
        // Negative control / mutation guard. If `onNonCompliance` stops downgrading, the first test
        // above starts seeing what this one sees, and fails.
        const resource = makeResource();

        new AnnotationLogger().onNonCompliance(makeFinding(resource, NagMessageLevel.ERROR));

        expect(levelsRecordedOn(resource)).toEqual([ArtifactMetadataEntryType.ERROR]);
    });
});
