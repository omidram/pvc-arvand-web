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
