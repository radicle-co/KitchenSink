/**
 * Compares the screens a Maestro run RECORDED with the screens each flow's registry row names. The mobile twin of
 * `routeCheck.ts`.
 *
 * The row is a lower bound read by hand; a tap that lands on another screen is invisible to it. The test build
 * (`useScreenTrace.maestro.ts`) logs each screen it shows, the runner writes those lines per flow, and this finds three
 * things:
 *
 * - missing: the flow saw a screen its row lacks. The run fails, because a change to that screen would not run the flow.
 * - silent: the flow passed and recorded nothing. The run fails, because the recorder did not run and nothing was checked.
 * - wider: the row names screens the passed flow never showed. Printed only. A row narrows by a person, on evidence from
 *   several runs, never by this check: one run takes one branch of a `when:`.
 *
 * @pattern Specification — the three predicates over a run's records
 */

const KINDS = ['screen', 'result'] as const;
const RESULTS = ['passed', 'failed', 'skipped'] as const;

export type FlowResult = (typeof RESULTS)[number];

export type ScreenRecord =
    | { readonly kind: 'screen'; readonly flow: string; readonly screen: string }
    | { readonly kind: 'result'; readonly flow: string; readonly result: FlowResult };

export interface ScreenCheck {
    /** Flows that saw a screen their row lacks; the screens to add, sorted. */
    readonly missing: readonly { readonly flow: string; readonly screens: readonly string[] }[];
    /** Flows that passed and recorded no screen. */
    readonly silent: readonly string[];
    /** Passed flows whose row names screens that were never shown. */
    readonly wider: readonly {
        readonly flow: string;
        readonly screens: readonly string[];
        /** The flow, or a flow it runs, has `when:` branches, so one run may not have taken them all. */
        readonly branching: boolean;
    }[];
}

/**
 * Reads a lane's record file: `screen<TAB>flow<TAB>Name` and `result<TAB>flow<TAB>passed|failed|skipped` lines.
 *
 * @param text - The file's text.
 * @param label - The file's name, for error messages.
 * @returns The records, in file order.
 * @throws When a line is not a record: a reader that skipped it would read damage as "the flow saw nothing".
 */
export function parseScreenRecords(text: string, label: string): readonly ScreenRecord[] {
    return text.split('\n').flatMap((line, index): ScreenRecord[] => {
        if (line.trim() === '') {
            return [];
        }

        const [kind, flow, value, ...extra] = line.split('\t');
        const where = `${label} line ${index + 1}`;

        if (!KINDS.includes(kind as (typeof KINDS)[number]) || flow === undefined || flow === '' || extra.length > 0) {
            throw new Error(`${where}: a record is screen|result, a flow and a value, separated by tabs`);
        }

        if (value === undefined || value === '') {
            throw new Error(`${where}: a record needs a value`);
        }

        if (kind === 'screen') {
            return [{ kind, flow, screen: value }];
        }

        if (!RESULTS.includes(value as FlowResult)) {
            throw new Error(`${where}: a result is one of ${RESULTS.join(', ')}`);
        }

        return [{ kind: 'result', flow, result: value as FlowResult }];
    });
}

export interface ScreenCheckInput {
    readonly records: readonly ScreenRecord[];
    /** Each flow's combined row: its own, the sub-flows' and the screens every flow passes through. */
    readonly coverage: ReadonlyMap<string, ReadonlySet<string>>;
    /** Flows that have `when:` branches. */
    readonly branching: ReadonlySet<string>;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => a.localeCompare(b));

/**
 * Checks one platform's records against the registry.
 *
 * @param input - The records, the combined rows and the branching flows.
 * @returns What is missing, silent and wider.
 */
export function checkScreens(input: ScreenCheckInput): ScreenCheck {
    const seen = new Map<string, Set<string>>();
    const results = new Map<string, FlowResult>();

    for (const record of input.records) {
        if (record.kind === 'screen') {
            seen.set(record.flow, (seen.get(record.flow) ?? new Set()).add(record.screen));
        } else {
            results.set(record.flow, record.result);
        }
    }

    const missing = sorted(seen.keys()).flatMap((flow) => {
        const row = input.coverage.get(flow) ?? new Set<string>();
        const absent = sorted([...(seen.get(flow) ?? [])].filter((screen) => !row.has(screen)));

        return absent.length > 0 ? [{ flow, screens: absent }] : [];
    });
    const passed = sorted(results.keys()).filter((flow) => results.get(flow) === 'passed');
    const silent = passed.filter((flow) => (seen.get(flow)?.size ?? 0) === 0);
    const wider = passed.flatMap((flow) => {
        const shown = seen.get(flow);

        if (shown === undefined) {
            return [];
        }

        const unseen = sorted([...(input.coverage.get(flow) ?? [])].filter((screen) => !shown.has(screen)));

        return unseen.length > 0 ? [{ flow, screens: unseen, branching: input.branching.has(flow) }] : [];
    });

    return { missing, silent, wider };
}

/**
 * The text to print for one platform's check.
 *
 * @param check - The check.
 * @param platform - The platform the records came from.
 * @returns One line per finding; empty when there is none.
 */
export function renderScreenCheck(check: ScreenCheck, platform: string): string {
    return [
        ...check.missing.map(
            (row) => `${platform} ${row.flow}: add ${row.screens.join(', ')} to its row in maestroFlowScreens.tsv`,
        ),
        ...check.silent.map(
            (flow) => `${platform} ${flow}: passed and recorded no screen, so the recorder did not run for it`,
        ),
        ...check.wider.map(
            (row) =>
                `${platform} ${row.flow}: row is wider than observed by ${row.screens.join(', ')}` +
                (row.branching ? ' (has when: branches, so one run may not show them all)' : ''),
        ),
    ]
        .map((line) => `${line}\n`)
        .join('');
}

/**
 * Counts the flows a run was meant to run by what it recorded for each.
 *
 * A flow with no result never ran, and that is a skip: it is not a pass, and the green stamp must not move over it.
 *
 * @param expected - The flows the lanes were given.
 * @param results - Each flow's recorded result.
 * @returns The counts, over the expected flows only.
 */
export function flowOutcomes(
    expected: readonly string[],
    results: ReadonlyMap<string, FlowResult>,
): { readonly passed: number; readonly failed: number; readonly skipped: number } {
    const count = (wanted: FlowResult): number => expected.filter((flow) => results.get(flow) === wanted).length;
    const passed = count('passed');
    const failed = count('failed');

    return { passed, failed, skipped: expected.length - passed - failed };
}

/**
 * Each flow's result in a run's records; a flow recorded twice keeps its last.
 *
 * @param records - The records.
 * @returns Flow to result.
 */
export function resultsOf(records: readonly ScreenRecord[]): ReadonlyMap<string, FlowResult> {
    return new Map(
        records.flatMap((record) => (record.kind === 'result' ? [[record.flow, record.result] as const] : [])),
    );
}
