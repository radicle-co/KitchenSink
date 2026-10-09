/**
 * @module tokens/themeCss — the ONE authoritative composition of the Tailwind v4 `theme.css` artifact.
 *
 * `scripts/generateTheme.mjs` writes this string to `dist/theme.css`, which the web app imports as its only
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
 *
 * ## ⚠️ The prefix is a Tailwind NAMESPACE, not a free-form name — and there is deliberately NO `--spacing-*`
 *
 * Every prefix below must be one of Tailwind v4's theme namespaces. Naming them after the source variable is
 * what produced two shipped defects: `--font-size-*` / `--line-height-*` are not namespaces (v4 uses
 * `--text-*` / `--leading-*`), so the type ramp compiled to nothing; and `--spacing-*` IS one, so emitting the
 * DS ramp there silently REDEFINED every numeric utility — `size-8` became 64px where the mockups and the
 * native leaves both mean 32px, while `h-14`/`min-h-11` kept resolving through the default `--spacing` base,
 * leaving one stylesheet with two spacing systems.
 *
 * `scale.spacing` is therefore NOT emitted at all, on purpose. Its ramp — 0, 4, 8, 12, 16, 24, 32, 48, 64,
 * 96px — is a strict SUBSET of Tailwind's own 4px ramp (steps 0-4, 6, 8, 12, 16, 24), so emitting it can only
 * ever collide: it adds no value a plain `p-6` cannot already express. Web gets its spacing from Tailwind's
 * single `--spacing` base; `scale.spacing` remains the numeric source for NATIVE, which has no such base.
 *
 * Do not add a `--spacing-*` block back, and do not "fix" a size by defining the missing step. Any new token
 * family must be checked against Tailwind's namespace list first, and covered by the compiled-output test.
 */
import { palette, role, roleDark, semantic } from './colors.js';
import { coverTint, coverTintDark } from './covers.js';
import { proTone } from './tones.js';
import { kebab, pxToRemUnit } from './emit.js';
import { glass, glassEdgeDark, gradient, gradientCss, heroDark } from './gradients.js';
import { containerThreshold, contentWidth, viewportThreshold } from './layout.js';
import { radius } from './radius.js';
import { shadows } from './shadows.js';
import { fonts, fontSizes, fontWeights, lineHeights, webTypeRoles } from './typography.js';

/** A token map as emitted: keys become custom-property suffixes, values are written verbatim. */
type TokenMap = Readonly<Record<string, string | number>>;

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
 * The app-wide CANVAS gradient, as `--background-image-hero`.
 *
 * `gradient.hero` is the wireframes' own `--gradient-beach-glow` — the wash all nine screens paint on `body`.
 * It is emitted here for the same reason as the glass edge, and no other: the web canvas can only be painted
 * from STYLESHEET position. `<body>`'s background is not a React element's inline style, so `globals.css`
 * needs a custom property to reference; native takes the identical spec through `GradientSurface` /
 * `toNativeGradient`, so neither platform re-spells the ramp.
 *
 * **`--background-image-*` is Tailwind v4's namespace for `bg-*` image utilities — verified by compiling it,
 * not inferred from the variable's name.** That distinction is the whole lesson of this module's header: a
 * prefix that merely reads well (`--gradient-*`) is not a namespace, so it emits a `:root` property that
 * generates NO utility — the `--font-size-*` failure that left 324 type-ramp call sites with no CSS. Adding a
 * NAMED key to a live namespace is also categorically different from the `--spacing-*` hijack: it introduces
 * `bg-hero` and redefines nothing Tailwind ships.
 *
 * Only the canvas ramp is emitted. `brand` already reaches the web as the Button's `from-seafoam
 * to-ocean-dark` utilities and `scrim` as the recipe-detail cover's own, so emitting those would create a
 * second web representation of one piece of knowledge.
 */
function canvasGradientDeclarations(): readonly string[] {
    return [`    --background-image-hero: ${gradientCss(gradient.hero)};`];
}

/**
 * The type roles (§1.5) as `--text-{role}` plus the sub-properties Tailwind v4 folds into the `text-{role}` utility
 * (`--line-height`, `--font-weight`, `--letter-spacing`, each behind its `--tw-*` override, so an explicit `leading-*`
 * or `font-*` class still wins).
 *
 * Two roles share a name with the older ramp (`caption`, `overline`). For those the size is NOT declared again — the
 * ramp already declares it — and only the sub-properties are added. A role whose size disagrees with the ramp entry of
 * the same name throws, because two declarations of one custom property would let the later one win silently.
 *
 * @throws Error when a role and a ramp entry of the same name state different sizes.
 */
function typeRoleDeclarations(): readonly string[] {
    const ramp: Readonly<Record<string, string>> = fontSizes;

    return Object.entries(webTypeRoles).flatMap(([name, spec]) => {
        const declared = ramp[name];

        if (declared !== undefined && declared !== spec.size) {
            throw new Error(`Type role "${name}" is ${spec.size} but the ramp's --text-${name} is ${declared}.`);
        }

        return [
            ...(declared === undefined ? [`    --text-${name}: ${spec.size};`] : []),
            `    --text-${name}--line-height: ${spec.lineHeight};`,
            `    --text-${name}--font-weight: ${spec.fontWeight};`,
            ...(spec.letterSpacing === undefined ? [] : [`    --text-${name}--letter-spacing: ${spec.letterSpacing};`]),
        ];
    });
}

