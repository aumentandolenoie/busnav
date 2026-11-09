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
test -s "$APP/Web/route-stops.js"
rm -rf build/ios/Payload build/ios/LineaPilot-unsigned.ipa
mkdir -p build/ios/Payload
cp -R "$APP" build/ios/Payload/
(cd build/ios && /usr/bin/zip -q -r LineaPilot-unsigned.ipa Payload)
test -s build/ios/LineaPilot-unsigned.ipa
echo "Unsigned device IPA built: build/ios/LineaPilot-unsigned.ipa"


python3 - <<'PYIPA'
import zipfile,plistlib,json,hashlib
p='build/ios/LineaPilot-unsigned.ipa'
with zipfile.ZipFile(p) as z:
    assert z.testzip() is None
    info=plistlib.loads(z.read('Payload/LineaPilot.app/Info.plist'))
    assert info['CFBundleExecutable']=='LineaPilot'
    assert {'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'}.issubset(
        info['UISupportedInterfaceOrientations']
    )
    assert z.getinfo('Payload/LineaPilot.app/LineaPilot').file_size>0
    assert z.getinfo('Payload/LineaPilot.app/Web/official-routes.json').file_size>1000000
    primary=info['CFBundleIcons']['CFBundlePrimaryIcon']
    assert primary['CFBundleIconName']=='AppIcon'
    assert primary['CFBundleIconFiles']
    for name in primary['CFBundleIconFiles']:
        assert any(n.startswith('Payload/LineaPilot.app/'+name) and n.endswith('.png') for n in z.namelist()), name
    assert z.getinfo('Payload/LineaPilot.app/Assets.car').file_size>0
    prefix='Payload/LineaPilot.app/Web/'
    assert z.getinfo(prefix+'apple-touch-icon.png').file_size>0
    assert z.getinfo(prefix+'icons/icon-192.png').file_size>0
    assert z.getinfo(prefix+'icons/icon-512.png').file_size>0
    original=z.read(prefix+'official-routes.json')
    extra=z.read(prefix+'academy-supplemental-routes.json')
    evidence=json.loads(z.read(prefix+'academy-evidence.json'))
    assert len(json.loads(original))==787 and len(json.loads(extra))==2
    assert evidence['catalog']['total']==789
    coverage=json.loads(z.read(prefix+'road-guidance/coverage.json'))
    assert len(coverage['routes'])==789
    assert coverage['gpxSHA256']==hashlib.sha256(original+b'\0'+extra).hexdigest()
    for route in coverage['routes']:
        if route['status'] in ('validated','partial'):
            assert z.getinfo(prefix+'road-guidance/'+str(route['id'])+'.json').file_size>0
print('IPA payload, executable, plist and bundled official GPX validated')
PYIPA
