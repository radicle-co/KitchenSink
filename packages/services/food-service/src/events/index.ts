/**
 * Named barrel for the food-service event layer (MOD-002 completion fan-out, T-165). Named-only
 * (no `export *`) per the project's barrel convention.
 */
export {
    FoodEventEmitter,
    ConsoleEventBus,
    buildFoodFetchCompleted,
    buildFetchFailed,
    newEventId,
    FOOD_FETCH_COMPLETED_DETAIL_TYPE,
    FETCH_FAILED_DETAIL_TYPE,
} from './food-event-emitter.js';
export type {
    EventBus,
    EventBusPutInput,
    EventClock,
    FoodEventPublisher,
    FoodFetchCompletedDetail,
    FetchFailedDetail,
    PublishCompletedInput,
    PublishFailedInput,
} from './food-event-emitter.js';
