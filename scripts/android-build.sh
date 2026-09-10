#!/usr/bin/env bash
#
# android-build.sh — 배포용 디버그 APK 빌드 (npm run android:build).
# JDK 를 직접 고른 뒤 Gradle 을 돌린다 — Android Studio 의 JDK 25 로는 빌드가 안 되기 때문.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

. scripts/pick-jdk.sh

npm run build:no-lint
npx cap sync android
( cd android && ./gradlew --console=plain "${@:-assembleDebug}" )

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$APK" ]] && ok "APK: $APK"
