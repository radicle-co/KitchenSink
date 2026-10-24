/**
 * @module readme/stampReadme — records, in the published README, which commit the artifact was built from.
 *
 * Pure: the commit is a parameter, so the same commit always yields the same text and a rebuild of an unchanged tree
 * produces a byte-identical README.
 */

/** The commit the artifact is built from. */
export interface BuildStamp {
    /** The full commit id. */
    readonly sha: string;
    /** The commit's date as an ISO-8601 string. */
    readonly date: string;
    /** Whether the working tree differed from that commit when the build ran. */
    readonly dirty: boolean;
}

/** How many characters of the commit id are written. */
const SHORT_SHA_LENGTH = 12;

/**
 * Appends the build line.
 *
 * @param readme - The authored README text.
 * @param stamp - The commit it was built from, and whether the tree had changes on top of it.
 * @returns The README followed by one `Built from commit …` line, ending `plus uncommitted changes` for a dirty tree.
 */
export function stampReadme(readme: string, { sha, date, dirty }: BuildStamp): string {
    const uncommitted = dirty ? ' plus uncommitted changes' : '';

    return `${readme.trimEnd()}\n\nBuilt from commit ${sha.slice(0, SHORT_SHA_LENGTH)} (${date})${uncommitted}.\n`;
}