/**
 * The layout tokens (§1.2, §1.3; blueprint A8), all from `layout.ts`:
 *
 *  - `--breakpoint-medium` (600) and `--breakpoint-nav` (840): the viewport classes, as `medium:` and `nav:`. `medium`
 *    exists for the gutter step, because Tailwind's own `md` is 768 and the spec's gutter widens at 600.
 *  - `--container-regular` / `--container-wide`: the `@regular/main:` and `@wide/main:` thresholds (600, 960).
 *  - `--container-reading` / `-list` / `-detail` / `-page`: the content widths, as `max-w-*`. ⚠️ The widest is `page`,
 *    not `wide`: the namespace is shared with the container variants (see `layout.ts`).
 */
function layoutDeclarations(): readonly string[] {
    return [
        `    --breakpoint-medium: ${pxToRemUnit(viewportThreshold.medium)};`,
        `    --breakpoint-nav: ${pxToRemUnit(viewportThreshold.expanded)};`,
        ...Object.entries({ ...containerThreshold, ...contentWidth }).map(
            ([name, px]) => `    --container-${name}: ${pxToRemUnit(px)};`,
        ),
    ];
}

/**
 * The dark theme (`docs/design/uiOverhaul/darkTheme.md` §6): one `prefers-color-scheme: dark` override of the same
 * custom properties the `@theme` block declares — every role from `roleDark`, the cover tints, the glass edges and the
 * canvas wash — then `color-scheme: light dark` so form controls and scrollbars follow. Unlayered `:root` rules beat
 * Tailwind's `@layer theme` declarations, and every role utility reads `var(--color-*)`, so this block IS the theme
 * switch; no component carries a `dark:` variant. Pure.
 */
function darkThemeLines(): readonly string[] {
    return [
        '',
        '@media (prefers-color-scheme: dark) {',
        '    :root {',
        ...declarations('color', roleDark).map((line) => `    ${line}`),
        ...declarations('color-cover', coverTintDark).map((line) => `    ${line}`),
        ...Object.keys(glass).map((tier) => `        --color-glass-${tier}-edge: ${glassEdgeDark};`),
        `        --background-image-hero: ${gradientCss(heroDark)};`,
        '    }',
        '}',
        '',
        ':root {',
        '    color-scheme: light dark;',
        '}',
    ];
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
        // `--text-*` / `--leading-*` are Tailwind v4's namespaces for font size and line height. They were
        // once emitted as `--font-size-*` / `--line-height-*` — spellings that match the SOURCE VARIABLE's
        // name but no namespace at all — so `text-body-sm`, `text-display-md`, `leading-body` and friends
        // generated NO rule and every one of their 324 call sites silently inherited the parent's size. The
        // whole DS type ramp had never reached the browser. See `__integration__/tailwindTheme` in the web
        // app, which compiles this artifact and asserts what a utility resolves to.
        ...declarations('text', fontSizes),
        ...declarations('leading', lineHeights),
        ...declarations('font-weight', fontWeights),
        ...declarations('radius', radius, false),
        ...declarations('shadow', shadows, false),
        // Appended LAST so every pre-existing declaration keeps its exact position in the artifact.
        ...glassEdgeDeclarations(),
        ...canvasGradientDeclarations(),
        // The overhaul's roles and layout (§1.2-§1.5), appended after everything above for the same reason.
        ...declarations('color', role),
        ...typeRoleDeclarations(),
        ...layoutDeclarations(),
        ...declarations('color-cover', coverTint),
        ...declarations('color-pro', { fill: proTone.fill, ink: proTone.text }),
        '}',
        ...darkThemeLines(),
    ];

    return lines.join('\n') + '\n';
}
