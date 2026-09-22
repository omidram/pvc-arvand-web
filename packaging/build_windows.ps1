#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the Windows desktop app (PyInstaller) and a Setup.exe installer.

.DESCRIPTION
  1. Exports the Next.js frontend as static files (same-origin API).
  2. Bundles FastAPI + UI + seed database into PVCArvand.exe.
  3. If Inno Setup is available, wraps that folder into PVCArvand-Setup.exe.

  Output:
    backend\dist\PVCArvand\PVCArvand.exe   (portable, double-click to run)
    packaging\output\PVCArvand-Setup.exe   (installer, if Inno Setup is present)
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Packaging = $PSScriptRoot
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$Output = Join-Path $Packaging "output"

Set-Location $Root

if (-not (Test-Path $Python)) {
    throw "Backend venv not found at $Python. Create it first: python -m venv backend\.venv"
}

Write-Host "==> Installing packaging Python tools"
& $Python -m pip install --upgrade pip pyinstaller pillow | Out-Host

Write-Host "==> Creating installer icon from logo.png"
$iconScript = @'
from pathlib import Path
from PIL import Image
root = Path(r"ROOT_PLACEHOLDER")
src = root / "frontend" / "public" / "logo.png"
dst = root / "packaging" / "pvc-arvand.ico"
im = Image.open(src).convert("RGBA")
# Pad to square so the icon is not stretched in Explorer / the Start Menu.
side = max(im.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
canvas.save(dst, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(dst)
'@
$iconScript = $iconScript.Replace("ROOT_PLACEHOLDER", $Root.Replace("\", "\\"))
$iconFile = Join-Path $env:TEMP "make_pvc_icon.py"
Set-Content -Path $iconFile -Value $iconScript -Encoding UTF8
& $Python $iconFile

Write-Host "==> Exporting frontend (static)"
Push-Location $Frontend
$env:PVC_STATIC_EXPORT = "1"
$env:NEXT_PUBLIC_SAME_ORIGIN = "1"
$env:NEXT_PUBLIC_API_URL = ""
$env:NEXT_TELEMETRY_DISABLED = "1"
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend static export failed" }
Pop-Location
if (-not (Test-Path (Join-Path $Frontend "out\index.html"))) {
    throw "frontend/out/index.html was not produced"
}

Write-Host "==> Building PVCArvand.exe with PyInstaller"
Push-Location $Backend
& $Python -m PyInstaller --noconfirm --clean (Join-Path $Packaging "pvc_arvand.spec")
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "PyInstaller failed" }
Pop-Location

$Exe = Join-Path $Backend "dist\PVCArvand\PVCArvand.exe"
if (-not (Test-Path $Exe)) { throw "Expected $Exe was not created" }
Write-Host "Built: $Exe"

New-Item -ItemType Directory -Force -Path $Output | Out-Null

function Get-Iscc {
    $cmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $guesses = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    foreach ($g in $guesses) {
        if (Test-Path $g) { return $g }
    }
    return $null
}

$iscc = Get-Iscc
if (-not $iscc) {
    Write-Host "==> Inno Setup not found; downloading portable compiler"
    $innoDir = Join-Path $Packaging "innosetup"
    $innoInstaller = Join-Path $env:TEMP "innosetup-installer.exe"
    New-Item -ItemType Directory -Force -Path $innoDir | Out-Null
    Invoke-WebRequest -Uri "https://jrsoftware.org/download.php/is.exe" -OutFile $innoInstaller
    Start-Process -FilePath $innoInstaller -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/DIR=`"$innoDir`"" -Wait
    $iscc = Get-Iscc
    if (-not $iscc -and (Test-Path (Join-Path $innoDir "ISCC.exe"))) {
        $iscc = Join-Path $innoDir "ISCC.exe"
    }
}

if ($iscc) {
    Write-Host "==> Compiling installer with Inno Setup ($iscc)"
    & $iscc (Join-Path $Packaging "pvc_arvand.iss")
    $setup = Join-Path $Output "PVCArvand-Setup.exe"
    if (Test-Path $setup) {
        Write-Host "Installer: $setup"
    } else {
        Write-Warning "Inno Setup ran but PVCArvand-Setup.exe was not found in $Output"
    }
} else {
    Write-Warning "Inno Setup compiler was not available. The portable app is still at:"
    Write-Warning $Exe
    Write-Host "You can zip backend\dist\PVCArvand and copy it to any Windows PC."
}

Write-Host ""
Write-Host "Done."
Write-Host "  Portable EXE : $Exe"
Write-Host "  Installer    : $(Join-Path $Output 'PVCArvand-Setup.exe')"
Write-Host "First login after install: admin / admin123  (change this password immediately)"
