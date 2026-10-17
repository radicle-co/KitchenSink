/**
 * @module tokens/artifactTokens — the shape of the design tokens the Design System artifact publishes
 * (`tokens.json`), and the grammar the artifact viewer reads.
 */

/** A theme the colours are stated in. */
export interface ArtifactTheme {
    readonly id: 'light' | 'dark';
    readonly name: string;
}

/** A colour's value in each theme. */
export interface ArtifactThemedColour {
    readonly light: string;
    readonly dark: string;
}

/** One colour token: a themed pair, or a single value that does not change with the theme. */
export interface ArtifactColorToken {
    readonly name: string;
    readonly value: ArtifactThemedColour | string;
    readonly usage: string;
}

/** A font file the stylesheet registers. */
export interface ArtifactFont {
    readonly family: string;
    /** The file's path inside the published project, relative to the stylesheet. */
    readonly file: string;
    /** The CSS weight, as a string. */
    readonly weight: string;
    readonly style: 'normal';
}

/** The face a type style is set in. */
export type ArtifactFontFace = 'display' | 'body' | 'mono';

/** One style of the type ramp. */
export interface ArtifactTypeStyle {
    readonly name: string;
    readonly fontSize: string;
    readonly lineHeight: string;
    readonly fontWeight: number;
    readonly usage: string;
}

/** A named group of type styles sharing one face. */
export interface ArtifactTypeGroup {
    readonly name: string;
    readonly family: ArtifactFontFace;
    readonly styles: readonly ArtifactTypeStyle[];
}

/** One step of a spacing, radius or shadow scale. */
export interface ArtifactScaleToken {
    readonly name: string;
    readonly value: string;
    readonly usage: string;
}

/** The design tokens of the system. */
export interface ArtifactTokens {
    readonly name: string;
    readonly version: number;
    readonly color: {
        readonly themes: readonly ArtifactTheme[];
        readonly note: string;
        readonly tokens: readonly ArtifactColorToken[];
    };
    readonly type: {
        readonly fonts: readonly ArtifactFont[];
        readonly families: Readonly<Record<ArtifactFontFace, string>>;
        readonly groups: readonly ArtifactTypeGroup[];
    };
    readonly spacing: { readonly note: string; readonly tokens: readonly ArtifactScaleToken[] };
    readonly radius: { readonly tokens: readonly ArtifactScaleToken[] };
    readonly shadow: { readonly tokens: readonly ArtifactScaleToken[] };
}
