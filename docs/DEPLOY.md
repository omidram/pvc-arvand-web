# Deploying PVC Arvand

The application is one process: FastAPI serves both the REST API and the built
web UI on a single port (**8080** by default). There are two supported ways to
install it.

| Target | Package | Typical use |
|---|---|---|
| Windows 10 / 11 workstation | `PVCArvand-Setup.exe` | Double-click, install, run |
| Windows Server (or any Docker host) | Docker image via `docker compose` | Always-on plant server |

Default first login after a fresh install: **admin** / **admin123**. Change this
password immediately.

---

## 1. Windows installer (EXE)

### What the user gets

`packaging/output/PVCArvand-Windows.zip` is the file you copy to any Windows PC.

Inside the zip:

| File | What it does |
|---|---|
| `PVCArvand.exe` | Double-click to run (no install) |
| `Install-PVC-Arvand.bat` | Copies the app to this PC and creates Desktop + Start Menu shortcuts |
| `README.txt` | Short usage notes |

Steps:

1. Copy `PVCArvand-Windows.zip` to the target PC and extract it.
2. Double-click **Install-PVC-Arvand.bat** (recommended) or just **PVCArvand.exe**.
3. A small control window appears and the browser opens at `http://127.0.0.1:8080/`.
4. Sign in. Keep the control window open while you use the software. Closing it stops the program.

Plant data (SQLite database, automatic backups, signing key) is stored separately
in `%LOCALAPPDATA%\PVCArvand`, so deleting the program folder does **not** delete
records. Replacing the program files with a newer zip keeps that data.

A developer who has Inno Setup installed can also run `packaging/build_windows.ps1`
to produce a classic `PVCArvand-Setup.exe` wizard from `packaging/pvc_arvand.iss`.

### How to build the installer (developers)

On a Windows machine with Python 3.12, Node.js 20+, and the project venv:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

cd ..\frontend
npm install

cd ..\packaging
powershell -ExecutionPolicy Bypass -File .\build_windows.ps1
```

The script will:

1. Export the Next.js UI as static files.
2. Bundle Python + UI + seed database with PyInstaller into `PVCArvand.exe`.
3. Compile `PVCArvand-Setup.exe` with Inno Setup (downloaded automatically if it
   is not already installed).

---

## 2. Docker (Windows Server / Linux)

This is the recommended way to run PVC Arvand as a service on a server. The
image is a **Linux** container, which Docker Desktop and Windows Server (Docker
Engine with Linux containers) both support.

### Install Docker

- **Windows Server 2019/2022/2025:** install Docker Engine / Mirantis Container
  Runtime, or Docker Desktop, and use **Linux containers** (not Windows
  containers).
- **Windows 10/11:** Docker Desktop.

Confirm:

```powershell
docker version
docker compose version
```

### Build and start

From the project root (the folder that contains `docker-compose.yml`):

```powershell
docker compose up -d --build
```

Then open `http://SERVER-IP:8080/` in a browser.

Data is stored in the named volume `pvc_arvand_data`. Automatic backups written
from **Settings → Backup** land inside that volume as well.

**Important — plant data survives updates only if you keep the volume:**

- Update with `bash deploy/update.sh` or `deploy/update.ps1` (backs up DB, then rebuilds).
- Do **not** run `docker compose down -v` — the `-v` flag deletes all plant records.
- Do **not** delete `%LOCALAPPDATA%\PVCArvand` on Windows EXE installs (that is the live DB).
- Replacing program files / rebuilding the image does **not** wipe the volume by itself.

### Useful commands

```powershell
docker compose logs -f          # follow logs
docker compose restart          # restart the service
docker compose down             # stop (data volume is kept)
docker compose pull             # (if you later host the image on a registry)
```

### Changing the published port

Edit `docker-compose.yml`:

```yaml
ports:
  - "80:8080"    # example: expose as http://server/
```

### Backing up the Docker volume

```powershell
docker run --rm -v pvc_arvand_web_pvc_arvand_data:/data -v ${PWD}:/backup alpine tar czf /backup/pvc-arvand-data.tgz -C /data .
```

The in-app **Settings → Backup** tab is usually enough for daily plant backups.

### ARIAORMS voltage sync (Ubuntu)

ARIAORMS at `http://192.168.20.12:8080/LogSheetsReports.aspx` writes electrolyzer
voltage log sheets to Excel. PVC Arvand watches a folder and **upserts** those
rows into **Standardized Voltage** by electrolyzer + date + time slot.

1. On the Ubuntu host, create a shared export folder (default compose mount):

```bash
mkdir -p ./ariaorms_exports
```

2. In ARIAORMS: **VIEW LOGSHEETS** → pick electrolyzer / date range → **Excel**,
   and save the file into that folder (same file name can be overwritten; changes
   are detected by size/mtime/hash).

3. In PVC Arvand: **Settings → ARIAORMS Voltage Sync** → enable automatic sync
   (poll every 30s by default). Watch folder inside the container is
   `/data/ariaorms_exports`.

4. Or click **Sync Now** / **Upload Excel once** for a manual upsert.

Optional `.env`:

```bash
ARIAORMS_EXPORT_DIR=/var/lib/ariaorms/exports
```

### Access import on the server

`.mdb` Access import needs the Microsoft Access ODBC driver, which is not in the
Linux image. On the server, import Excel (`.xlsx`) instead, or import Access on
a Windows workstation and copy the SQLite file into the Docker volume.

---

## 3. Security checklist before production

1. Sign in as admin and **change the password**.
2. Prefer HTTPS in front of Docker (IIS / nginx / Traefik reverse proxy).
3. Restrict who can reach port 8080 on the server (firewall / VLAN).
4. Do not commit `backend/.env` with real secrets; Docker generates a JWT
   secret into `/data/jwt_secret.txt` on first start.

---

## 4. Debian server from GitHub

Use this when the server only has SSH. The app stays on GitHub; the server
pulls it. Plant data stays in the Docker volume `pvc_arvand_data` across updates.

### First time (on the Debian server)

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/omidram/pvc-arvand-web.git
cd pvc-arvand-web
bash deploy/install.sh
```

Open `http://SERVER-IP:8080/` and sign in. Change the password in the UI.

Optional, before the first start, edit `.env` (created from `deploy/env.example`)
to set `DEFAULT_ADMIN_PASSWORD` and `APP_PUBLISH_PORT`.

If Docker was just installed and compose says permission denied, log out of SSH
and back in, then run `bash deploy/install.sh` again.

### Every later update

On your PC: commit and `git push`.

On the server:

```bash
cd pvc-arvand-web
bash deploy/update.sh
```

That pulls `main` and rebuilds the container. It does not delete the database.

### Useful commands on the server

```bash
docker compose logs -f --tail 100
docker compose restart
docker compose down          # stops the app, keeps the data volume
```

If `ufw` is enabled:

```bash
sudo ufw allow 8080/tcp
```

