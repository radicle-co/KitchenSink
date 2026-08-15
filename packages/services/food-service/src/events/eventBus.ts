/**
 * The AWS-put SEAM for the food-service event layer (MOD-002, T-165) — the port that
 * `FoodEventEmitter` publishes through and that every concrete bus implements.
 *
 * It lives in its own module because it is a boundary, not a detail of either side: the emitter depends on
 * it, `ConsoleEventBus` implements it, and the worker bootstrap wires the real EventBridge bus behind it.
 * Keeping the real SDK call behind this interface is what lets the worker resolve foods with no AWS
 * dependency, and lets the worker tests inject a capturing fake.
 */

/** A single event to put on the bus (the source-agnostic shape the {@link EventBus} seam accepts). */
export interface EventBusPutInput {
    /** The canonical `detailType` (e.g. `FoodFetchCompleted`). */
    readonly detailType: string;
    /** The event detail payload (serialized by the concrete bus). */
    readonly detail: Record<string, unknown>;
}

/**
 * The AWS-put seam (EventBridge/SNS). The concrete implementation lives in the worker bootstrap; tests
 * inject a fake that captures puts.
 */
export interface EventBus {
    /**
     * Put one event on the bus.
     *
     * @param input - The `detailType` + detail payload.
     * @sideEffect Performs the underlying AWS `PutEvents` (or test capture).
     */
    putEvent(input: EventBusPutInput): Promise<void>;
}
