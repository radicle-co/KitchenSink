/**
 * @module tokens/buildTokens — the Design System artifact's tokens, read from `@commise/ui` itself.
 *
 * Pure. Every value is an import from the design-system package (the colour roles in both themes, the palette, the
 * cover tints, the scales and the type roles); nothing is scraped from CSS and nothing is typed in twice. Only the
 * notes about what a token is for are written here (`tokenUsage.ts`).
 *
 * @pattern Adapter — projects the `@commise/ui` token modules onto the artifact's `tokens.json` grammar
 */
import { palette, role, roleDark } from '@commise/ui/colors';
import { fontFamily, fontWeight, radius, spacing } from '@commise/ui/scale';
import { barMaterial } from '@commise/ui/tokens/barMaterial';
import { coverTint, coverTintDark } from '@commise/ui/tokens/covers';
import { kebab } from '@commise/ui/tokens/emit';
import { shadows } from '@commise/ui/tokens/shadows';
import { proTone } from '@commise/ui/tokens/tones';
import { typeRole, type TypeRole, type TypeRoleSpec } from '@commise/ui/tokens/typography';

import { fontFaces } from '../fonts/fontFaces.js';

import type {
    ArtifactColorToken,
    ArtifactFont,
    ArtifactFontFace,
    ArtifactScaleToken,
    ArtifactTokens,
    ArtifactTypeGroup,
    ArtifactTypeStyle,
} from './artifactTokens.js';
import {
    BRAND_USAGE,
    EXTRA_COLOR_USAGE,
    RADIUS_USAGE,
    ROLE_USAGE,
    SHADOW_USAGE,
    SPACING_USAGE,
    TYPE_GROUP_ORDER,
    TYPE_ROLE_DOC,
    type BrandTone,
    type ScaleUsage,
} from './tokenUsage.js';

/** `Object.entries` with the keys kept as the record's own key type (TypeScript widens them to `string`). */
function entriesOf<K extends string, V>(record: Readonly<Record<K, V>>): readonly (readonly [K, V])[] {
    return Object.entries(record) as unknown as (readonly [K, V])[];
}

function colourTokens(): readonly ArtifactColorToken[] {
    const roles = entriesOf(role).map(([key, light]): ArtifactColorToken => ({
        name: kebab(key),
        value: { light, dark: roleDark[key] },
        usage: ROLE_USAGE[key],
    }));
    const extras: readonly ArtifactColorToken[] = [
        { name: 'bar', value: { light: barMaterial.light, dark: barMaterial.dark }, usage: EXTRA_COLOR_USAGE.bar },
        {
            name: 'pro-fill',
            value: { light: proTone.fill, dark: proTone.fill },
            usage: EXTRA_COLOR_USAGE.proFill,
        },
        {
            name: 'pro-ink',
            value: { light: proTone.text, dark: proTone.text },
            usage: EXTRA_COLOR_USAGE.proInk,
        },
    ];
    const brand = entriesOf(BRAND_USAGE).map(([tone, usage]: readonly [BrandTone, string]): ArtifactColorToken => ({
        name: `brand-${tone}`,
        value: palette[tone],
        usage,
    }));
    const covers = entriesOf(coverTint).map(([tone, light]): ArtifactColorToken => ({
        name: `cover-${tone}`,
        value: { light, dark: coverTintDark[tone] },
        usage: EXTRA_COLOR_USAGE.cover,
    }));

    return [...roles, ...extras, ...brand, ...covers];
}

/** A type role's size in px: its own, or its widest container class. */
function sizeOf(size: number | { readonly wide: number }): number {
    return typeof size === 'number' ? size : size.wide;
}

function typeStyle(name: TypeRole): { readonly style: ArtifactTypeStyle; readonly face: ArtifactFontFace } | undefined {
    const spec: TypeRoleSpec = typeRole[name];

    if (spec.size === 'inherit' || spec.lineHeight === 'inherit') {
        return undefined;
    }

    return {
        face: spec.face,
        style: {
            name: kebab(name),
            fontSize: `${sizeOf(spec.size)}px`,
            lineHeight: `${spec.lineHeight}`,
            fontWeight: fontWeight[spec.weight],
            usage: TYPE_ROLE_DOC[name].usage,
        },
    };
}

/**
 * @throws Error when the styles of one group are set in different faces.
 */
function typeGroups(): readonly ArtifactTypeGroup[] {
    const names = Object.keys(typeRole) as TypeRole[];

    return TYPE_GROUP_ORDER.flatMap((groupName) => {
        const members = names
            .filter((name) => TYPE_ROLE_DOC[name].group === groupName)
            .flatMap((name) => typeStyle(name) ?? []);
        const faces = new Set(members.map((member) => member.face));
        const [family] = [...faces];

        if (family === undefined) {
            return [];
        }

        if (faces.size > 1) {
            throw new Error(`Type group "${groupName}" mixes faces: ${[...faces].join(', ')}.`);
        }

        return [{ name: groupName, family, styles: members.map((member) => member.style) }];
    });
}

function fonts(): readonly ArtifactFont[] {
    return fontFaces().map((face) => ({
        family: face.family,
        file: `fonts/${face.fileName}`,
        weight: String(face.weight),
        style: 'normal',
    }));
}

function scaleTokens<Step extends string>(
    prefix: string,
    values: Readonly<Record<Step, string>>,
    usage: ScaleUsage<string>,
): readonly ArtifactScaleToken[] {
    return entriesOf(values).map(([step, value]) => ({
        name: `${prefix}-${step}`,
        value,
        usage: usage.byStep[step] ?? usage.fallback,
    }));
}

/** A scale of pixel numbers as CSS pixel lengths. */
function px<Step extends string>(scale: Readonly<Record<Step, number>>): Readonly<Record<Step, string>> {
    return Object.fromEntries(entriesOf(scale).map(([step, value]) => [step, `${value}px`])) as Record<Step, string>;
}

/**
 * The tokens of the Commise Design System, for the artifact.
 *
 * @returns The colour roles and tones in both themes, the type ramp, and the spacing, radius and shadow scales.
 */
export function buildTokens(): ArtifactTokens {
    return {
        name: 'Commise',
        version: 1,
        color: {
            themes: [
                { id: 'light', name: 'Light' },
                { id: 'dark', name: 'Dark' },
            ],
            note: 'Roles name what a colour is FOR. Screens use roles, never brand tones. Dark values follow the system colour scheme.',
            tokens: colourTokens(),
        },
        type: { fonts: fonts(), families: fontFamily, groups: typeGroups() },
        spacing: {
            note: '4px base. Web emits rem, native uses the number.',
            tokens: scaleTokens('space', px(spacing), SPACING_USAGE),
        },
        radius: { tokens: scaleTokens('radius', px(radius), RADIUS_USAGE) },
        shadow: { tokens: scaleTokens('shadow', shadows, SHADOW_USAGE) },
    };
}
