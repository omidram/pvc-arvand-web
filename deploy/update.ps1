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

$running = docker compose ps --status running --services 2>$null
if ($running -match "pvc-arvand") {
  $SnapshotHost = Join-Path $BackupDir "pre_update_$Stamp.db"
  Write-Host "Copying live DB to the host disk ..."
  docker compose cp "pvc-arvand:/data/pvc_arvand.db" $SnapshotHost
  if (-not $?) { Write-Host "Warning: could not copy the live database to the host." }
}

git fetch origin
git pull --ff-only origin main
docker compose up -d --build
Write-Host "Stopping the API before replacing shutdown tables ..."
docker compose stop pvc-arvand
$cid = (docker ps -aq --filter "name=^pvc-arvand$" | Select-Object -First 1)
$image = docker inspect -f "{{.Config.Image}}" $cid
Write-Host "Loading committed shutdown tables into the server database ..."
try {
  docker run --rm --volumes-from $cid --entrypoint python $image -c "from app.shutdown_seed import apply_shutdown_tables; apply_shutdown_tables('/data/pvc_arvand.db', '/app/seed/pvc_arvand.db')"
  if ($LASTEXITCODE -ne 0) { Write-Host "Shutdown load failed. Starting the API again." }
} catch {
  Write-Host "Shutdown load failed. Starting the API again."
} finally {
  docker start $cid
}
docker compose ps
Write-Host ""
Write-Host "Update finished. Volume pvc_arvand_data was preserved."
Write-Host "Shutdown tables were replaced from docs/plant-data/pvc_arvand_plant_seed.db."
Write-Host "Never run: docker compose down -v"
