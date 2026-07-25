/**
 * @module @commise/features-core — the `appShell` DI-token surface.
 *
 * `appShell` is the frontend ditox container that is available everywhere (on the
 * server it is the module-singleton core `ditox` container; on the client it is a
 * `CustomDependencyContainer` exposed through `@ditox/react` hooks). It holds
 * ambient singletons (logger, clock, analytics, config, feature flags, …) plus
 * per-feature contributions. This module declares the **tokens** — the typed
 * seams both apps and every `@commise/features-*` package bind to and resolve
 * from — so no consumer hand-writes an untyped `token<T>()`. The Home-widget
 * contribution (`homeWidgetToken`) is the seam this feature slice owns; the
 * ambient tokens document the wider appShell contract the apps populate.
 *
 * The token generics are the anti-drift keystone: a feature contributes a
 * {@link HomeWidgetDescriptor} through {@link registerHomeWidget}, and the Home
 * composition root resolves the full list through {@link resolveHomeWidgets} —
 * both against the same typed token, so a shape mismatch is a build error.
 */

import type { Container, ContainerResolver, Token } from 'ditox';
import { bindMultiValue, token } from 'ditox';

import type { HomeWidgetDescriptor } from './contract.js';

/**
 * ISO 8601 date-time string with timezone offset (for example,
 * `2026-04-18T12:34:56.000Z`). Dates cross the appShell as strings, never
 * `Date` objects.
 */
export type IsoDateTimeString = string;

/**
 * Ambient structured logger. Impl supplied per platform (web console/Sentry,
 * mobile console/Sentry); features depend on {@link loggerToken}, never a
 * concrete logger.
 */
export interface AppShellLogger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
}

/**
 * Ambient clock. Injected (not `Date.now()` directly) so time-dependent logic
 * stays testable and pure at its call sites.
 */
export interface AppShellClock {
    now(): IsoDateTimeString;
}

/**
 * Ambient analytics sink for product instrumentation.
 */
export interface AppShellAnalytics {
    track(event: string, properties?: Record<string, unknown>): void;
}

/**
 * Ambient feature-flag reader. Distinct from Home widget **capability** gating:
 * flags toggle behavior, capabilities gate whether a backing service is live.
 */
export interface AppShellFeatureFlags {
    isEnabled(flag: string): boolean;
}

/**
 * Ambient runtime configuration reader (public config only; never secrets).
 */
export interface AppShellConfig {
    get(key: string): string | undefined;
}

/**
 * Injected error-reporting seam (DA9). A widget boundary — or any other observability call site — reports a
 * caught failure through this function, never by importing a platform SDK (`@sentry/nextjs`,
 * `@sentry/react-native`, …) directly. That keeps the call site fake-able in tests and lets each platform bind
 * its own real sink (both currently Sentry, but the seam does not assume that) without the consumer knowing.
 *
 * @param error - The caught value (React's `ErrorBoundary.onError` hands this as `unknown`).
 * @param context - Optional structured context (e.g. `{ widget: descriptor.id }`) attached to the report.
 */
export type ErrorReporter = (error: unknown, context?: Record<string, unknown>) => void;

/** Token for the ambient {@link AppShellLogger}. */
export const loggerToken: Token<AppShellLogger> = token<AppShellLogger>('commise.appShell.logger');

/** Token for the ambient {@link ErrorReporter}. */
export const errorReporterToken: Token<ErrorReporter> = token<ErrorReporter>('commise.appShell.errorReporter');

/** Token for the ambient {@link AppShellClock}. */
export const clockToken: Token<AppShellClock> = token<AppShellClock>('commise.appShell.clock');

/** Token for the ambient {@link AppShellAnalytics}. */
export const analyticsToken: Token<AppShellAnalytics> = token<AppShellAnalytics>('commise.appShell.analytics');

/** Token for the ambient {@link AppShellFeatureFlags}. */
export const featureFlagsToken: Token<AppShellFeatureFlags> = token<AppShellFeatureFlags>(
    'commise.appShell.featureFlags',
);

/** Token for the ambient {@link AppShellConfig}. */
export const configToken: Token<AppShellConfig> = token<AppShellConfig>('commise.appShell.config');

/**
 * Multi-value token every feature contributes its Home {@link HomeWidgetDescriptor}
 * to (via {@link registerHomeWidget}). Resolving it yields the full registered
 * set, which the Home composition root feeds to `curateHomeWidgets`. Bound with
 * `bindMultiValue`, so the token's value type is a read-only array.
 */
export const homeWidgetToken: Token<readonly HomeWidgetDescriptor[]> =
    token<readonly HomeWidgetDescriptor[]>('commise.appShell.homeWidgets');

/**
 * Explicit startup-registration function a feature exposes so the composition
 * root can `.use(addFeature)` it — the discovery layer. It binds the feature's
 * contributions (widgets, routes, …) into the appShell container.
 */
export type AddFeature = (container: Container) => void;

/**
 * Contribute a feature's Home widget descriptor to the appShell container.
 *
 * @sideEffect Mutates `container` by appending `descriptor` to the multi-value
 * {@link homeWidgetToken} binding.
 */
export const registerHomeWidget = (container: Container, descriptor: HomeWidgetDescriptor): void => {
    bindMultiValue(container, homeWidgetToken, descriptor);
};

/**
 * Resolve every registered Home widget descriptor from a container/resolver,
 * tolerating an appShell where no feature has contributed a widget yet (returns
 * an empty array instead of throwing `ResolverError`).
 */
export const resolveHomeWidgets = (resolver: ContainerResolver): readonly HomeWidgetDescriptor[] => {
    if (!resolver.hasToken(homeWidgetToken)) {
        return [];
    }

    return resolver.resolve(homeWidgetToken);
};

/** The {@link ErrorReporter} used by {@link resolveErrorReporter} when no platform has bound one. */
const NOOP_ERROR_REPORTER: ErrorReporter = () => undefined;

/**
 * Resolve the ambient {@link ErrorReporter} from a container/resolver, tolerating an appShell where no
 * platform has bound a reporter yet (falls back to a no-op instead of throwing `ResolverError`) — mirrors
 * {@link resolveHomeWidgets}'s tolerant-resolve shape.
 */
export const resolveErrorReporter = (resolver: ContainerResolver): ErrorReporter =>
    resolver.get(errorReporterToken) ?? NOOP_ERROR_REPORTER;
