/**
 * @module templateParity — the comparator behind the template-parity proof for the qualifier move.
 *
 * Moving a stage app onto KitchenSink's own qualifier must change its synthesized CloudFormation in exactly two
 * ways: (1) the bootstrap qualifier token, wherever it appears (the `BootstrapVersion` parameter and rule, the
 * asset bucket, the lookup and deploy role ARNs), and (2) a `PermissionsBoundary` on every IAM role. Anything else
 * is a finding. The cases that matter most are a changed logical id, a changed property, a dropped `DeletionPolicy`
 * and a missing export, because each of those can replace a resource (ADR-0002: never the prod RDS or a bucket).
 *
 * The comparison is deliberately NOT a list of "ignorable paths". It rewrites the two expected changes out of the
 * head and then demands deep equality, so a difference nobody anticipated has nowhere to hide.
 *
 * @pattern Specification — a pure predicate over two cloud-assembly captures
 */
import { isRecord, type Json } from './json.js';
import { DEFAULT_QUALIFIER, boundaryPolicyName, qualifierForStage, type QualifierName } from './qualifiers.js';

/** One synthesized cloud assembly: `"<app>/<stage>"` to its files (`*.template.json`, `*.assets.json`, `manifest.json`). */
export type Capture = Record<string, Record<string, unknown>>;

/** What a comparison found. `differences` is empty exactly when the head is the base plus the two expected moves. */
export interface ParityReport {
    readonly differences: readonly string[];
    readonly summary: readonly string[];
}

/** The placeholder both sides' qualifier tokens are rewritten to before comparing. */
const QUALIFIER_TOKEN = '<qualifier>';

/** The account app is stage-less and stays on its own wiring, so it is compared with no rewrite at all. */
const ACCOUNT_STAGE = 'account';

/** Caps the differences reported per file, so a wholesale change reads as one finding and not ten thousand. */
const MAX_DIFFERENCES_PER_FILE = 25;

/**
 * The qualifier as a whole token. ⛔ NOT a substring: `IdentityWebhooksprod` is a logical id that CONTAINS `ksprod`,
 * and rewriting inside it would invent a logical-id difference between two identical templates. A qualifier is
 * always set off by a non-alphanumeric character (`cdk-ksprod-assets`, `/cdk-bootstrap/ksprod/version`).
 */
const qualifierToken = (qualifier: string): RegExp => new RegExp(`(?<![A-Za-z0-9])${qualifier}(?![A-Za-z0-9])`, 'gu');

/** Rewrites one qualifier to the shared token in every string, keys included. Pure. */
function rewriteQualifier(value: Json, qualifier: string): Json {
    const token = qualifierToken(qualifier);

    const rewrite = (node: Json): Json => {
        if (typeof node === 'string') {
            return node.replace(token, QUALIFIER_TOKEN);
        }

        if (Array.isArray(node)) {
            return node.map(rewrite);
        }

        if (isRecord(node)) {
            return Object.fromEntries(
                Object.entries(node).map(([key, item]) => [key.replace(token, QUALIFIER_TOKEN), rewrite(item)]),
            );
        }

        return node;
    };

    return rewrite(value);
}

/** The 32 lowercase hex characters CDK appends to a Lambda version's logical id (a hash of the function's config). */
const VERSION_HASH = /^(.+[0-9A-F]{8})[0-9a-f]{32}$/u;

/** A 64-hex content hash naming a stack template asset, as `<hash>.json`. */
const TEMPLATE_ASSET_OBJECT = /[0-9a-f]{64}\.json/gu;

/** The suffix of an asset destination id: a hash of the destination's bucket and role, which move with the bootstrap. */
const DESTINATION_HASH = /-[0-9a-f]{8}$/u;

