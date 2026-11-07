/**
 * The name-level step of the backwards walk.
 *
 * At a plain import the walk stays file-level: the importer is affected completely. Only at a RE-EXPORT edge is a
 * name followed, because `export { a } from './x'` creates no local binding: a barrel that passes `a` on does not
 * change when `b` of the same source changes. Every doubt widens to the whole file, so this can only narrow what
 * a file-level walk would already select where the syntax PROVES the narrowing.
 *
 * For an importer I of a file X whose changed names are C:
 *
 * 1. C effectful: I is effectful (loading I loads X, and X's own code changed).
 * 2. I cannot be parsed, or its parse lacks a specifier the import graph found from I to X: I is `all`.
 * 3. I uses a name in C (a namespace, side-effect, dynamic or `require` use counts as every name): I is `all`, and
 *    effectful too when I runs code of its own at load, because that code may now behave differently.
 * 4. I has `export *` from X: I is `all`.
 * 5. Otherwise I gets the names it re-exports from C, and with none there is no edge.
 *
 * @pattern Strategy — a `Step` for `reach`, chosen per tier; `fileLevel` is the other one
 */
import type { ModuleBindings, Names, SpecifierBinding } from './moduleBindings.js';
import { joinChanged, type Changed, type Step } from './reachability.js';

export interface SymbolGraph {
    readonly importersOf: (file: string) => readonly string[];
    /** The raw specifier of each import of a file to the file it resolved to, on THIS tier's platform. */
    readonly specifiersOf: (file: string) => ReadonlyMap<string, string>;
    /** The parse of a file, or undefined when it cannot be read or parsed. */
    readonly bindingsOf: (file: string) => ModuleBindings | undefined;
}

/**
 * What changed in the file the walk starts from: all of it, and its load-time code too when it has any.
 *
 * @param bindings - Its parse, or undefined when it has none.
 * @returns The start of the walk.
 */
export const initialChange = (bindings: ModuleBindings | undefined): Changed =>
    bindings?.topLevelEffects === true ? 'effectful' : 'all';

const meets = (uses: Names, changed: ReadonlySet<string> | 'all'): boolean =>
    uses === 'all' || changed === 'all' || [...uses].some((name) => changed.has(name));

/** What one specifier of an importer makes of the importer, given what changed in the source. */
function viaSpecifier(
    binding: SpecifierBinding,
    changed: ReadonlySet<string> | 'all',
    effects: boolean,
): Changed | undefined {
    let result: Changed | undefined;

    if (binding.uses !== undefined && meets(binding.uses, changed)) {
        result = effects ? 'effectful' : 'all';
    }

    const passed = binding.reexports;

    if (passed === 'all') {
        result = result === undefined ? 'all' : joinChanged(result, 'all');
    } else if (passed !== undefined) {
        const names = new Set<string>();

        for (const [from, as] of passed) {
            if (changed === 'all' || changed.has(from)) {
                as.forEach((name) => names.add(name));
            }
        }

        if (names.size > 0) {
            result = result === undefined ? names : joinChanged(result, names);
        }
    }

    return result;
}

/**
 * Builds the step.
 *
 * @param graph - One tier's import graph and the parse of its files.
 * @returns The step for `reach`.
 */
export function symbolStep(graph: SymbolGraph): Step {
    return (source, changed) => {
        const next = new Map<string, Changed>();

        for (const importer of graph.importersOf(source)) {
            if (changed === 'effectful') {
                next.set(importer, 'effectful');

                continue;
            }

            const bindings = graph.bindingsOf(importer);
            const raws = [...graph.specifiersOf(importer)]
                .filter(([, resolved]) => resolved === source)
                .map(([raw]) => raw);
            const found = raws.flatMap((raw) => bindings?.bySpecifier.get(raw) ?? []);

            if (bindings === undefined || raws.length === 0 || found.length < raws.length) {
                next.set(importer, 'all');

                continue;
            }

            let result: Changed | undefined;

            for (const binding of found) {
                const part = viaSpecifier(binding, changed, bindings.topLevelEffects);

                if (part !== undefined) {
                    result = result === undefined ? part : joinChanged(result, part);
                }
            }

            if (result !== undefined) {
                next.set(importer, result);
            }
        }

        return next;
    };
}
