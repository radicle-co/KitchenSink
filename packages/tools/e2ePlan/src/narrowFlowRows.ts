/**
 * Narrows the Maestro flow registry from what two platforms observed, by one fixed rule.
 *
 * The rows of `maestroFlowScreens.tsv` were seeded coarse on purpose. The screen recorder (`recordedScreens`) prints, for
 * a flow that passed, the screens its row names and the run did not show ("row is wider than observed by ..."), and the
 * screens it showed that the row lacks ("add ... to its row"). This turns those lines of an Android run and an iOS run
 * into one narrowing, and nothing else narrows a row:
 *
 * A screen leaves a flow's own row only when BOTH platforms found the passing flow went without it, neither saw it, the
 * flow's own file has no `when:` branches (one run takes one branch), and the screen is not supplied by a sign-in sub-flow's row
 * or by the pass-through screen. A flow with no evidence from a platform keeps its whole row.
 */
import type { CoverageTable } from './coverageTable.js';

export type Platform = 'android' | 'ios';

/** What a platform's run said about one flow. */
export interface Observation {
    /** Screens the row names that the passing flow did not show. */
    readonly wider: ReadonlySet<string>;
    /** Screens the flow showed that its row lacks. */
    readonly added: ReadonlySet<string>;
}

export type Evidence = ReadonlyMap<string, Observation>;

/** The pass-through screen of every flow; it is never narrowed. */
const PASS_THROUGH = 'HomeScreen';

const LINE = /^(?:maestro:lanes: \S+ )?(android|ios) (\S+): (.*)$/u;
const ADD = /^add (.+) to its row in maestroFlowScreens\.tsv$/u;
const WIDER = /^row is wider than observed by (.+?)(?: \(has when:.*)?$/u;

const names = (list: string): readonly string[] =>
    list
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');

/**
 * Reads one platform's recorder lines.
 *
 * @param text - The recorder output; other lines and the other platform's lines are ignored.
 * @param platform - Which platform's lines to read.
 * @returns Per flow id, the screens its row was wider than, and the screens it lacked.
 */
export function parseRecorderText(text: string, platform: Platform): Evidence {
    const found = new Map<string, { wider: Set<string>; added: Set<string> }>();

    for (const line of text.split('\n')) {
        const match = LINE.exec(line.trim());

        if (match === null || match[1] !== platform) {
            continue;
        }

        const [, , flow = '', body = ''] = match;
        const entry = found.get(flow) ?? { wider: new Set<string>(), added: new Set<string>() };
        const add = ADD.exec(body);
        const wider = WIDER.exec(body);

        if (add?.[1] !== undefined) {
            names(add[1]).forEach((name) => entry.added.add(name));
        } else if (wider?.[1] !== undefined) {
            names(wider[1]).forEach((name) => entry.wider.add(name));
        } else {
            continue;
        }

        found.set(flow, entry);
    }

    return found;
}

export interface NarrowInput {
    readonly table: CoverageTable;
    /** Ids that are sub-flows (the sign-in flows), whose rows belong to every flow that runs them. */
    readonly subflows: ReadonlySet<string>;
    /** The screens the sub-flows a flow runs supply to it through their rows. */
    readonly suppliedBySubflows: (flow: string) => ReadonlySet<string>;
    /** Flows whose own file has `when:` branches. */
    readonly branching: ReadonlySet<string>;
    readonly android: Evidence;
    readonly ios: Evidence;
}

export interface NarrowResult {
    /** The table with the screens removed. */
    readonly table: Map<string, Set<string>>;
    readonly removed: readonly { readonly flow: string; readonly screens: readonly string[] }[];
    /** Screens a platform showed that the row lacks. The recorder fails those flows until they are added; nothing here adds them. */
    readonly owedAdditions: readonly { readonly flow: string; readonly screens: readonly string[] }[];
    /** Every top-level flow that lost nothing, and why. */
    readonly kept: readonly { readonly flow: string; readonly reason: string }[];
}

/**
 * Applies the rule.
 *
 * @param input - The registry, the flow graph facts and the two platforms' evidence.
 * @returns The narrowed table, what left each row, and why every other flow kept its row.
 */
export function narrowRows(input: NarrowInput): NarrowResult {
    const table = new Map([...input.table].map(([flow, screens]) => [flow, new Set(screens)] as const));
    const removed: { flow: string; screens: string[] }[] = [];
    const kept: { flow: string; reason: string }[] = [];
    const owedAdditions = [...input.table.keys()].flatMap((flow) => {
        const seen = [...(input.android.get(flow)?.added ?? []), ...(input.ios.get(flow)?.added ?? [])];
        const lacking = [...new Set(seen)].filter((screen) => !input.table.get(flow)?.has(screen)).sort();

        return lacking.length === 0 ? [] : [{ flow, screens: lacking }];
    });

    for (const [flow, row] of input.table) {
        if (input.subflows.has(flow)) {
            continue;
        }

        const android = input.android.get(flow);
        const ios = input.ios.get(flow);
        const missing = (['android', 'ios'] as const).find(
            (platform) => (platform === 'android' ? android : ios) === undefined,
        );

        if (android === undefined || ios === undefined) {
            kept.push({
                flow,
                reason: `no wider-than-observed line from ${missing ?? 'a platform'}: it showed the whole row, or did not pass`,
            });

            continue;
        }

        if (input.branching.has(flow)) {
            kept.push({ flow, reason: 'has when: branches, so one run may not show them all' });

            continue;
        }

        const supplied = input.suppliedBySubflows(flow);
        const gone = [...row].filter(
            (screen) =>
                screen !== PASS_THROUGH &&
                !supplied.has(screen) &&
                android.wider.has(screen) &&
                ios.wider.has(screen) &&
                !android.added.has(screen) &&
                !ios.added.has(screen),
        );

        if (gone.length === 0) {
            kept.push({ flow, reason: 'no screen of the row is unobserved on both platforms' });

            continue;
        }

        gone.forEach((screen) => table.get(flow)?.delete(screen));
        removed.push({ flow, screens: gone });
    }

    return { table, removed, owedAdditions, kept };
}

/**
 * Rewrites the registry text with the screens removed, leaving comments, order and every other row as they were.
 *
 * @param text - The registry file's text.
 * @param removed - Flow id to the screens to drop from its row.
 * @returns The new text.
 */
export function renderTable(text: string, removed: ReadonlyMap<string, readonly string[]>): string {
    return text
        .split('\n')
        .map((line) => {
            const [id = '', screens = ''] = line.split('\t');
            const drop = removed.get(id);

            return drop === undefined || line.startsWith('#')
                ? line
                : `${id}\t${names(screens)
                      .filter((screen) => !drop.includes(screen))
                      .join(', ')}`;
        })
        .join('\n');
}
