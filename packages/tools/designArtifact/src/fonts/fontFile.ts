/**
 * @module fonts/fontFile — one font registration the artifact publishes.
 */

/** A font file and the CSS family and weight it is registered under. */
export interface FontFile {
    /** The CSS `font-family` it answers to: the family (`Inter`) or the native face name (`Inter_400Regular`). */
    readonly family: string;
    /** The CSS `font-weight` it is registered at. */
    readonly weight: number;
    /** The file's name in the published payload (`Inter_400Regular.ttf`). */
    readonly file: string;
    /** The absolute path of the `.ttf` on disk. */
    readonly source: string;
}

/** A font licence text the artifact ships beside the fonts. */
export interface FontLicence {
    /** The file's name in the published payload. */
    readonly file: string;
    /** The absolute path of the licence text on disk. */
    readonly source: string;
}
