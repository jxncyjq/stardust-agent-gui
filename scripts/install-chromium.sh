#!/usr/bin/env bash
# 把这次安装要用的那个固定版 Chromium 装到 App 旁边（macOS / Linux）。
#
# 为什么是脚本而不是把浏览器打进安装包：一份浏览器每平台约 150–200MB，装进包里意味着
# 每次发版都把它重发一遍。脚本把「装什么版本」与「什么时候装」分开，安装包保持小巧，
# 而版本仍然是钉死的（见 chromium-pin.json）。
#
# 用法：
#   scripts/install-chromium.sh <App 的可执行文件所在目录>
#   scripts/install-chromium.sh --print-digest            # 只下载并打印摘要，不安装
#
# 落点**必须**与 bundled_chromium.go 里 bundledChromiumRelativePaths() 找的位置逐字
# 一致，否则装了也白装：运行时看不见它，静悄悄退到系统浏览器。CI 的 package 工作流
# 每次都会端到端验一遍（装完之后由 Go 那边报告它到底找没找到）。
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
pin="$here/chromium-pin.json"

die() { echo "install-chromium: $*" >&2; exit 1; }

[[ -f "$pin" ]] || die "找不到 $pin"

case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
      arm64) platform=mac-arm64 ;;
      x86_64) platform=mac-x64 ;;
      *) die "不认识的 macOS 架构 $(uname -m)" ;;
    esac
    ;;
  Linux)
    [[ "$(uname -m)" == "x86_64" ]] || die "Chrome for Testing 只发 x86_64 的 Linux 包，这台是 $(uname -m)"
    platform=linux64
    ;;
  *) die "这个脚本管 macOS 与 Linux；Windows 用 install-chromium.ps1" ;;
esac

read_pin() { python3 -c "import json,sys; d=json.load(open(sys.argv[1]))['platforms'][sys.argv[2]]; print(d[sys.argv[3]])" "$pin" "$platform" "$1"; }
url=$(read_pin url)
want=$(read_pin sha256)
version=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$pin")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
archive="$work/chrome.zip"

echo "==> 下载 Chrome for Testing $version（$platform）"
curl -fsSL --retry 3 -o "$archive" "$url"

if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$archive" | cut -d' ' -f1)
else
  got=$(shasum -a 256 "$archive" | cut -d' ' -f1)
fi

if [[ "${1:-}" == "--print-digest" ]]; then
  echo "platform=$platform version=$version sha256=$got"
  exit 0
fi

[[ $# -ge 1 ]] || die "用法：$0 <App 的可执行文件所在目录>"
appdir=$1
[[ -d "$appdir" ]] || die "目录不存在：$appdir"

# 摘要缺失就拒绝安装，不是「跳过校验继续装」：一个没被校验过的浏览器会以 App 自带
# 组件的身份运行，而它是从公网下载来的。缺摘要是 pin 文件没维护好，属于要修的事。
[[ -n "$want" ]] || die "chromium-pin.json 里 $platform 没有 sha256。先跑一次 --print-digest，把打印出来的摘要填回去再装。"
[[ "$got" == "$want" ]] || die "摘要不符：期望 $want，实际 $got。要么 pin 文件过期了，要么这次下载不可信——两种都不该继续装。"

case "$platform" in
  mac-*)
    # macOS 上 App 的资源在 Contents/Resources/，而可执行文件在 Contents/MacOS/——
    # 所以这里要的是 **.app 里面那个目录**，不是 .app 所在的目录。
    #
    # 这条不是挑剔：给成外面那层，浏览器会被装到 .app **旁边**，脚本一路成功，而
    # App 起来之后找不到它、静悄悄退到系统浏览器。CI 上第一次跑就是这么错的，症状
    # 正是「装完了，运行时说没有」。所以在这里就拦住，并把该给的路径说出来。
    if compgen -G "$appdir/*.app" > /dev/null; then
      app=$(compgen -G "$appdir/*.app" | head -1)
      die "在 macOS 上要给 .app 里面那个目录，而不是它所在的目录。这次应该是：${app}/Contents/MacOS"
    fi
    case "$appdir" in
      */Contents/MacOS|*/Contents/MacOS/) : ;;
      *) echo "install-chromium: 提醒——$appdir 看起来不像 .app 里的 Contents/MacOS，装出来的浏览器可能不在 App 找得到的位置" >&2 ;;
    esac
    dest="$appdir/../Resources/chromium"
    ;;
  *)
    dest="$appdir/chromium"
    ;;
esac

echo "==> 安装到 $dest"
rm -rf "$dest"
mkdir -p "$dest"
unzip -q "$archive" -d "$work/extracted"
# 压缩包里是一层同名目录（chrome-linux64/、chrome-mac-arm64/…），把它的内容摊平进
# 目标目录：落点是约定的，不能随平台包名变。
inner=$(find "$work/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)
[[ -n "$inner" ]] || die "压缩包里没有预期的目录结构"
cp -R "$inner"/. "$dest"/

case "$platform" in
  mac-*)
    binary="$dest/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    ;;
  *)
    binary="$dest/chrome"
    ;;
esac
[[ -f "$binary" ]] || die "装完之后没有找到浏览器可执行文件：$binary"
chmod +x "$binary"

echo "==> 完成：$binary"
"$binary" --version || die "装好的浏览器跑不起来"
