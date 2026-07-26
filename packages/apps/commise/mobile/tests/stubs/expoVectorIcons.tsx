/**
 * @module tests/stubs/expoVectorIcons — jsdom stand-in for `@expo/vector-icons`, aliased in by
 * `vitest.native.config.ts`. The real module's internal EXTENSIONLESS ESM imports (`./createIconSet`) do not
 * resolve under Vitest's strict Node ESM, and its transitive `expo-modules-core` touches the RN-only global
 * `__DEV__` at import time — so loading it aborts every mobile `.native` screen test. Every family + factory
 * therefore resolves to one stand-in component, unblocking the suite for LOCAL runs (matching how
 * `features-recipes` stubs `expo-image`).
 *
 * The stand-in renders a MARKED, empty `View` rather than `null` (the `dataSet` marker convention the
 * gradient stub already uses): glyphs stay invisible and contribute nothing to any accessible name, but a
 * suite can assert that a control renders its intended glyph — which a `null` stub made impossible, and
 * which is how icon-less chrome passed its tests. Real glyph rendering stays a device/Maestro concern.
 */
import type { FC } from 'react';
import { View, type ViewProps } from 'react-native';

/** `dataSet` is a react-native-web runtime prop (→ DOM `data-*`) absent from react-native's `ViewProps`. */
const MarkedView = View as unknown as FC<ViewProps & { readonly dataSet?: Record<string, string | undefined> }>;

/** A stand-in icon: an empty marked View carrying the requested glyph name. */
const IconStub: FC<Record<string, unknown>> = ({ name }) => (
    <MarkedView dataSet={{ commiseStub: 'icon', iconName: typeof name === 'string' ? name : undefined }} />
);

/** Icon-set factories return the same stand-in component. */
const createIconSetStub = (): FC<Record<string, unknown>> => IconStub;

export const AntDesign = IconStub;
export const Entypo = IconStub;
export const EvilIcons = IconStub;
export const Feather = IconStub;
export const Fontisto = IconStub;
export const FontAwesome = IconStub;
export const FontAwesome5 = IconStub;
export const FontAwesome6 = IconStub;
export const Foundation = IconStub;
export const Ionicons = IconStub;
export const MaterialCommunityIcons = IconStub;
export const MaterialIcons = IconStub;
export const Octicons = IconStub;
export const SimpleLineIcons = IconStub;
export const Zocial = IconStub;
export const createIconSet = createIconSetStub;
export const createMultiStyleIconSet = createIconSetStub;
export const createIconSetFromFontello = createIconSetStub;
export const createIconSetFromIcoMoon = createIconSetStub;

export default { AntDesign, Ionicons, MaterialIcons, Feather, MaterialCommunityIcons };
