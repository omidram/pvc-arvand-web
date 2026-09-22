#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the portable PVC Arvand folder onto this Windows PC.
  Copies files to %LOCALAPPDATA%\Programs\PVC Arvand and creates Start Menu / Desktop shortcuts.
#>
$ErrorActionPreference = "Stop"
if (Test-Path (Join-Path $PSScriptRoot "PVCArvand.exe")) {
    $Source = $PSScriptRoot
} else {
    $Source = Join-Path $PSScriptRoot "..\backend\dist\PVCArvand"
}
if (-not (Test-Path (Join-Path $Source "PVCArvand.exe"))) {
    throw "PVCArvand.exe not found next to this script (or in backend\dist\PVCArvand). Copy this installer into the extracted zip folder, or run packaging\build_windows.ps1 first."
}

$Dest = Join-Path $env:LOCALAPPDATA "Programs\PVC Arvand"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "Installing to $Dest"
Copy-Item -Path (Join-Path $Source "*") -Destination $Dest -Recurse -Force

$exe = Join-Path $Dest "PVCArvand.exe"
$programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$desktop = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell

$start = $ws.CreateShortcut((Join-Path $programs "PVC Arvand.lnk"))
$start.TargetPath = $exe
$start.WorkingDirectory = $Dest
$start.Description = "PVC Arvand Electrolyzer Management Program"
$start.Save()

$desk = $ws.CreateShortcut((Join-Path $desktop "PVC Arvand.lnk"))
$desk.TargetPath = $exe
$desk.WorkingDirectory = $Dest
$desk.Description = "PVC Arvand Electrolyzer Management Program"
$desk.Save()

Write-Host "Installed. Shortcuts created on the Desktop and in the Start Menu."
Write-Host "Launching PVC Arvand..."
Start-Process -FilePath $exe
