# iOS E2E Build + Test Pipeline Research

> Expo SDK 53 + `@clerk/expo` + Maestro + GitHub Actions CI

---

## 1. How to Build the Expo App for iOS in GitHub Actions

### Option A: Local Build (Recommended for fastest CI iteration)

Use `expo prebuild` + `expo run:ios --device generic` on the `macos-latest` runner. This generates a `.app` bundle for the iOS Simulator without needing a specific simulator to be running.

```bash
# 1. Install dependencies
npm ci

# 2. Prebuild native iOS project (generates ios/ directory with Xcode project)
npx expo prebuild -p ios --clean

# 3. Build for generic iOS Simulator (build-only, no device required)
npx expo run:ios \
  --device generic \
  --configuration Debug \
  --output ./build
```

**Output**: `./build/SousChef.app` (a `.app` bundle, NOT an IPA)

**Key flags**:

- `--device generic` — Uses `-destination 'generic/platform=iOS Simulator'` under the hood; does not require a booted simulator
- `--configuration Debug` — Faster than Release; debug builds work fine for E2E
- `--output ./build` — Copies the final `.app` to a predictable path (Expo SDK 53+)

### Option B: EAS Build (Fire-and-forget, slower but zero Xcode setup)

Create a simulator profile in `eas.json`:

```json
{
    "cli": {
        "version": ">= 16.0.0"
    },
    "build": {
        "preview": {
            "distribution": "internal"
        },
        "e2e-simulator": {
            "ios": {
                "simulator": true
            },
            "android": {
                "buildType": "apk"
            }
        }
    }
}
```

Trigger from CI and wait for the artifact:

```bash
npx eas build \
  --platform ios \
  --profile e2e-simulator \
  --non-interactive \
  --json > build.json

BUILD_URL=$(jq -r '.[0].artifacts.buildUrl' build.json)
curl -L "$BUILD_URL" -o ./build/ios-simulator.tar.gz
```

EAS Build produces a **tar.gz** containing the `.app` bundle when `ios.simulator: true`.

---

## 2. What iOS Artifacts Maestro Needs

| Artifact                  | Supported? | Notes                                                                                      |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `.app` bundle (Simulator) | **YES**    | This is the ONLY artifact Maestro accepts for iOS Simulator                                |
| IPA (device build)        | **NO**     | Real-device IPAs are ARM64-only; Maestro Cloud simulators and local simulators reject them |
| `.xcarchive`              | **NO**     | Must extract the `.app` from inside it                                                     |

**Bottom line**: You need a `.app` bundle compiled for `x86_64` or `arm64` **iphonesimulator** architecture.

### How to verify your `.app` is simulator-compatible:

```bash
lipo -info ./build/SousChef.app/SousChef
# Expected: x86_64 arm64 (for simulator)
# Bad: arm64 only (device build, will fail)
```

---

## 3. Running iOS Simulator in GitHub Actions

### Runner Requirement

**iOS Simulator CANNOT run on `ubuntu-latest`.** You must use a macOS runner:

```yaml
runs-on: macos-latest # or macos-15, macos-14
```

### Xcode Selection

```yaml
- name: Select Xcode
  run: sudo xcode-select -s /Applications/Xcode_16.2.app
```

> GitHub `macos-latest` runners have multiple Xcode versions installed. Pin one for reproducibility.

### Booting the Simulator

```bash
# List available simulators and extract UDID for iPhone 15
DEVICE_ID=$(xcrun simctl list devices available -j | \
  jq -r '.devices | to_entries[] | select(.key | contains("iOS")) | .value[] | select(.name == "iPhone 15") | .udid' | head -1)

# Boot it (idempotent; safe to run again)
xcrun simctl boot "$DEVICE_ID" || true

# Wait until fully booted
xcrun simctl bootstatus "$DEVICE_ID" -b
```

Alternative: Let Maestro start the device for you:

```bash
maestro start-device --platform ios
```

This boots a default iOS simulator (iPhone 11, iOS 15.5+) if none is running.

---

## 4. Installing and Running Maestro Against iOS Simulator

