/**
 * @module fixtures/StyledSurface — a Tamagui `styled(…)` export with NO JSX anywhere in the file. A styled element is
 * how the design system defines a component (ADR-0080), and it has no function body to find JSX in, so a JSX-only
 * reading of "what is a component" would leave the whole design system out of the catalogue.
 */
import { styled, View } from 'tamagui';

/**
 * A styled surface.
 *
 * @pattern Adapter over a Tamagui View
 */
export const StyledSurface = styled(View, { backgroundColor: '$paper' });

// No docblock: with no props and no description, the props library reports nothing for it.
export const BareSurface = styled(View, {});

/** A lowercase styled binding is not a component name. */
export const surfaceStyle = styled(View, { backgroundColor: '$paper' });
