#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/Library/Application Support/AuTomato"
CACHE="$HOME/Library/Caches/AuTomato-Installer"
TARGET="$HOME/Applications/AuTomato.app"
VERSION="39.2.7"
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "This Mac architecture is not supported."; exit 1 ;;
esac
mkdir -p "$CACHE" "$DATA/backups" "$HOME/Applications"
STAGE="$(mktemp -d "$CACHE/install.XXXXXX")"
ARCHIVE="electron-v$VERSION-darwin-$ARCH.zip"
BASE="https://github.com/electron/electron/releases/download/v$VERSION"
echo "Installing AuTomato for $ARCH. Downloading its native Electron runtime..."
/usr/bin/curl --fail --location --retry 2 "$BASE/$ARCHIVE" --output "$STAGE/$ARCHIVE"
/usr/bin/curl --fail --location --retry 2 "$BASE/SHASUMS256.txt" --output "$STAGE/SHASUMS256.txt"
EXPECTED="$(/usr/bin/awk -v name="$ARCHIVE" '$2 == name || $2 == "*" name { print $1 }' "$STAGE/SHASUMS256.txt")"
ACTUAL="$(/usr/bin/shasum -a 256 "$STAGE/$ARCHIVE" | /usr/bin/awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Runtime checksum verification failed. Nothing was installed."; exit 1
fi
/usr/bin/ditto -x -k "$STAGE/$ARCHIVE" "$STAGE/runtime"
APP="$STAGE/runtime/Electron.app"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName AuTomato" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName AuTomato" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string AuTomato" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.automatobot.desktop" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable AuTomato" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion 0.3.2" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 0.3.2" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile automato.icns" "$PLIST"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/AuTomato"
cp "$HERE/payload/app.asar" "$APP/Contents/Resources/app.asar"
cp "$HERE/payload/automato.icns" "$APP/Contents/Resources/automato.icns"
/usr/bin/ditto "$HERE/payload/cli-anything" "$APP/Contents/Resources/cli-anything"
/usr/bin/ditto "$HERE/payload/licenses" "$APP/Contents/Resources/licenses"
cp "$HERE/payload/LICENSE" "$HERE/payload/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/"
# Locally sign the assembled app. This does not claim Apple Developer signing
# or notarization, and uses no paid services or developer account.
/usr/bin/codesign --force --deep --sign - "$APP"
/usr/bin/codesign --verify --deep --strict "$APP"
if [ -e "$TARGET" ]; then
  BACKUP="$DATA/backups/AuTomato-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$TARGET" "$BACKUP"
  echo "Previous app preserved at: $BACKUP"
fi
mv "$APP" "$TARGET"
echo "Installed: $TARGET"
echo "Your sessions and assets will stay in: $DATA"
/usr/bin/open "$TARGET"