### Install Maestro CLI

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
echo "$HOME/.maestro/bin" >> $GITHUB_PATH
```

### Install the `.app` onto the booted simulator

```bash
xcrun simctl install booted ./build/SousChef.app
```

> Maestro does NOT auto-install `.app` bundles for iOS the way it can with APKs. You must install via `simctl` first.

### Run Maestro tests

```bash
# Option 1: Target by UDID
maestro --device "$DEVICE_ID" test .maestro/auth/

# Option 2: Let Maestro pick the booted simulator
maestro test .maestro/auth/
```

**iOS-specific Maestro CLI options**:

| Flag                              | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `--device <udid>`                 | Target a specific iOS simulator          |
| `--platform ios`                  | Force iOS platform                       |
| `--env APP_ID=io.souschef.mobile` | Pass bundle ID if different from Android |
| `start-device --platform ios`     | Boot a default iOS simulator             |

---

## 5. Dual-Platform CI: iOS + Android in the Same Workflow?

**Yes.** Use a matrix or separate jobs in the same workflow file. The standard pattern is:

```yaml
jobs:
    e2e-android:
        runs-on: ubuntu-latest
        steps:
            - ... build debug APK ...
            - ... run Maestro (local emulator or Maestro Cloud) ...

    e2e-ios:
        runs-on: macos-latest
        steps:
            - ... build simulator .app ...
            - ... boot simulator, install, run Maestro ...
```

### Architecture Decision: Local Maestro vs Maestro Cloud

| Approach                            | iOS Runner                    | Android Runner                | Complexity | Cost                  |
| ----------------------------------- | ----------------------------- | ----------------------------- | ---------- | --------------------- |
| **Maestro Cloud** (recommended)     | `ubuntu-latest` (just upload) | `ubuntu-latest` (just upload) | Low        | Maestro Cloud pricing |
| **Local Maestro + Emulator/Sim**    | `macos-latest` (boot sim)     | `ubuntu-latest` (boot emu)    | Medium     | GitHub runner minutes |
| **Local Maestro + physical device** | Custom runner                 | Custom runner                 | High       | Hardware              |

**Recommendation for this project**: Start with **local Maestro on `macos-latest`** for iOS and `ubuntu-latest` for Android. This avoids third-party service dependencies and gives full control over simulator/emulator versions. If build times become painful, switch iOS builds to EAS Build and use `action-maestro-cloud` for test execution.

---

## 6. EAS Build for iOS — Simulator Artifact

### `eas.json` Profile

```json
{
    "cli": {
        "version": ">= 16.0.0"
    },
    "build": {
        "e2e": {
            "ios": {
                "simulator": true,
                "buildConfiguration": "Debug"
            },
            "android": {
                "buildType": "apk"
            }
        }
    }
}
```

### Download Artifact in CI

```bash
npx eas build \
  --platform ios \
  --profile e2e \
  --non-interactive \
  --json > build.json

BUILD_URL=$(jq -r '.[0].artifacts.buildUrl' build.json)
curl -L "$BUILD_URL" -o ios-build.tar.gz

# Extract the .app bundle (EAS simulator builds are tar.gz)
tar -xzf ios-build.tar.gz
```

> Note: EAS Build iOS simulator artifacts are delivered as `.tar.gz` archives containing the `.app`. You must extract before passing to Maestro.

---

## 7. Caching Strategies

### For Local Build (Option A)

```yaml
- name: Cache node_modules
  uses: actions/cache@v4
  with:
      path: |
          node_modules
          packages/*/node_modules
      key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

- name: Cache CocoaPods
  uses: actions/cache@v4
  with:
      path: |
          packages/apps/sous-chef/mobile/ios/Pods
          ~/Library/Caches/CocoaPods
      key: ${{ runner.os }}-pods-${{ hashFiles('packages/apps/sous-chef/mobile/ios/Podfile.lock') }}

- name: Cache Xcode DerivedData
  uses: actions/cache@v4
  with:
      path: ~/Library/Developer/Xcode/DerivedData
      key: ${{ runner.os }}-derived-${{ hashFiles('packages/apps/sous-chef/mobile/ios/Podfile.lock') }}-${{ hashFiles('packages/apps/sous-chef/mobile/**/*.swift') }}
      restore-keys: |
          ${{ runner.os }}-derived-

