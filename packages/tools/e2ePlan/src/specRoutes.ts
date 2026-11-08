import { routeLiterals, type RouteLiterals } from './routeLiterals.js';

/**
 * What each spec navigates to, counting the helpers it imports.
 *
 * Most specs sign in through a helper that visits `/` or `/sign-in`, and some open pages through others, so reading
 * the spec file alone would miss screens the test really passes through. The walk stays inside the test folder:
 * `route()` calls in application code are not visits.
 *
 * @param input - The test folder, its specs, what imports what, and how to read a file.
 * @returns Spec file to the paths it (and its helpers) navigate to.
 */
export function specRoutes(input: {
    readonly dir: string;
    readonly specs: readonly string[];
    /** Files that DEFINE the route helpers: their `route(path)` passes a parameter through and is not a visit. */
    readonly definitions: readonly string[];
    readonly importsOf: (file: string) => readonly string[];
    readonly read: (file: string) => string;
}): ReadonlyMap<string, RouteLiterals> {
    const result = new Map<string, RouteLiterals>();

    for (const spec of input.specs) {
        const seen = new Set<string>([spec]);
        const queue = [spec];
        const paths = new Set<string>();
        let dynamic = false;

        for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
            if (!input.definitions.includes(file)) {
                const found = routeLiterals(input.read(file), file);

                found.paths.forEach((path) => paths.add(path));
                dynamic ||= found.dynamic;
            }

            for (const next of input.importsOf(file)) {
                if (next.startsWith(`${input.dir}/`) && !seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }

        result.set(spec, { paths: [...paths], dynamic });
    }

    return result;
}
