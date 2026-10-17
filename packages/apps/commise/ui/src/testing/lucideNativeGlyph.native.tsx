/**
 * @module @commise/ui/testing/lucide-native — the stand-in glyph component the `lucideNativeStub` plugin serves for
 * each `lucide-react-native/icons/<glyph>` import under the jsdom native suites.
 *
 * It renders an empty `View` that publishes the glyph's Lucide name and the props it was drawn with as DOM `data-*`
 * attributes (`data-icon-name`, `data-icon-color`, `data-icon-size`, `data-icon-fill`). The attribute names match the
 * older `@expo/vector-icons` stand-in, so an assertion on a control's glyph reads the same way it always has.
 *
 * {@link LucideGlyphStub} is presentational: props → an empty marked view, with no state.
 *
 * @pattern Stub — a test double presenting each `lucide-react-native/icons/<glyph>` module's default export
 */
import type { FC } from 'react';
import { View, type ViewProps } from 'react-native';

/** `dataSet` is a react-native-web runtime prop (→ DOM `data-*`) absent from react-native's `ViewProps`. */
const MarkedView = View as unknown as FC<ViewProps & { readonly dataSet?: Record<string, string | undefined> }>;

/** The props a Lucide native glyph is drawn with, as far as the stand-in reports them. */
interface GlyphStubProps {
    readonly color?: string;
    readonly size?: number;
    readonly fill?: string;
}

/** The marked, empty view for one glyph: the {@link glyphStub} each virtual glyph module default-exports. */
export const LucideGlyphStub: FC<GlyphStubProps & { readonly glyph: string }> = ({ glyph, color, size, fill }) => (
    <MarkedView
        dataSet={{
            commiseStub: 'icon',
            iconName: glyph,
            iconColor: color,
            iconSize: size === undefined ? undefined : String(size),
            iconFill: fill,
        }}
    />
);

/**
 * Build the stand-in for one glyph.
 *
 * @param glyph - The Lucide file name, e.g. `house`.
 * @returns A component that renders {@link LucideGlyphStub} for that glyph.
 */
export function glyphStub(glyph: string): FC<GlyphStubProps> {
    const Stub: FC<GlyphStubProps> = (props) => <LucideGlyphStub glyph={glyph} {...props} />;
    Stub.displayName = `LucideStub(${glyph})`;

    return Stub;
}