- name: Cache built .app
  uses: actions/cache@v4
  with:
      path: packages/apps/sous-chef/mobile/build/*.app
      key: ${{ runner.os }}-app-${{ github.sha }}
```

### Key caching insights

1. **CocoaPods** — Lockfile hashing ensures cache invalidation when native deps change.
2. **DerivedData** — Xcode caches compiled pods. In CI this starts empty; restoring DerivedData can cut 50%+ from rebuild times. Expo is adding `EAS_XCODE_CACHE=1` support for this.
3. **`.app` bundle** — Cache the final binary between build and test jobs to avoid rebuilding when only test YAML changes.

---

## 8. Complete Example Workflow YAML

### `.github/workflows/e2e-mobile.yml`

```yaml
name: Mobile E2E Tests

on:
    push:
        branches: [main]
    pull_request:
        branches: [main]
    workflow_dispatch:

concurrency:
    group: e2e-mobile-${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: true

env:
    MOBILE_DIR: packages/apps/sous-chef/mobile

jobs:
    # ------------------------------------------------------------------
    # ANDROID E2E
    # ------------------------------------------------------------------
    e2e-android:
        name: Android E2E (ubuntu)
        runs-on: ubuntu-latest
        timeout-minutes: 30
        defaults:
            run:
                working-directory: ${{ env.MOBILE_DIR }}

        steps:
            - uses: actions/checkout@v6

            - uses: actions/setup-node@v6
              with:
                  node-version-file: .nvmrc
                  cache: npm

            - uses: actions/setup-java@v4
              with:
                  java-version: 21
                  distribution: temurin

            - name: Install dependencies
              run: npm ci

            - name: Prebuild Android
              run: npx expo prebuild -p android --clean

            - name: Build debug APK
              run: ./android/gradlew assembleDebug
              working-directory: ${{ env.MOBILE_DIR }}/android

            - name: Install Maestro
              run: |
                  curl -Ls "https://get.maestro.mobile.dev" | bash
                  echo "$HOME/.maestro/bin" >> $GITHUB_PATH

            - name: Start Android emulator & run tests
              uses: reactivecircus/android-emulator-runner@v2
              with:
                  api-level: 34
                  target: google_apis
                  arch: x86_64
                  script: |
                      maestro test .maestro/auth/

    # ------------------------------------------------------------------
    # iOS E2E
    # ------------------------------------------------------------------
    e2e-ios:
        name: iOS E2E (macOS)
        runs-on: macos-latest
        timeout-minutes: 30
        defaults:
            run:
                working-directory: ${{ env.MOBILE_DIR }}

        steps:
            - uses: actions/checkout@v6

            - uses: actions/setup-node@v6
              with:
                  node-version-file: .nvmrc
                  cache: npm

            - name: Select Xcode
              run: sudo xcode-select -s /Applications/Xcode_16.2.app

            - name: Cache node_modules
              uses: actions/cache/restore@v4
              with:
                  path: |
                      ${{ env.MOBILE_DIR }}/node_modules
                      node_modules
                  key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
                  fail-on-cache-miss: true

            - name: Cache CocoaPods
              uses: actions/cache@v4
              with:
                  path: |
                      ${{ env.MOBILE_DIR }}/ios/Pods
                      ~/Library/Caches/CocoaPods
                  key: ${{ runner.os }}-pods-${{ hashFiles('${{ env.MOBILE_DIR }}/ios/Podfile.lock') }}

            - name: Cache DerivedData
              uses: actions/cache@v4
              with:
                  path: ~/Library/Developer/Xcode/DerivedData
                  key: ${{ runner.os }}-derived-${{ hashFiles('${{ env.MOBILE_DIR }}/ios/Podfile.lock') }}-${{ github.sha }}
                  restore-keys: ${{ runner.os }}-derived-

            - name: Prebuild iOS
              run: npx expo prebuild -p ios --clean

            - name: Build for iOS Simulator
              run: |
                  npx expo run:ios \
                    --device generic \
                    --configuration Debug \
                    --output ./build

            - name: Boot iOS Simulator
              run: |
                  DEVICE_ID=$(xcrun simctl list devices available -j | \
                    jq -r '.devices | to_entries[] | select(.key | contains("iOS")) | .value[] | select(.name == "iPhone 15") | .udid' | head -1)
                  [ -z "$DEVICE_ID" ] && DEVICE_ID=$(xcrun simctl list devices available -j | \
                    jq -r '.devices | to_entries[] | select(.key | contains("iOS")) | .value[] | select(.name | contains("iPhone")) | .udid' | head -1)
                  echo "device-id=$DEVICE_ID" >> $GITHUB_ENV
                  xcrun simctl boot "$DEVICE_ID" || true
                  xcrun simctl bootstatus "$DEVICE_ID" -b

            - name: Install Maestro
              run: |
                  curl -Ls "https://get.maestro.mobile.dev" | bash
                  echo "$HOME/.maestro/bin" >> $GITHUB_PATH

            - name: Install app on simulator
              run: |
                  APP_PATH=$(ls -d ./build/*.app | head -1)
                  xcrun simctl install booted "$APP_PATH"

            - name: Run Maestro iOS tests
              run: |
                  maestro --device ${{ env.device-id }} test .maestro/auth/
```

---

## 9. Maestro Flow Updates for Cross-Platform

Your current `.maestro/auth/loginFlow.yaml` is Android-only (references debug APK). For dual-platform CI, make the flow platform-agnostic using environment variables:

```yaml
appId: ${APP_ID}
---
- launchApp:
      appId: ${APP_ID}
      clearState: true

- assertVisible: 'Sous Chef'
- assertVisible: 'Email'
- assertVisible: 'Password'
# ... rest unchanged
```

Then pass the correct bundle ID per platform:

```bash
# Android
maestro --env APP_ID=io.souschef.mobile test .maestro/auth/

# iOS (same bundle ID in this project)
maestro --env APP_ID=io.souschef.mobile --device $DEVICE_ID test .maestro/auth/
```

If you ever need different IDs per platform, use tags:

```yaml
# In loginFlow.yaml
tags:
    - auth
    - cross-platform
```

---

## 10. Architecture Decision Matrix

| Decision                | Recommendation                                  | Rationale                                                                                           |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Build method**        | Local build via `expo run:ios --device generic` | Fastest iteration, no EAS queue wait, no external service dependency                                |
| **iOS runner**          | `macos-latest` (or `macos-15`)                  | iOS Simulator is macOS-only                                                                         |
| **Android runner**      | `ubuntu-latest`                                 | Cheaper, native Android emulator support                                                            |
| **Test runner**         | Local Maestro CLI                               | Avoids Maestro Cloud cost; full control over env                                                    |
| **Artifact type**       | `.app` bundle                                   | Only format Maestro accepts for iOS Simulator                                                       |
| **Build/test split**    | Same job for iOS (build + test on macOS)        | Artifact transfer between macOS jobs is possible but adds complexity; caching the `.app` is simpler |
| **EAS Build**           | Optional optimization later                     | Use when local Xcode builds exceed ~15 min or when you need device builds                           |
| **Separate workflows?** | Same workflow, separate jobs                    | Keeps mobile E2E in one place; GitHub UI shows both results on PR                                   |

---

## 11. Gotchas & Reminders

1. **IPA ≠ Simulator** — Do not try to install an IPA on the iOS Simulator. It will fail silently or with a cryptic `simctl` error.
2. **Expo SDK 53** — Requires Xcode 16+. Use `macos-15` or newer runners which ship Xcode 16.2+.
3. **CocoaPods on CI** — The first build will install pods (~3-5 min). Cache `ios/Pods` aggressively.
4. **Maestro `start-device`** — This is convenient locally but on CI you usually want explicit simulator selection (`iPhone 15` = most common testing target).
5. **Clerk magic emails** — The `+clerk_test` OTP `424242` works on both platforms identically; no flow changes needed.
6. **`clearState: true`** — On iOS this uninstalls and reinstalls the app. Ensure your test does not depend on pre-existing keychain data (Clerk tokens stored in `expo-secure-store` are wiped, which is correct for a clean auth flow test).
7. **GitHub Actions concurrency** — macOS runners are ~10x more expensive than Ubuntu. If build times are >15 min, consider EAS Build + Maestro Cloud to move expensive work off the macOS runner.

---

_End of research document._
