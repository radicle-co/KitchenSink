/**
 * @module @commise/ui/large-title-header — the native {@link HeaderEyebrowBack}: nothing. Native has no eyebrow, and Back
 * is the pinned `CondensedTitleBar`'s in every state (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §4), so a second
 * control here would be a duplicate with the same accessible name. It exists so the package export resolves on both
 * platforms, as `LargeTitleHeader.native` keeps its `back` prop and draws no Back.
 *
 * Presentational: props → null.
 *
 * @pattern Null Object — draws nothing where the pinned bar owns Back
 */
import type { FC } from 'react';

import type { HeaderEyebrowBackProps } from './HeaderEyebrowBack.js';

/** The native eyebrow Back: it draws nothing. */
export const HeaderEyebrowBack: FC<HeaderEyebrowBackProps> = () => null;
