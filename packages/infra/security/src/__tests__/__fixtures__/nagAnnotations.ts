/**
 * Reads cdk-nag's output back out of a synthesized construct tree (U9).
 *
 * cdk-nag reports through the CDK Annotations system, which stores each message as construct metadata
 * typed `aws:cdk:{error,warning,info}`. Reading the tree — rather than the CLI's stdout — is what lets a
 * unit test assert the ADVISORY guarantee directly: no finding may ever land as an `error`, because the
 * CDK CLI exits 1 when one is present.
 */
import type { IConstruct } from 'constructs';
import { ArtifactMetadataEntryType } from 'aws-cdk-lib/cloud-assembly-schema';

export interface NagAnnotations {
    /** Messages recorded at error level — MUST be empty in advisory mode. */
    readonly errors: string[];
    /** Messages recorded at warning level — where advisory findings land. */
    readonly warnings: string[];
    /** Messages recorded at info level. */
    readonly infos: string[];
}

/** Every `AwsSolutions-…` rule id mentioned by the given messages, deduplicated and sorted. */
export const ruleIdsIn = (messages: readonly string[]): string[] =>
    [...new Set(messages.flatMap((message) => [...message.matchAll(/AwsSolutions-[A-Za-z0-9]+/g)].map((m) => m[0])))]
        .sort()
        .map(String);

/**
 * Collects every annotation recorded anywhere under `root`.
 *
 * Call AFTER `app.synth()` — Aspects, and therefore cdk-nag, only run during synthesis.
 */
export const collectNagAnnotations = (root: IConstruct): NagAnnotations => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const infos: string[] = [];

    for (const node of root.node.findAll()) {
        for (const entry of node.node.metadata) {
            const message = String(entry.data);

            if (entry.type === ArtifactMetadataEntryType.ERROR) {
                errors.push(message);
            } else if (entry.type === ArtifactMetadataEntryType.WARN) {
                warnings.push(message);
            } else if (entry.type === ArtifactMetadataEntryType.INFO) {
                infos.push(message);
            }
        }
    }

    return { errors, warnings, infos };
};
