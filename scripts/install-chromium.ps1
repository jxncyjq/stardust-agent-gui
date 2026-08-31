# 把这次安装要用的那个固定版 Chromium 装到 App 旁边（Windows）。
#
# 与 install-chromium.sh 是同一件事的两个平台版本，取舍写在那边的抬头里：不把浏览器
# 打进安装包，而是把「装什么版本」钉在 chromium-pin.json 里，安装时再取。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\install-chromium.ps1 -AppDir <App 的 exe 所在目录>
#   powershell -ExecutionPolicy Bypass -File scripts\install-chromium.ps1 -PrintDigest
#
# 落点必须与 bundled_chromium.go 里 bundledChromiumRelativePaths() 找的位置逐字一致
# （Windows 上是 exe 同级的 chromium\chrome.exe），否则装了也白装：运行时看不见它，
# 静悄悄退到系统浏览器。CI 每次端到端验一遍。
[CmdletBinding()]
param(
    [string]$AppDir,
    [switch]$PrintDigest
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pinPath = Join-Path $here 'chromium-pin.json'
if (-not (Test-Path $pinPath)) { throw "install-chromium: 找不到 $pinPath" }

$pin = Get-Content $pinPath -Raw | ConvertFrom-Json
$platform = 'win64'
$entry = $pin.platforms.$platform
$version = $pin.version

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("chromium-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $archive = Join-Path $work 'chrome.zip'
    Write-Host "==> 下载 Chrome for Testing $version（$platform）"
    Invoke-WebRequest -Uri $entry.url -OutFile $archive -UseBasicParsing

    $got = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($PrintDigest) {
        Write-Host "platform=$platform version=$version sha256=$got"
        return
    }

    if (-not $AppDir) { throw "install-chromium: 需要 -AppDir <App 的 exe 所在目录>" }
    if (-not (Test-Path $AppDir)) { throw "install-chromium: 目录不存在：$AppDir" }

    # 摘要缺失就拒绝安装，不是「跳过校验继续装」：一个没被校验过的浏览器会以 App
    # 自带组件的身份运行，而它是从公网下载来的。
    if ([string]::IsNullOrWhiteSpace($entry.sha256)) {
        throw "install-chromium: chromium-pin.json 里 $platform 没有 sha256。先跑一次 -PrintDigest，把打印出来的摘要填回去再装。"
    }
    if ($got -ne $entry.sha256.ToLowerInvariant()) {
        throw "install-chromium: 摘要不符：期望 $($entry.sha256)，实际 $got。要么 pin 文件过期了，要么这次下载不可信——两种都不该继续装。"
    }

    $dest = Join-Path $AppDir 'chromium'
    Write-Host "==> 安装到 $dest"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    New-Item -ItemType Directory -Path $dest | Out-Null

    $extracted = Join-Path $work 'extracted'
    Expand-Archive -Path $archive -DestinationPath $extracted -Force
    # 压缩包里是一层同名目录（chrome-win64\），把它的内容摊平进目标目录：落点是约定
    # 的，不能随平台包名变。
    $inner = Get-ChildItem -Path $extracted -Directory | Select-Object -First 1
    if (-not $inner) { throw "install-chromium: 压缩包里没有预期的目录结构" }
    Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $dest -Recurse -Force

    $binary = Join-Path $dest 'chrome.exe'
    if (-not (Test-Path $binary)) { throw "install-chromium: 装完之后没有找到 $binary" }

    Write-Host "==> 完成：$binary"
    & $binary --version
    if ($LASTEXITCODE -ne 0) { throw "install-chromium: 装好的浏览器跑不起来（退出码 $LASTEXITCODE）" }
}
finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