/**
 * Replaces every Lambda version's hashed logical id by its stable stem, in the resource keys AND every reference
 * (`Ref`, `Fn::GetAtt`, `DependsOn`: all whole-string occurrences).
 *
 * CDK derives a `currentVersion` logical id from a hash of the function's resolved properties, and those carry the
 * code asset's bucket, which is the qualifier. So moving to a new bootstrap re-hashes the id: CloudFormation
 * creates a new immutable version and repoints its consumers. Nothing holds data. It is the ONLY logical-id change
 * the move may cause, so it is named and counted rather than hidden.
 *
 * @returns The template with stems in place of hashed ids, and the full ids that were replaced.
 */
function stemLambdaVersions(template: Record<string, Json>): { stemmed: Json; versions: string[] } {
    const resources = template['Resources'];
    const stems = new Map<string, string>();

    if (isRecord(resources)) {
        for (const [id, resource] of Object.entries(resources)) {
            const match =
                isRecord(resource) && resource['Type'] === 'AWS::Lambda::Version' ? VERSION_HASH.exec(id) : null;

            if (match?.[1] !== undefined) {
                stems.set(id, match[1]);
            }
        }
    }

    const swap = (node: Json): Json => {
        if (typeof node === 'string') {
            return stems.get(node) ?? node;
        }

        if (Array.isArray(node)) {
            return node.map(swap);
        }

        if (isRecord(node)) {
            return Object.fromEntries(Object.entries(node).map(([key, item]) => [stems.get(key) ?? key, swap(item)]));
        }

        return node;
    };

    return { stemmed: swap(template), versions: [...stems.keys()] };
}

/**
 * Removes the identity CDK derives from the bootstrap out of an assets file or the cloud-assembly manifest.
 *
 * Three things move with the qualifier and carry no information of their own: the stack template asset's content
 * hash (the template changed, which the template comparison judges), the destination id suffix (a hash of bucket and
 * role) and the template object name inside the manifest. A CODE asset's hash is a hash of the build and stays: a
 * changed Lambda bundle is not part of this move.
 */
function normaliseAssetIdentity(file: Json): Json {
    const rename = (node: Json): Json => {
        if (typeof node === 'string') {
            return node.replace(TEMPLATE_ASSET_OBJECT, '<template hash>.json');
        }

        if (Array.isArray(node)) {
            return node.map(rename);
        }

        if (isRecord(node)) {
            return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, rename(item)]));
        }

        return node;
    };

    const renamed = rename(file);

    if (!isRecord(renamed) || !isRecord(renamed['files'])) {
        return renamed;
    }

    const files: Record<string, Json> = Object.create(null) as Record<string, Json>;

    for (const [hash, entry] of Object.entries(renamed['files'])) {
        const path = isRecord(entry) && isRecord(entry['source']) ? entry['source']['path'] : undefined;
        const key = typeof path === 'string' && path.endsWith('.template.json') ? `<template ${path}>` : hash;

        if (isRecord(entry) && isRecord(entry['destinations'])) {
            files[key] = {
                ...entry,
                destinations: Object.fromEntries(
                    Object.entries(entry['destinations']).map(([id, destination]) => [
                        id.replace(DESTINATION_HASH, ''),
                        destination,
                    ]),
                ),
            };
        } else {
            files[key] = entry as Json;
        }
    }

    return { ...renamed, files };
}

/**
 * Removes the expected boundary from every IAM role of a head template and reports each role that does not have it.
 *
 * @returns The template without the boundary, and the roles that lacked it (or carried another tier's).
 */
function stripBoundary(
    template: Record<string, Json>,
    qualifier: QualifierName,
): { stripped: Record<string, Json>; missing: string[] } {
    const missing: string[] = [];
    const resources = template['Resources'];

    if (!isRecord(resources)) {
        return { stripped: template, missing };
    }

    const expected = `policy/${boundaryPolicyName(qualifier)}`;
    const nextResources: Record<string, Json> = Object.create(null) as Record<string, Json>;

    for (const [id, resource] of Object.entries(resources)) {
        if (!isRecord(resource) || resource['Type'] !== 'AWS::IAM::Role') {
            nextResources[id] = resource;
            continue;
        }

        const properties = isRecord(resource['Properties']) ? { ...resource['Properties'] } : {};
        const boundary = JSON.stringify(properties['PermissionsBoundary'] ?? null);

        // The policy name is the last thing in the ARN, so the closing quote stops `-ksnonprod` matching a longer name.
        if (boundary.includes(`${expected}"`)) {
            delete properties['PermissionsBoundary'];
        } else {
            missing.push(id);
        }

        nextResources[id] = { ...resource, Properties: properties };
    }

    return { stripped: { ...template, Resources: nextResources }, missing };
}

