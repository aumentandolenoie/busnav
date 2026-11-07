#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/ios
xcodebuild -project ios/LineaPilot.xcodeproj \
  -scheme LineaPilot -configuration Release \
  -destination 'generic/platform=iOS' -sdk iphoneos \
  -derivedDataPath "$PWD/build/ios/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build > build/ios/xcodebuild.log 2>&1 || {
    tail -n 160 build/ios/xcodebuild.log
    exit 1
  }
APP="$PWD/build/ios/DerivedData/Build/Products/Release-iphoneos/LineaPilot.app"
test -f "$APP/Info.plist"
test -s "$APP/Web/official-routes.json"
test -s "$APP/Web/winter-turns.json"
test -s "$APP/Web/winter.js"
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist" | grep -qx "app.lineapilot.turni.experiment"
/usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" "$APP/Info.plist" | grep -qx "LineaPilot Turni"
mkdir -p build/ios/Payload
cp -R "$APP" build/ios/Payload/
(cd build/ios && /usr/bin/zip -q -r LineaPilot-Turni-unsigned.ipa Payload)
test -s build/ios/LineaPilot-Turni-unsigned.ipa
echo "Unsigned device IPA built: build/ios/LineaPilot-Turni-unsigned.ipa"
