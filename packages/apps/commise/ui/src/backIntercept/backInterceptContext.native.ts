/**
 * @module @commise/ui/back-intercept — the context the back-interceptor registry is published on.
 *
 * Its own module so the provider and the consumer hook each import the context rather than each other, which
 * is what keeps the dependency between them one-directional and acyclic.
 *
 * React's `createContext` already IS the Service Locator the seam needs — a lookup published by an ancestor
 * and resolved by a descendant — so nothing is added on top of it here. The default is `null` rather than a
 * no-op registry BY DESIGN: a consumer with no provider above it must fail loudly (see `useBackIntercept`),
 * because a silently absent back guard is indistinguishable from the data-loss defect the seam exists to fix.
 */
import { createContext } from 'react';

import type { BackInterceptRegistry } from './backInterceptRegistry.js';

/** The registry published by `BackInterceptProvider`; `null` when no provider is mounted above. */
export const BackInterceptContext = createContext<BackInterceptRegistry | null>(null);
