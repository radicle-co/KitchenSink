/**
 * @module text/textScaleContext — the system text scale, carried to every design-system Text (ADR-0080 §8). Native only.
 * `DesignSystemProvider` reads the scale once; `DesignSystemTheme` provides it; Text reads it as its `textScale`
 * variant and draws its role through `scaledTypeMetrics`.
 *
 * @pattern Context — a Tamagui styled context, so the value reaches Text and every `styled(Text)` with no prop drilling
 */
import { createStyledContext } from 'tamagui';

export const TextScaleContext = createStyledContext({ textScale: 1 });
