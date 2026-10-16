/**
 * The pure rule behind `appCopyIsNotDuplicated.test.ts`: which user-facing sentences do the web and mobile apps' own
 * copy dictionaries both author?
 *
 * One sentence, two authors, is how "Tabs" and "Main" came to name the same landmark: each app edits its own copy and the
 * other never learns. A sentence both apps say belongs in a feature package's `messages.ts`, authored once, read by both.
 *
 * The comparison is on the VALUE, whatever the keys: `home.surface.widgetError` on web and `home.widgetError` on mobile
 * were the same sentence under two paths, and a rule keyed on paths would have called them different.
 */

/** A dictionary tree: nested objects ending in strings. */
export interface CopyTree {
    readonly [key: string]: string | CopyTree;
}

/** A sentence that is legitimately authored in both apps, with the reason (a guard's escape hatch must be argued). */
export interface AllowedDuplicate {
    /** The exact (trimmed) value. */
    readonly value: string;
    /** Why this one is not duplicated knowledge. */
    readonly reason: string;
}

/** One sentence found in both dictionaries. */
export interface DuplicateCopy {
    /** The shared value, trimmed. */
    readonly value: string;
    /** The dotted paths that hold it in the web dictionary. */
    readonly web: readonly string[];
    /** The dotted paths that hold it in the mobile dictionary. */
    readonly mobile: readonly string[];
}

/**
 * Flatten a dictionary into `[dotted path, trimmed value]` pairs.
 *
 * @param tree - The dictionary (one locale's set).
 * @param prefix - The path so far.
 * @returns Every string leaf, in declaration order. Pure.
 */
export function copyEntriesOf(tree: CopyTree, prefix = ''): readonly (readonly [string, string])[] {
    return Object.entries(tree).flatMap(([key, value]): readonly (readonly [string, string])[] => {
        const path = prefix === '' ? key : `${prefix}.${key}`;

        return typeof value === 'string' ? [[path, value.trim()]] : copyEntriesOf(value, path);
    });
}

/**
 * The sentences both apps' dictionaries author.
 *
 * @param web - The web dictionary (one locale).
 * @param mobile - The mobile dictionary (one locale).
 * @param allowed - Values that may appear in both, each with its reason.
 * @returns One entry per shared value, in the web dictionary's order. Empty strings are never a sentence. Pure.
 */
export function duplicateCopyOf(
    web: CopyTree,
    mobile: CopyTree,
    allowed: readonly AllowedDuplicate[] = [],
): readonly DuplicateCopy[] {
    const exempt = new Set(allowed.map((entry) => entry.value));
    const group = (tree: CopyTree): Map<string, string[]> => {
        const byValue = new Map<string, string[]>();

        for (const [path, value] of copyEntriesOf(tree)) {
            if (value !== '' && !exempt.has(value)) {
                byValue.set(value, [...(byValue.get(value) ?? []), path]);
            }
        }

        return byValue;
    };
    const mobileByValue = group(mobile);

    return [...group(web)].flatMap(([value, webPaths]) => {
        const mobilePaths = mobileByValue.get(value);

        return mobilePaths === undefined ? [] : [{ value, web: webPaths, mobile: mobilePaths }];
    });
}
