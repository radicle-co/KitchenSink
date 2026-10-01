/**
 * @module @kitchensink/docgen-components/generate — the orchestrator: discover, extract, assemble, judge,
 * and render the exact bytes of every generated artifact.
 *
 * Pattern: **Builder** producing an immutable artifact set, deliberately SPLIT from the write. `buildArtifacts`
 * is a pure-ish derivation returning `path -> text`; `writeArtifacts` is the only thing that touches the output
 * tree. That split is what lets the staleness guard REGENERATE IN MEMORY and compare, instead of running the
 * real generator — a guard that wrote would silently REPAIR a drifted checkout and report success having erased
 * its own evidence. The same reasoning is written up in `packages/services/identity/contract/__tests__`.
 *
 * @sideEffect Reads component sources and the `@commise/ui` token modules; `writeArtifacts` writes files.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildEntries } from './catalog.js';
import { COMPONENTS_OUT_DIR, COMPONENT_GROUPS, DESIGN_OUT_DIR, REPO_ROOT, SCHEMA_VERSION } from './config.js';
import type { ComponentGroup } from './config.js';
import { discoverComponentFiles } from './discovery.js';
import { extractImplementations, loadCompilerOptions } from './extract.js';
import { collectFindings } from './findings.js';
import type { ComponentEntry, Finding } from './model.js';
import { toJsonText } from './serialize.js';
import { buildDesignTokens } from './tokens.js';

/** Countable documentation coverage for a set of components. */
export interface Coverage {
    readonly components: number;
    readonly implementations: number;
    readonly props: number;
    /** Components with a docblock on at least one leaf. */
    readonly documentedComponents: number;
    /** Leaves whose FILE carries a module docblock. */
    readonly implementationsWithModuleDoc: number;
    /** Leaves whose component declaration carries a JSDoc summary. */
    readonly implementationsWithComponentDoc: number;
    readonly documentedProps: number;
    /** Components whose docblocks state which side of the orchestration/render split they are on. */
    readonly classifiedComponents: number;
    /** Components naming a design pattern with an explicit `@pattern` tag. */
    readonly componentsWithPatternTag: number;
    readonly crossPlatformComponents: number;
}

/** One group's slice of the catalogue. */
export interface GroupCatalogue {
    readonly schemaVersion: number;
    readonly group: string;
    readonly packageName: string;
    readonly layer: ComponentGroup['layer'];
    readonly coverage: Coverage;
    readonly components: readonly ComponentEntry[];
}

/** Sum coverage over a set of components. */
function coverageOf(entries: readonly ComponentEntry[]): Coverage {
    const leaves = entries.flatMap((entry) => entry.implementations);
    const props = leaves.flatMap((leaf) => leaf.props);

    return {
        components: entries.length,
        implementations: leaves.length,
        props: props.length,
        documentedComponents: entries.filter((entry) => entry.documented).length,
        implementationsWithModuleDoc: leaves.filter((leaf) => leaf.moduleDoc !== '').length,
        implementationsWithComponentDoc: leaves.filter((leaf) => leaf.description !== '').length,
        documentedProps: props.filter((prop) => prop.description !== '').length,
        classifiedComponents: entries.filter((entry) => entry.kind !== 'unclassified').length,
        componentsWithPatternTag: entries.filter((entry) => entry.patterns.length > 0).length,
        crossPlatformComponents: entries.filter((entry) => entry.crossPlatform).length,
    };
}

/** Add two coverage records field by field. */
function addCoverage(left: Coverage, right: Coverage): Coverage {
    return {
        components: left.components + right.components,
        implementations: left.implementations + right.implementations,
        props: left.props + right.props,
        documentedComponents: left.documentedComponents + right.documentedComponents,
        implementationsWithModuleDoc: left.implementationsWithModuleDoc + right.implementationsWithModuleDoc,
        implementationsWithComponentDoc: left.implementationsWithComponentDoc + right.implementationsWithComponentDoc,
        documentedProps: left.documentedProps + right.documentedProps,
        classifiedComponents: left.classifiedComponents + right.classifiedComponents,
        componentsWithPatternTag: left.componentsWithPatternTag + right.componentsWithPatternTag,
        crossPlatformComponents: left.crossPlatformComponents + right.crossPlatformComponents,
    };
}

/** The zero of {@link addCoverage}. */
const EMPTY_COVERAGE: Coverage = {
    components: 0,
    implementations: 0,
    props: 0,
    documentedComponents: 0,
    implementationsWithModuleDoc: 0,
    implementationsWithComponentDoc: 0,
    documentedProps: 0,
    classifiedComponents: 0,
    componentsWithPatternTag: 0,
    crossPlatformComponents: 0,
};

/**
 * Read one group's components out of its sources.
 *
 * @param group - The group to document.
 * @param repoRoot - Absolute repository root.
 * @returns Its components, ordered by id.
 * @sideEffect Reads the group's sources and its `tsconfig.json`.
 */
