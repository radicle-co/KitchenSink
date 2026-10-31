/**
 * @module fixtures/ForeignStyled — a component-named export whose initialiser calls a `styled` that is NOT Tamagui's.
 * Only Tamagui's `styled(…)` is a component definition, so this file names no component.
 */

/** A local function that happens to be called `styled`. */
function styled(base: string, config: Readonly<Record<string, string>>): string {
    return `${base}:${Object.keys(config).join()}`;
}

export const ForeignBox = styled('box', { color: 'red' });
