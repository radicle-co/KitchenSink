/**
 * The theme and radius token names the design system gives Tamagui, READ from the design system's own modules, so a
 * theme key or a radius step added tomorrow is accepted tomorrow and nothing here is a list to keep in step (ADR-0080).
 *
 * The theme keys are the keys of the registered `tamaguiThemes.light`, and the radius names the keys of
 * `tamaguiTokens.radius`. The modules (`theme/tamaguiThemes.ts`, `tamagui/tamaguiTokens.ts`, and the colour and surface
 * tone modules the first imports) are loaded by file URL, not imported: a guard may not import across a workspace
 * boundary, and they are pure TypeScript (they import no Tamagui and no React Native), so a test run can load them as
 * they are.
 * The load happens once, at the top of this module, and THROWS on a shape it cannot read, because a guard that read an
 * empty set would refuse every token (or, worse, in another guard, accept anything).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './serviceSources.js';

const UI_SRC = path.join(repoRoot, 'packages/apps/commise/ui/src');

async function load(file: string): Promise<Readonly<Record<string, unknown>>> {
    const loaded: unknown = await import(pathToFileURL(path.join(UI_SRC, file)).href);

    if (typeof loaded !== 'object' || loaded === null) {
        throw new Error(`${file} did not load as a module`);
    }

    return loaded as Readonly<Record<string, unknown>>;
}

function keysOf(value: unknown, what: string): readonly string[] {
    if (typeof value !== 'object' || value === null || Object.keys(value).length === 0) {
        throw new Error(`${what} is not a non-empty object`);
    }

    return Object.keys(value);
}

const themes = await load('theme/tamaguiThemes.ts');
const tokens = await load('tamagui/tamaguiTokens.ts');

/** The theme keys: the keys of the light theme, which are every colour role and every surface tone's derived colours. */
export const themeColourKeys: ReadonlySet<string> = new Set(
    keysOf(
        (themes['tamaguiThemes'] as Readonly<Record<string, unknown>> | undefined)?.['light'],
        'tamaguiThemes.light',
    ),
);

/** The radius token names: the keys of `tamaguiTokens.radius`. */
export const radiusTokenKeys: ReadonlySet<string> = new Set(
    keysOf(
        (tokens['tamaguiTokens'] as Readonly<Record<string, unknown>> | undefined)?.['radius'],
        'tamaguiTokens.radius',
    ),
);
