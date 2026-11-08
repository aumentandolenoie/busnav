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
rm -rf build/ios/Payload build/ios/LineaPilot-unsigned.ipa
mkdir -p build/ios/Payload
cp -R "$APP" build/ios/Payload/
(cd build/ios && /usr/bin/zip -q -r LineaPilot-unsigned.ipa Payload)
test -s build/ios/LineaPilot-unsigned.ipa
echo "Unsigned device IPA built: build/ios/LineaPilot-unsigned.ipa"


python3 - <<'PYIPA'
import zipfile,plistlib
p='build/ios/LineaPilot-unsigned.ipa'
with zipfile.ZipFile(p) as z:
    assert z.testzip() is None
    info=plistlib.loads(z.read('Payload/LineaPilot.app/Info.plist'))
    assert info['CFBundleExecutable']=='LineaPilot'
    assert z.getinfo('Payload/LineaPilot.app/LineaPilot').file_size>0
    assert z.getinfo('Payload/LineaPilot.app/Web/official-routes.json').file_size>1000000
print('IPA payload, executable, plist and bundled official GPX validated')
PYIPA