/** Deep structural diff as readable dotted paths. Pure. */
function diff(base: Json | undefined, head: Json | undefined, where: string, out: string[]): void {
    if (out.length >= MAX_DIFFERENCES_PER_FILE) {
        return;
    }

    if (JSON.stringify(base) === JSON.stringify(head)) {
        return;
    }

    if (isRecord(base) && isRecord(head)) {
        for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
            diff(base[key], head[key], where === '' ? key : `${where}.${key}`, out);
        }

        return;
    }

    if (Array.isArray(base) && Array.isArray(head) && base.length === head.length) {
        base.forEach((item, index) => diff(item, head[index], `${where}[${index}]`, out));

        return;
    }

    const show = (value: Json | undefined): string =>
        value === undefined ? '<absent>' : JSON.stringify(value).slice(0, 120);
    out.push(`${where}: base ${show(base)} -> head ${show(head)}`);
}

/** The qualifier a stage is expected to have moved onto, or none for the stage-less account app. */
function expectedQualifier(stage: string): QualifierName | undefined {
    return stage === ACCOUNT_STAGE ? undefined : qualifierForStage(stage);
}

/** How many IAM roles a template declares. */
function countRoles(template: Record<string, Json>): number {
    const resources = template['Resources'];

    return isRecord(resources)
        ? Object.values(resources).filter((resource) => isRecord(resource) && resource['Type'] === 'AWS::IAM::Role')
              .length
        : 0;
}

/** Whether an `*.assets.json` declares any docker image. */
function hasDockerImage(assets: unknown): boolean {
    return (
        isRecord(assets as Json) &&
        Object.keys(((assets as Record<string, Json>)['dockerImages'] as Record<string, Json> | undefined) ?? {})
            .length > 0
    );
}

/** One file of one stage, base and head, after the expected qualifier move has been rewritten out of both. */
interface NormalisedPair {
    readonly base: Json;
    readonly head: Json;
    /** Findings of the normalisation itself (a role without its boundary). */
    readonly problems: readonly string[];
    readonly boundedRoles: number;
    readonly rehashedVersions: number;
}

/**
 * Rewrites the two expected changes (the qualifier token and the boundary) out of one file pair.
 *
 * @param where - The `<stage key>/<file>` the findings are reported under.
 * @param qualifier - The qualifier the head moved onto; `undefined` for the account app, which is compared as it is.
 * @returns The pair to diff, and what the rewrite found. Pure.
 */
function normalisePair(
    where: string,
    file: string,
    baseFile: Json,
    headFile: Json,
    qualifier: QualifierName | undefined,
): NormalisedPair {
    if (qualifier === undefined) {
        return { base: baseFile, head: headFile, problems: [], boundedRoles: 0, rehashedVersions: 0 };
    }

    const isTemplate = file.endsWith('.template.json');
    const problems: string[] = [];
    let boundedRoles = 0;
    let head = headFile;

    // The boundary is stripped from the ORIGINAL head: its ARN names the tier, and the token rewrite below would
    // erase which tier it was.
    if (isTemplate && isRecord(headFile)) {
        const { stripped, missing } = stripBoundary(headFile, qualifier);

        for (const id of missing) {
            problems.push(`${where}: role ${id} lacks the ${boundaryPolicyName(qualifier)} boundary`);
        }

        boundedRoles = countRoles(headFile) - missing.length;
        head = stripped;
    }

    const base = rewriteQualifier(baseFile, DEFAULT_QUALIFIER);

    head = rewriteQualifier(head, qualifier);

    if (isTemplate && isRecord(base) && isRecord(head)) {
        const baseVersions = stemLambdaVersions(base);
        const headVersions = stemLambdaVersions(head);

        return {
            base: baseVersions.stemmed,
            head: headVersions.stemmed,
            problems,
            boundedRoles,
            rehashedVersions: headVersions.versions.filter((id) => !baseVersions.versions.includes(id)).length,
        };
    }

    if (file.endsWith('.assets.json') || file === 'manifest.json') {
        return {
            base: normaliseAssetIdentity(base),
            head: normaliseAssetIdentity(head),
            problems,
            boundedRoles,
            rehashedVersions: 0,
        };
    }

    return { base, head, problems, boundedRoles, rehashedVersions: 0 };
}

