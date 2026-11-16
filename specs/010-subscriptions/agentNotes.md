# 010 Subscriptions: rules that are easy to get wrong

Read these before you work on this feature.

- A paywall or an offer that interrupts the cook calls `markShown('paywall')` or `markShown('offer')` from
  `@commise/features-core` when it shows, and does not show while `anyShown()` is true in the same app session (FR-036
  R8a, feature 008).
