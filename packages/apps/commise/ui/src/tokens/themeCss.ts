/**
 * @module tokens/themeCss — the ONE authoritative composition of the Tailwind v4 `theme.css` artifact.
 *
 * `scripts/generate-theme.mjs` writes this string to `dist/theme.css`, which the web app imports as its only
 * stylesheet (`web/src/app/globals.css`). Tailwind reads the `@theme` block and derives every colour/spacing/
 * radius/shadow utility from it, so this function IS the web design system's entry point.
 *
 * ## Why the composition lives here and not in the generator script
 *
 * It used to live in the script, and the byte-identity test in `__tests__/webTokens.snapshot.test.ts`
 * RE-IMPLEMENTED it line for line in order to snapshot it. That is the same knowledge — "how a token map
 * becomes a custom property" — written twice, in two languages' worth of loops, kept in agreement only by
 * convention: the test could not fail when the generator drifted, because the test never ran the generator.
 * Extracting the pure composition gives both callers one source, so the snapshot now guards the real artifact.
 *
 * The module is pure and imports only other token modules (no `node:fs`, no platform API), which is what lets
 * the test import it directly while the script keeps sole responsibility for touching the filesystem.
 */
import { palette, semantic } from './colors.js';
import { glass } from './gradients.js';
import { radius } from './radius.js';
import { shadows } from './shadows.js';
import { space } from './spacing.js';
import { fonts, fontSizes, fontWeights, lineHeights } from './typography.js';

/** A token map as emitted: keys become custom-property suffixes, values are written verbatim. */
type TokenMap = Readonly<Record<string, string | number>>;

/** camelCase → kebab-case, so `seafoamLight`-style keys emit as `seafoam-light`. Pure. */
function kebab(key: string): string {
    return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** Emit one `--{prefix}-{key}: {value};` declaration per entry, preserving insertion order. Pure. */
function declarations(prefix: string, tokens: TokenMap, kebabKeys = true): readonly string[] {
    return Object.entries(tokens).map(([key, value]) => `    --${prefix}-${kebabKeys ? kebab(key) : key}: ${value};`);
}

/**
 * The translucent-white hairline of each frosted-glass tier, as `--color-glass-{tier}-edge`.
 *
 * This is the ONLY part of the glass language emitted as a custom property, and the asymmetry is deliberate.
 * The fill, blur and saturation already reach the web through `toWebGlass` as inline declarations, and emitting
 * them here as well would create a SECOND web representation of the same knowledge — exactly the duplication
 * this module exists to remove. The EDGE is different: it has to compose with a border-width utility and with
 * `hover:` variants, and an inline style out-specifies every class, so it can only work from class position.
 *
 * Native consumes the same `glass.{tier}.border` via `toNativeGlass(...).border`, so the two platforms' glass
 * rim now derives from one token instead of web re-spelling it as `border-white/30`.
 */
function glassEdgeDeclarations(): readonly string[] {
    return Object.entries(glass).map(([tier, spec]) => `    --color-glass-${tier}-edge: ${spec.border};`);
}

/**
 * Compose the full Tailwind v4 `theme.css` contents. Pure — the same tokens always yield the same string.
 *
 * @returns The stylesheet text, newline-terminated, ready to write to `dist/theme.css`.
 */
export function themeCss(): string {
    const lines: string[] = [
        '@import "tailwindcss";',
        '',
        '@theme {',
        ...declarations('color', palette),
        ...declarations('color', semantic),
        ...declarations('font', fonts),
        ...declarations('font-size', fontSizes),
        ...declarations('line-height', lineHeights),
        ...declarations('font-weight', fontWeights),
        // Numeric scale keys (`0`..`9`) are emitted verbatim — kebab-casing them would be a no-op that only
        // obscures the intent.
        ...declarations('spacing', space, false),
        ...declarations('radius', radius, false),
        ...declarations('shadow', shadows, false),
        // Appended LAST so every pre-existing declaration keeps its exact position in the artifact.
        ...glassEdgeDeclarations(),
        '}',
    ];

    return lines.join('\n') + '\n';
}