/** What comparing one stage's files found. */
interface StageComparison {
    readonly differences: readonly string[];
    readonly summary: string;
}

/** The one-line summary of a stage: how many files came through unchanged, and what the move accounted for. */
function summaryLine(
    key: string,
    counts: { identical: number; files: number; boundedRoles: number; rehashedVersions: number },
    qualifier: QualifierName | undefined,
): string {
    const head = `${key}: ${counts.identical}/${counts.files} files identical after the qualifier move`;

    if (qualifier === undefined) {
        return `${head} (account app: no move expected)`;
    }

    const rehashed =
        counts.rehashedVersions > 0
            ? `, ${counts.rehashedVersions} Lambda version(s) re-hashed (code-bucket-derived id; no data)`
            : '';

    return `${head}, ${counts.boundedRoles} roles bounded by ${boundaryPolicyName(qualifier)}${rehashed}`;
}

/** Compares every file of one stage's base capture with its head capture. */
function compareStage(
    key: string,
    baseFiles: Record<string, unknown>,
    headFiles: Record<string, unknown>,
): StageComparison {
    const differences: string[] = [];
    const qualifier = expectedQualifier(key.slice(key.lastIndexOf('/') + 1));
    const counts = { identical: 0, files: Object.keys(baseFiles).length, boundedRoles: 0, rehashedVersions: 0 };

    for (const file of Object.keys(baseFiles).sort()) {
        const headFile = headFiles[file] as Json | undefined;

        if (headFile === undefined) {
            differences.push(`${key}/${file}: missing from the head capture`);
            continue;
        }

        const pair = normalisePair(`${key}/${file}`, file, baseFiles[file] as Json, headFile, qualifier);
        const found: string[] = [];

        diff(pair.base, pair.head, '', found);

        counts.identical += found.length === 0 ? 1 : 0;
        counts.boundedRoles += pair.boundedRoles;
        counts.rehashedVersions += pair.rehashedVersions;
        differences.push(...pair.problems, ...found.map((line) => `${key}/${file}: ${line}`));

        if (file.endsWith('.assets.json') && hasDockerImage(headFile)) {
            differences.push(
                `${key}/${file}: the head produces a docker image asset (CI roles get no image-publishing role)`,
            );
        }
    }

    for (const file of Object.keys(headFiles)) {
        if (baseFiles[file] === undefined) {
            differences.push(`${key}/${file}: present only in the head capture`);
        }
    }

    return { differences, summary: summaryLine(key, counts, qualifier) };
}

/**
 * Compares a base capture with a head capture.
 *
 * @param base - Captured on the commit before the move.
 * @param head - Captured on the branch.
 * @returns The differences (empty when the head is the base plus the qualifier move and the boundary) and a summary. Pure.
 */
export function compareCaptures(base: Capture, head: Capture): ParityReport {
    const differences: string[] = [];
    const summary: string[] = [];

    for (const key of Object.keys(base).sort()) {
        const headFiles = head[key];

        if (headFiles === undefined) {
            differences.push(`${key}: missing from the head capture`);
            continue;
        }

        const stage = compareStage(key, base[key] ?? {}, headFiles);

        differences.push(...stage.differences);
        summary.push(stage.summary);
    }

    for (const key of Object.keys(head)) {
        if (base[key] === undefined) {
            differences.push(`${key}: present only in the head capture`);
        }
    }

    return { differences, summary };
}
