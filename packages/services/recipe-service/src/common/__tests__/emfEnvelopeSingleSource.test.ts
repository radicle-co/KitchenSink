/**
 * ⛔ THIS SERVICE CONSTRUCTS THE CLOUDWATCH EMF ENVELOPE IN EXACTLY ONE PLACE.
 *
 * The envelope — `_aws.CloudWatchMetrics[{ Namespace, Dimensions, Metrics }]` plus the flattened value
 * fields — is fixed by the AWS EMF spec, not by any one metric. It is a single piece of knowledge with a
 * single reason to change, which is why `recipe-workers` (`common/metrics.ts`) and `food-service`
 * (`observability/emfMetrics.ts`) each already own exactly one copy. This service had TWO —
 * `account/erasureMetrics.ts` and `ingredients/resolution/mappingPromotionAudit.ts` — and a THIRD was written
 * against it before either was migrated, whose author recorded the extraction as owed rather than adding a
 * fourth. This gate is what stops the count going back up.
 *
 * ## ⚠️ What is NOT one piece of knowledge, so that nobody "finishes the job" wrongly
 *
 * The METRIC NAME and NAMESPACE are an alarm contract, and the per-emitter payload names different facts. A
 * shared emitter parameterised by exactly the things that differ would be one pattern wearing several names,
 * and would put an alarm contract behind an argument. Emitters stay separate classes with their own constants
 * and their own log lines; only the envelope and the stage resolution are shared.
 *
 * ## ⚠️ IT PARSES, IT DOES NOT GREP
 *
 * This very docstring writes the envelope's own key names, and so do the emitters' explanatory comments. A
 * substring scan would report its own rationale — a mistake this repository has made before, which is why
 * `emfIdentifierDimensionRepoGate.test.ts` and `bearerOnlyPrecondition.test.ts` both parse. Only a real object
 * literal produces a finding, and the pure detector is exercised against a source where the key appears solely
 * in a comment and a string.
 *
 * ## ⚠️ AND IT ASSERTS NON-VACUITY FIRST
 *
 * A walk that reaches zero files passes every "found nothing extra" assertion. The suite therefore proves the
 * scan reached a realistic file count and found the one real envelope before concluding anything.
 *
 * @module
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';
import ts from 'typescript';

/** `src/`, absolute. `import.meta.dirname` is `src/common/__tests__`. */
const SRC_ROOT = join(import.meta.dirname, '../..');

/**
 * The ONE module allowed to construct the envelope, relative to `src/`.
 *
 * ⚠️ A single name rather than a list, deliberately. A list is a thing that grows by one line per violation,
 * and the whole finding this gate records is that the copies multiplied while every reader thought the
 * duplication was known about.
 */
const ENVELOPE_OWNER = 'common/emfMetricLine.ts';

/**
 * Find every EMF envelope construction in one TypeScript source, by walking its AST. Pure.
 *
 * The anchor is the AWS spec rather than our naming: an object literal with an `_aws` property whose value is
 * an object literal declaring `CloudWatchMetrics`. Rename every emitter in the tree and this still finds them;
 * write the words in a comment or a string and it does not.
 *
 * @param fileName - Used only for the parser's diagnostics.
 * @param source - The file's text.
 * @returns The 1-based line of each envelope found, in source order.
 */
export function findEmfEnvelopes(fileName: string, source: string): number[] {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const found: number[] = [];

    const declaresCloudWatchMetrics = (node: ts.Expression): boolean =>
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
            (property) =>
                property.name !== undefined &&
                ts.isIdentifier(property.name) &&
                property.name.text === 'CloudWatchMetrics',
        );

    const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === '_aws') {
            if (declaresCloudWatchMetrics(node.initializer)) {
                found.push(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return found;
}

/** One scanned source file. */
interface ScannedFile {
    /** Path relative to `src/`, slash-normalized. */
    readonly path: string;
    readonly source: string;
}

/**
 * Every non-test `.ts` file under `directory`, recursively.
 *
 * `__tests__` directories are skipped: a test legitimately builds an envelope literal to assert against.
 *
 * @param directory - Absolute directory to walk.
 * @returns Each file's `src/`-relative path and text.
 * @sideEffect Reads the filesystem.
 */
async function readSourceFiles(directory: string): Promise<ScannedFile[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: ScannedFile[] = [];

    for (const entry of entries) {
        const full = join(directory, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === '__fixtures__') {
                continue;
            }

            files.push(...(await readSourceFiles(full)));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            files.push({ path: relative(SRC_ROOT, full).split(sep).join('/'), source: await readFile(full, 'utf8') });
        }
    }

    return files;
}

const sourceFiles = await readSourceFiles(SRC_ROOT);
const emitters = sourceFiles
    .filter((file) => findEmfEnvelopes(file.path, file.source).length > 0)
    .map(({ path }) => path);

describe('the detector parses rather than greps', () => {
    it('finds a real envelope', () => {
        const source = [
            'const line = {',
            '    _aws: { Timestamp: 1, CloudWatchMetrics: [{ Namespace: "n", Dimensions: [["Stage"]] }] },',
            '};',
        ].join('\n');

        expect(findEmfEnvelopes('x.ts', source)).toEqual([2]);
    });

    it('does NOT fire on the words in a comment or a string', () => {
        const source = [
            '// The _aws envelope declares CloudWatchMetrics with a Dimensions directive.',
            'const doc = "_aws.CloudWatchMetrics";',
        ].join('\n');

        expect(findEmfEnvelopes('x.ts', source)).toEqual([]);
    });

    it('does NOT fire on an unrelated property named _aws', () => {
        // The anchor is the spec's directive, not the key alone — a config object could reasonably be
        // named `_aws` and is not an EMF record.
        expect(findEmfEnvelopes('x.ts', 'const c = { _aws: { region: "us-east-1" } };')).toEqual([]);
    });
});

describe('the EMF envelope has exactly one owner in this service', () => {
    it('⚠️ scanned a realistic tree — non-vacuity before any absence claim', () => {
        expect(sourceFiles.length).toBeGreaterThan(200);
        expect(sourceFiles.map(({ path }) => path)).toContain(ENVELOPE_OWNER);
    });

    it('⚠️ found the real envelope — the scan is not passing because it detects nothing', () => {
        expect(emitters).toContain(ENVELOPE_OWNER);
    });

    it('⛔ and found NO other — a second construction is a second bearer of the AWS spec', () => {
        expect(emitters).toEqual([ENVELOPE_OWNER]);
    });
});
