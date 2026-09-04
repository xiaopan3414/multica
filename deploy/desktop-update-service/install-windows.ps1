param(
  [string]$InstallDir = "$env:ProgramData\MulticaDesktopUpdate",
  [int]$Port = 8090
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "请使用管理员权限运行 PowerShell。"
}

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$binarySource = Join-Path $sourceDir "bin\multica-update-server-windows-x64.exe"
$binaryTarget = Join-Path $InstallDir "bin\multica-update-server.exe"
$releaseTarget = Join-Path $InstallDir "releases"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $binaryTarget), $releaseTarget | Out-Null
Copy-Item -LiteralPath $binarySource -Destination $binaryTarget -Force
Copy-Item -Path (Join-Path $sourceDir "releases\*") -Destination $releaseTarget -Recurse -Force

$taskName = "Multica Desktop Update Service"
$arguments = "--listen 0.0.0.0:$Port --root `"$releaseTarget`""
$action = New-ScheduledTaskAction -Execute $binaryTarget -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null

$firewallName = "Multica Desktop Update Service ($Port)"
if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
}

Start-ScheduledTask -TaskName $taskName
Write-Host "更新服务已启动：http://10.0.37.30:$Port/windows/x64/latest.yml"
