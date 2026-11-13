/**
 * The globals the host page provides to browser code in this package, and the ones the artifact defines on it.
 * Declared once so the browser modules are type-checked against them instead of reaching through casts.
 */
import type { CardColumns, CardContext } from '../cards/cardSpec.js';

import type { BridgedReact, JsxRuntime, ReactLike } from './reactLike.js';

/** The slice of `react-dom/client` + `flushSync` the card runtime calls. */
interface ReactDomLike {
    flushSync(work: () => void): void;
    createRoot(container: Element): { render(node: unknown): void };
}

/** A compiled card as the runtime sees it (`var __card = { default: … }`). */
interface CompiledCard {
    readonly default: {
        render(ui: unknown, context: CardContext): unknown;
        renderNative?(ui: unknown, context: CardContext): unknown;
        afterRender?(columns: CardColumns): unknown;
    };
}

declare global {
    interface Window {
        React: ReactLike;
        ReactDOM: ReactDomLike;
        /** The web components; `Native` holds the native leaves. */
        Commise: { readonly Native: Readonly<Record<string, unknown>> };
        __react?: BridgedReact;
        __jsx?: JsxRuntime;
        /** Defined by `runtime/designSystemScopeEntry`; puts the native components inside the Tamagui provider. */
        __scopeDesignSystem?: (
            native: Readonly<Record<string, unknown>>,
            components: readonly string[],
        ) => Readonly<Record<string, unknown>>;
    }

    /** Defined by the compiled card, which the page inlines ahead of the runtime. */
    var __card: CompiledCard;
}

export {};
