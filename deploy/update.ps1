# Windows server / workstation update (Docker Desktop or compose).
# Preserves the named volume pvc_arvand_data. Never deletes plant records.
#   powershell -ExecutionPolicy Bypass -File deploy\update.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".git")) {
  throw "This folder is not a git checkout. Clone the repo first."
}

$BackupDir = Join-Path $Root "deploy\backups"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Snapshot = "/data/backups/pre_update_$Stamp.db"

$running = docker compose ps --status running --services 2>$null
if ($running -match "pvc-arvand") {
  Write-Host "Creating pre-update DB snapshot ..."
  docker compose exec -T pvc-arvand python -c @"
from pathlib import Path
import shutil
src = Path('/data/pvc_arvand.db')
dst = Path('$Snapshot')
dst.parent.mkdir(parents=True, exist_ok=True)
if src.is_file() and src.stat().st_size > 0:
    shutil.copy2(src, dst)
    print('wrote', dst)
else:
    print('no live database')
"@
  try {
    docker compose cp "pvc-arvand:$Snapshot" $BackupDir
    Write-Host "Host copy: $(Join-Path $BackupDir "pre_update_$Stamp.db")"
  } catch {
    Write-Host "Snapshot kept inside container volume only."
  }
}

git fetch origin
git pull --ff-only origin main
docker compose up -d --build
$Seed = Join-Path $Root "docs\plant-data\pvc_arvand_plant_seed.db"
$SeedIn = "/app/seed/pvc_arvand.db"
if (Test-Path $Seed) {
  Write-Host "Copying shutdown seed into the container ..."
  docker compose cp $Seed pvc-arvand:/tmp/pvc_arvand_plant_seed.db
  $SeedIn = "/tmp/pvc_arvand_plant_seed.db"
}
Write-Host "Loading committed shutdown tables into the server database ..."
docker compose exec -T pvc-arvand python -c "from app.shutdown_seed import apply_shutdown_tables; apply_shutdown_tables('/data/pvc_arvand.db', '$SeedIn')"
docker compose restart pvc-arvand
docker compose ps
Write-Host ""
Write-Host "Update finished. Volume pvc_arvand_data was preserved."
Write-Host "Shutdown tables were replaced from docs/plant-data/pvc_arvand_plant_seed.db."
Write-Host "Never run: docker compose down -v"
