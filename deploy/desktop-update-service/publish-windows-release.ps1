param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,
  [string]$ServiceRoot = "$env:ProgramData\MulticaDesktopUpdate"
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $SourceDir).Path
$target = Join-Path $ServiceRoot "releases\windows\x64"
$metadata = Join-Path $source "latest.yml"
$installers = @(Get-ChildItem -LiteralPath $source -Filter "*.exe" -File)
$blockmaps = @(Get-ChildItem -LiteralPath $source -Filter "*.blockmap" -File)

if (-not (Test-Path -LiteralPath $metadata) -or $installers.Count -eq 0 -or $blockmaps.Count -eq 0) {
  throw "发布目录必须包含 latest.yml、Windows 安装包和 blockmap。"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath $installers.FullName -Destination $target -Force
Copy-Item -LiteralPath $blockmaps.FullName -Destination $target -Force
Copy-Item -LiteralPath $metadata -Destination (Join-Path $target "latest.yml.tmp") -Force
Move-Item -LiteralPath (Join-Path $target "latest.yml.tmp") -Destination (Join-Path $target "latest.yml") -Force

Write-Host "已发布到 $target"
