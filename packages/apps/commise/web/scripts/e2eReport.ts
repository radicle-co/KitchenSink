/**
 * Playwright's JSON report, read at the boundary, and what a run's tests did.
 */
import { z } from 'zod';

import { DEPLOYED_ONLY_SPECS } from '../tests/e2e/utils/deployedOnlySpecs';

const reportTestSchema = z.object({
    projectName: z.string(),
    status: z.string(),
    results: z.array(z.object({ duration: z.number() })).optional(),
});
const reportSpecSchema = z.object({ title: z.string(), file: z.string().optional(), tests: z.array(reportTestSchema) });
interface ReportSuite {
    readonly title: string;
    readonly file?: string | undefined;
    readonly specs?: readonly z.infer<typeof reportSpecSchema>[] | undefined;
    readonly suites?: readonly ReportSuite[] | undefined;
}
const reportSuiteSchema: z.ZodType<ReportSuite> = z.lazy(() =>
    z.object({
        title: z.string(),
        file: z.string().optional(),
        specs: z.array(reportSpecSchema).optional(),
        suites: z.array(reportSuiteSchema).optional(),
    }),
);
const reportSchema = z.object({ suites: z.array(reportSuiteSchema) });
/** The part of Playwright's JSON report this script reads. */
export type PlaywrightReport = z.infer<typeof reportSchema>;

/**
 * Reads a Playwright JSON report.
 *
 * @param text - The report file's text.
 * @returns The report.
 * @throws When the text is not a report. A parse that quietly answered "no tests" would pass the count check.
 */
export const parseReport = (text: string): PlaywrightReport => reportSchema.parse(JSON.parse(text));

export interface ReportedTest {
    readonly project: string;
    /** `project › file › describe › title`, the form `--list` prints. */
    readonly id: string;
    readonly status: string;
    /** All attempts added up, in milliseconds. */
    readonly durationMs: number;
}

const walk = (suite: ReportSuite, path: readonly string[]): readonly ReportedTest[] => {
    const here = [...path, suite.title];

    return [
        ...(suite.specs ?? []).flatMap((spec) =>
            spec.tests.map((test) => ({
                project: test.projectName,
                id: [test.projectName, ...here, spec.title].join(' › '),
                status: test.status,
                durationMs: (test.results ?? []).reduce((sum, result) => sum + result.duration, 0),
            })),
        ),
        ...(suite.suites ?? []).flatMap((child) => walk(child, here)),
    ];
};

/**
 * Every test in a Playwright JSON report.
 *
 * @param report - The parsed report.
 * @returns One entry per test per project.
 */
export const flattenReport = (report: PlaywrightReport): readonly ReportedTest[] =>
    report.suites.flatMap((suite) => walk(suite, []));

/**
 * How many tests a report holds, `setup` left out.
 *
 * @param report - The parsed report.
 * @returns The count.
 */
export const countTests = (report: PlaywrightReport): number =>
    flattenReport(report).filter((test) => test.project !== 'setup').length;

/**
 * The verdict over every lane.
 *
 * @param input - The count listed before the run, the count merged after it, and each lane's exit code.
 * @returns The exit code (the worst lane's, or 1 when the counts differ) and what was wrong.
 */
export function verdict(input: {
    readonly listed: number;
    readonly merged: number;
    readonly laneCodes: readonly (number | null)[];
}): { readonly exitCode: number; readonly problems: readonly string[] } {
    const problems: string[] = [];
    const codes = input.laneCodes.map((code) => code ?? 1);

    if (input.laneCodes.some((code) => code === null)) {
        problems.push('a lane was killed by a signal');
    }

    if (input.merged !== input.listed) {
        problems.push(`the merged report holds ${input.merged} tests but ${input.listed} were listed`);
    }

    const worst = Math.max(0, ...codes);

    return { exitCode: worst === 0 && problems.length > 0 ? 1 : worst, problems };
}

/** What a run's tests did, in the counts the stamp policy reads, and the declared specs it did not run. */
export interface Outcomes {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    /** Specs the suite declares deployed-only that skipped, sorted. They are owed, not skipped. */
    readonly owed: readonly string[];
}

/** The spec file a test id names: `project › file › describe › title`. */
export const specOf = (test: ReportedTest): string => test.id.split(' › ')[1] ?? '';

/**
 * What a run's tests did, in the counts the stamp policy reads.
 *
 * A flaky test counts as failed: it passed only on a retry, so it is not evidence that the change is fine. `setup` is
 * left out because Playwright runs it as a dependency and no selector chose it. A skip in a spec the suite declares
 * deployed-only (`DEPLOYED_ONLY_SPECS`) is OWED: the spec cannot run here, says so, and is listed every run. Any other
 * skip stays a skip, and refuses the stamp.
 *
 * @param tests - The tests of a run's report.
 * @param deployedOnly - The specs declared deployed-only.
 * @returns How many passed, failed and were skipped, and which declared specs are owed.
 */
export function outcomesOf(
    tests: readonly ReportedTest[],
    deployedOnly: ReadonlySet<string> = new Set(DEPLOYED_ONLY_SPECS),
): Outcomes {
    const own = tests.filter((test) => test.project !== 'setup');
    const count = (...statuses: readonly string[]): number =>
        own.filter((test) => statuses.includes(test.status)).length;
    const skipped = own.filter((test) => test.status === 'skipped');
    const owed = skipped.filter((test) => deployedOnly.has(specOf(test)));

    return {
        passed: count('expected'),
        failed: own.length - count('expected', 'skipped'),
        skipped: skipped.length - owed.length,
        owed: [...new Set(owed.map(specOf))].sort(),
    };
}
