/**
 * Named barrel for the food-service event layer (MOD-002 completion fan-out, T-165). Named-only
 * (no `export *`) per the project's barrel convention.
 */
export {
    FoodEventEmitter,
    buildFoodFetchCompleted,
    buildFetchFailed,
    newEventId,
    FOOD_FETCH_COMPLETED_DETAIL_TYPE,
    FETCH_FAILED_DETAIL_TYPE,
} from './FoodEventEmitter.js';
export type {
    EventClock,
    FoodEventPublisher,
    FoodFetchCompletedDetail,
    FetchFailedDetail,
    PublishCompletedInput,
    PublishFailedInput,
} from './FoodEventEmitter.js';
export { ConsoleEventBus } from './ConsoleEventBus.js';
export type { EventBus, EventBusPutInput } from './eventBus.js';