export function readGroup(group: ComponentGroup, repoRoot: string): readonly ComponentEntry[] {
    const packageDir = resolve(repoRoot, group.packageDir);
    const files = group.sourceRoots.flatMap((root) => discoverComponentFiles(resolve(repoRoot, root)));

    return buildEntries(
        group,
        extractImplementations({
            repoRoot,
            packageDir,
            compilerOptions: loadCompilerOptions(packageDir),
            files,
        }),
    );
}

/**
 * Build every generated artifact as `repo-relative path -> file text`.
 *
 * @param repoRoot - Absolute repository root. Defaults to this checkout's root.
 * @returns The artifact set, which IS the committed output byte for byte.
 * @sideEffect Reads component sources and the `@commise/ui` token modules.
 */
export function buildArtifacts(repoRoot: string = REPO_ROOT): ReadonlyMap<string, string> {
    const artifacts = new Map<string, string>();
    const summaries: {
        readonly id: string;
        readonly title: string;
        readonly packageName: string;
        readonly layer: ComponentGroup['layer'];
        readonly catalogue: string;
        readonly coverage: Coverage;
    }[] = [];
    const findings: Finding[] = [];
    let totals = EMPTY_COVERAGE;

    for (const group of COMPONENT_GROUPS) {
        const components = readGroup(group, repoRoot);
        const coverage = coverageOf(components);
        const catalogue: GroupCatalogue = {
            schemaVersion: SCHEMA_VERSION,
            group: group.id,
            packageName: group.packageName,
            layer: group.layer,
            coverage,
            components,
        };

        artifacts.set(`${COMPONENTS_OUT_DIR}/groups/${group.id}.json`, toJsonText(catalogue));
        summaries.push({
            id: group.id,
            title: group.title,
            packageName: group.packageName,
            layer: group.layer,
            catalogue: `${COMPONENTS_OUT_DIR}/groups/${group.id}.json`,
            coverage,
        });
        findings.push(...collectFindings(components, group.platforms.length > 1));
        totals = addCoverage(totals, coverage);
    }

    const index = {
        schemaVersion: SCHEMA_VERSION,
        generatedBy: '@kitchensink/docgen-components',
        totals,
        groups: summaries,
        findings: `${COMPONENTS_OUT_DIR}/findings.json`,
        designTokens: `${DESIGN_OUT_DIR}/tokens.json`,
    };

    const findingCounts = findings.reduce<Record<string, number>>((counts, finding) => {
        counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;

        return counts;
    }, {});

    artifacts.set(`${COMPONENTS_OUT_DIR}/index.json`, toJsonText(index));
    artifacts.set(
        `${COMPONENTS_OUT_DIR}/findings.json`,
        toJsonText({
            schemaVersion: SCHEMA_VERSION,
            counts: Object.fromEntries(
                Object.entries(findingCounts).sort(([left], [right]) => left.localeCompare(right)),
            ),
            findings,
        }),
    );

    const tokens = buildDesignTokens(repoRoot);
    artifacts.set(`${DESIGN_OUT_DIR}/tokens.json`, toJsonText(tokens));
    artifacts.set(
        `${DESIGN_OUT_DIR}/index.json`,
        toJsonText({
            schemaVersion: SCHEMA_VERSION,
            generatedBy: '@kitchensink/docgen-components',
            source: tokens.source,
            tokens: `${DESIGN_OUT_DIR}/tokens.json`,
            groups: tokens.groups.map((group) => ({
                id: group.id,
                source: group.source,
                tokenCount: group.tokens.length,
                kinds: [...new Set(group.tokens.map((token) => token.kind))].sort(),
            })),
        }),
    );

    return artifacts;
}

/**
 * Write the artifact set, replacing the output directories wholesale.
 *
 * The directories are REMOVED first so a component that was deleted from the tree cannot leave a stale
 * catalogue file behind — the guard compares the artifact set to what is on disk, and an orphan would make it
 * fail with no source to point at.
 *
 * @param artifacts - Repo-relative path to file text.
 * @param repoRoot - Absolute repository root.
 * @sideEffect Deletes and rewrites `docs/generated/components` and `docs/generated/design`.
 */
export async function writeArtifacts(artifacts: ReadonlyMap<string, string>, repoRoot: string): Promise<void> {
    for (const directory of [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR]) {
        await rm(join(repoRoot, directory), { recursive: true, force: true });
    }

    for (const [path, text] of artifacts) {
        const absolute = join(repoRoot, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, text, 'utf8');
    }
}

/**
 * Read the committed artifacts back, for the staleness guard.
 *
 * @param paths - Repo-relative paths.
 * @param repoRoot - Absolute repository root.
 * @returns Path to file text; a missing file is reported as `null` rather than throwing, so the guard can
 *   name every difference in one run instead of stopping at the first.
 * @sideEffect Reads the filesystem.
 */
export async function readCommittedArtifacts(
    paths: readonly string[],
    repoRoot: string,
): Promise<ReadonlyMap<string, string | null>> {
    const entries = await Promise.all(
        paths.map(async (path): Promise<readonly [string, string | null]> => {
            try {
                return [path, await readFile(join(repoRoot, path), 'utf8')];
            } catch {
                return [path, null];
            }
        }),
    );

    return new Map(entries);
}
