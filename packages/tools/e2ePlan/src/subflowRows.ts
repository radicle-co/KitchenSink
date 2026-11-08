/**
 * The guard for a helper flow that has a row and branches.
 *
 * A sub-flow with its own row is opaque to the branching check (`branchingFlows`): the row answers for every screen its
 * `when:`, `while:` and `optional:` branches can reach, and it is added to every flow that runs the helper. That holds
 * only while the row is complete, so it is checked. A static read cannot see which screen a tap lands on, so it checks
 * what a read CAN see: a screen the helper's own text names (a module path under `screens/`, or a `...Screen` name in
 * its comments), and a screen the rowed helpers it runs reach. The runtime half is the recorder: a flow that shows a
 * screen its combined row lacks fails the run.
 */

/** One rowed helper, with what the static read needs about it. */
export interface SubflowEntry {
    readonly id: string;
    readonly row: ReadonlySet<string>;
    /** The helper's YAML, comments included. */
    readonly text: string;
    /** The rows of the rowed helpers it runs, however deep. */
    readonly childRows: readonly ReadonlySet<string>[];
}

export interface SubflowViolation {
    readonly id: string;
    /** Screens its row lacks, sorted. */
    readonly missing: readonly string[];
    readonly because: 'its text names them' | 'a helper it runs reaches them';
}

/**
 * The registry screens a helper's text names.
 *
 * @param text - The helper's YAML.
 * @param screens - The registry's screens.
 * @returns The screens named by a `screens/<name>` path or by their own name when it ends in `Screen`.
 */
export function namedScreens(text: string, screens: readonly string[]): ReadonlySet<string> {
    const paths = [...text.matchAll(/screens\/([A-Za-z]+)(?:\.native)?(?:\.tsx?)?/gu)].map((match) => match[1] ?? '');
    const names = [...text.matchAll(/\b([A-Z][A-Za-z]*Screen)\b/gu)].map((match) => match[1] ?? '');

    return new Set([...paths, ...names].filter((name) => screens.includes(name)));
}

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => a.localeCompare(b));

/**
 * Finds the rowed helpers whose rows are incomplete as far as a static read can tell.
 *
 * @param entries - The rowed helpers that branch.
 * @param screens - The registry's screens.
 * @returns One violation per helper and cause.
 */
export function subflowRowViolations(
    entries: readonly SubflowEntry[],
    screens: readonly string[],
): readonly SubflowViolation[] {
    return entries.flatMap((entry) => {
        const named = sorted([...namedScreens(entry.text, screens)].filter((screen) => !entry.row.has(screen)));
        const reached = sorted(
            new Set(entry.childRows.flatMap((row) => [...row]).filter((screen) => !entry.row.has(screen))),
        );

        return [
            ...(named.length > 0 ? [{ id: entry.id, missing: named, because: 'its text names them' as const }] : []),
            ...(reached.length > 0
                ? [{ id: entry.id, missing: reached, because: 'a helper it runs reaches them' as const }]
                : []),
        ];
    });
}
