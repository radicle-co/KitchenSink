# 014 Notification Service: rules that are easy to get wrong

Read these before you work on this feature.

- The OS push-permission prompt calls `markShown('pushPermission')` from `@commise/features-core` when it shows, and does not show while `anyShown()` is true in the same app session (FR-036 R8a, feature 008).
