#!/bin/bash
# Build one saver: scripts/build-saver.sh savers/<id> [preview]
set -euo pipefail
dir="${1%/}"; mode="${2:-saver}"
# shellcheck source=/dev/null
source "$dir/saver.conf"
: "${NAME:?}" "${TITLE:?}" "${CLASS:?}" "${BUNDLE_ID:?}"
BG="${BG:-FFFFFF}"; PLAYLIST="${PLAYLIST:-}"; SWITCH="${SWITCH:-0}"; COPYRIGHT="${COPYRIGHT:-}"; INDEX="${INDEX:-index.html}"; FILE_ACCESS="${FILE_ACCESS:-0}"

# Optional per-saver build step (generated resources, vendored downloads).
if [ -x "$dir/prebuild.sh" ]; then "$dir/prebuild.sh"; fi

out=build/$NAME.saver
gen=build/gen/$NAME; mkdir -p "$gen"
SWIFTC=(swiftc -swift-version 5 -O -target arm64-apple-macos14.0 -module-name "$NAME"
        -framework ScreenSaver -framework WebKit -framework AppKit)

# Unique @objc name per saver; the shared base class gets a module-qualified name.
cat > "$gen/Principal.swift" <<SWIFT
import Foundation
@objc($CLASS) final class $CLASS: WebSaverView {}
typealias SaverPrincipal = $CLASS
SWIFT

if [ "$mode" = preview ]; then
  "${SWIFTC[@]}" -o "build/preview-$NAME" shell/WebSaverView.swift "$gen/Principal.swift" shell/main.swift
  exit 0
fi

rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"
"${SWIFTC[@]}" -emit-library \
  -Xlinker -install_name -Xlinker "@executable_path/../MacOS/$NAME" \
  -o "$out/Contents/MacOS/$NAME" shell/WebSaverView.swift "$gen/Principal.swift"
sed -e "s|@NAME@|$NAME|g" -e "s|@TITLE@|$TITLE|g" -e "s|@CLASS@|$CLASS|g" \
    -e "s|@BUNDLE_ID@|$BUNDLE_ID|g" -e "s|@BG@|$BG|g" -e "s|@PLAYLIST@|$PLAYLIST|g" -e "s|@SWITCH@|$SWITCH|g" \
    -e "s|@COPYRIGHT@|$COPYRIGHT|g" -e "s|@INDEX@|$INDEX|g" -e "s|@FILE_ACCESS@|$FILE_ACCESS|g" shell/Info.plist.in > "$out/Contents/Info.plist"
plutil -lint -s "$out/Contents/Info.plist"
cp -R "$dir/Resources/." "$out/Contents/Resources/"
codesign --force --sign - "$out" 2>/dev/null
echo "built $out"
