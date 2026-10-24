/**
 * @module @commise/ui/sync-notice — the web notice stack: nothing.
 *
 * On web the notices flow at the top of `<main>`, below the sticky bar, so there is no inset to take and no wrapper to
 * add; a wrapper would only be one more element between the landmark and its regions. The native twin
 * (`SyncNoticeStack.native.tsx`) owns the top safe-area inset while a notice shows.
 *
 * A presentational leaf: it renders its children and nothing else.
 *
 * @pattern Adapter — the same contract as the native column, satisfied here by the document's own flow
 */
import type { FC } from 'react';

import type { SyncNoticeStackProps } from './props.js';

/** The notices, in flow. */
export const SyncNoticeStack: FC<SyncNoticeStackProps> = ({ children }) => <>{children}</>;
