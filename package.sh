#!/usr/bin/env sh
# couldnt figure out undocumented 'output template' mode for pkg so wrote this
# also need to include .node files until pkg supports including them in binary

NODE_ABI="node-64"
VERSION=$(node -pe "require('./package.json').version")

echo $NODE_ABI
echo $VERSION

rm -rf dist

mkdir dist
mkdir builds/supr-$VERSION-linux-x64
mkdir builds/supr-$VERSION-macos-x64
mkdir builds/supr-$VERSION-win-x64

mv builds/supr-linux builds/supr-$VERSION-linux-x64/supr
mv builds/supr-macos builds/supr-$VERSION-macos-x64/supr
mv builds/supr-win.exe builds/supr-$VERSION-win-x64/supr.exe

cp node_modules/utp-native/prebuilds/linux-x64/node-napi.node builds/supr-$VERSION-linux-x64/
cp node_modules/utp-native/prebuilds/darwin-x64/node-napi.node builds/supr-$VERSION-macos-x64/
cp node_modules/utp-native/prebuilds/win32-x64/node-napi.node builds/supr-$VERSION-win-x64/

cp node_modules/sodium-native/prebuilds/linux-x64/node-64.node builds/supr-$VERSION-linux-x64/
cp node_modules/sodium-native/prebuilds/darwin-x64/node-64.node builds/supr-$VERSION-macos-x64/
cp node_modules/sodium-native/prebuilds/win32-x64/node-64.node builds/supr-$VERSION-win-x64/

cp node_modules/sodium-native/prebuilds/linux-x64/libsodium.so.23 builds/supr-$VERSION-linux-x64/
cp node_modules/sodium-native/prebuilds/darwin-x64/libsodium.dylib builds/supr-$VERSION-macos-x64/
cp node_modules/sodium-native/prebuilds/win32-x64/libsodium.dll builds/supr-$VERSION-win-x64/

#cp -rv ffmpeg/ builds/supr-$VERSION-win-x64/

cp LICENSE builds/supr-$VERSION-linux-x64/
cp LICENSE builds/supr-$VERSION-macos-x64/
cp LICENSE builds/supr-$VERSION-win-x64/

cp README.md builds/supr-$VERSION-linux-x64/README
cp README.md builds/supr-$VERSION-macos-x64/README
cp README.md builds/supr-$VERSION-win-x64/README

cd builds

7z a ../dist/supr-$VERSION-linux-x64.7z supr-$VERSION-linux-x64 || echo "Trying 7zr bin instead" && 7zr a ../dist/supr-$VERSION-linux-x64.7z supr-$VERSION-linux-x64
7z a ../dist/supr-$VERSION-macos-x64.7z supr-$VERSION-macos-x64 || echo "Trying 7zr bin instead" && 7zr a ../dist/supr-$VERSION-macos-x64.7z supr-$VERSION-macos-x64
7z a ../dist/supr-$VERSION-win-x64.7z supr-$VERSION-win-x64 || echo "Trying 7zr bin instead" && 7zr a ../dist/supr-$VERSION-win-x64.7z supr-$VERSION-win-x64

