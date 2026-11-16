#!/bin/bash
# アイコンの書き出し。build/icon.svg（大きいサイズ用）と build/icon-small.svg（32px 以下用）から作る。
#   必要なもの: rsvg-convert（librsvg2-tools）、magick（ImageMagick）
#   出力: build/icon.png（1024px。macOS・Linux の配布用）、build/icon.ico（Windows 用）、resources/icon.png（実行中のウィンドウ用）
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for s in 16 20 24 32; do rsvg-convert -w $s -h $s build/icon-small.svg -o "$tmp/$s.png"; done
for s in 40 48 64 128 256 512 1024; do rsvg-convert -w $s -h $s build/icon.svg -o "$tmp/$s.png"; done
cp "$tmp/1024.png" build/icon.png
mkdir -p resources
cp "$tmp/512.png" resources/icon.png
magick "$tmp"/{16,20,24,32,40,48,64,128,256}.png build/icon.ico
echo "書き出しました: build/icon.png build/icon.ico resources/icon.png"
