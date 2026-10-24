/**
 * @module cards/browser/mountCard — renders the card into its columns and reports when the page is ready. Runs on
 * the card page.
 */
import type { CardRuntimeConfig } from '../cardRuntimeConfig.js';
import type { CardColumns } from '../cardSpec.js';

type Platform = 'web' | 'native';

function requireElement(doc: Document, id: string): HTMLElement {
    const element = doc.getElementById(id);

    if (element === null) {
        throw new Error(`The card page has no #${id} element.`);
    }

    return element;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

/**
 * Mounts one React root per shown column with that column's namespace, hands the columns to the card's
 * `afterRender`, and flags `<html data-card-ready="true">` once it has settled. A rejected `afterRender` sets
 * `data-card-error` instead and logs it: a failure is shown, never swallowed.
 *
 * @sideEffect Renders into the page, sets attributes on `<html>`, logs a failed `afterRender`.
 * @param config - Which columns exist.
 * @param win - The card page's window (`Commise`, `ReactDOM` and `__card` are on it or global).
 */
export function mountCard(config: CardRuntimeConfig, win: Window): void {
    const card = __card.default;
    const doc = win.document;

    const mount = (platform: Platform, id: string, ui: unknown, stack: 'row' | 'col'): HTMLElement => {
        const element = requireElement(doc, id);
        const root = win.ReactDOM.createRoot(element);
        const render = platform === 'native' && card.renderNative ? card.renderNative : card.render;

        // Committed synchronously, so the readiness flag below means "painted", not "scheduled".
        win.ReactDOM.flushSync(() => {
            root.render(render.call(card, ui, { platform, stack }));
        });

        return element;
    };

    const web = config.platforms === 'native' ? null : mount('web', 'w', win.Commise, 'row');
    const native = config.platforms === 'web' ? null : mount('native', 'n', win.Commise.Native, 'col');
    const webStage = doc.getElementById('wf');
    const nativeStage = doc.getElementById('nf');
    const columns: CardColumns = {
        ...(web === null ? {} : { web }),
        ...(native === null ? {} : { native }),
        ...(webStage === null ? {} : { webStage }),
        ...(nativeStage === null ? {} : { nativeStage }),
    };

    const ready = (): void => {
        doc.documentElement.dataset['cardReady'] = 'true';
    };

    const settled: unknown = card.afterRender ? card.afterRender.call(card, columns) : undefined;

    if (isThenable(settled)) {
        // The card is not ready until the interaction it staged is done.
        settled.then(ready, (error: unknown) => {
            doc.documentElement.dataset['cardError'] = String(error);
            console.error(`card afterRender failed: ${String(error)}`);
        });
    } else {
        ready();
    }
}
