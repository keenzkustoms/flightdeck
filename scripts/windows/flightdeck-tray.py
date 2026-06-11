from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

import pystray
from PIL import Image, ImageDraw


APP_DIR = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    env_path = APP_DIR / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = _clean_env_value(value)
        if key and key not in os.environ:
            os.environ[key] = value


def _clean_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


_load_dotenv()

DEFAULT_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Flightdeck"
DATA_DIR = Path(os.environ.get("FLIGHTDECK_DATA_DIR", DEFAULT_DATA_DIR)).expanduser()
LOG_DIR = DATA_DIR / "logs"
URL = os.environ.get("FLIGHTDECK_URL", "http://127.0.0.1:8000")
HOST = os.environ.get("FLIGHTDECK_HOST", "127.0.0.1")
PORT = os.environ.get("FLIGHTDECK_PORT", "8000")
SIDECAR_CMD = os.environ.get("FLIGHTDECK_SLICER_SIDECAR_CMD", "").strip()
SIDECAR_URL = os.environ.get("FLIGHTDECK_SLICER_SIDECAR_URL", "http://127.0.0.1:3003").strip().rstrip("/")


class FlightdeckTray:
    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.sidecar_process: subprocess.Popen | None = None
        self.icon: pystray.Icon | None = None
        self.status = "Starting"
        self.sidecar_status = "Off" if not SIDECAR_CMD else "Starting"
        self._sidecar_manual_stop = False
        self._monitor_stop = threading.Event()

    def start_server(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / "uploads").mkdir(exist_ok=True)
        (DATA_DIR / "print_library").mkdir(exist_ok=True)
        LOG_DIR.mkdir(exist_ok=True)
        env = os.environ.copy()
        env.setdefault("FLIGHTDECK_RUNTIME", "windows")
        env.setdefault("FLIGHTDECK_SERVICE_MANAGER", "Windows tray")
        env.setdefault("FLIGHTDECK_INSTANCE_NAME", "Windows")
        env.setdefault("FLIGHTDECK_DATA_DIR", str(DATA_DIR))
        env.setdefault("FLIGHTDECK_PRINT_LIBRARY", str(DATA_DIR / "print_library"))
        python_exe = Path(sys.executable).with_name("python.exe")
        if not python_exe.exists():
            python_exe = Path(sys.executable)
        log_path = LOG_DIR / "flightdeck.log"
        log = log_path.open("a", encoding="utf-8")
        self.process = subprocess.Popen(
            [
                str(python_exe),
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                HOST,
                "--port",
                PORT,
            ],
            cwd=str(APP_DIR),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.status = "Starting"
        self._refresh_icon()
        self.start_sidecar()

    def stop_server(self) -> None:
        proc = self.process
        if not proc or proc.poll() is not None:
            self.process = None
            self.status = "Stopped"
            self._refresh_icon()
            return
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()
        self.process = None
        self.status = "Stopped"
        self._refresh_icon()

    def restart_server(self, _icon=None, _item=None) -> None:
        self.stop_server()
        self.start_server()

    def start_sidecar(self, _icon=None, _item=None) -> None:
        self._sidecar_manual_stop = False
        if not SIDECAR_CMD:
            self.sidecar_status = "Not configured"
            self._refresh_icon()
            return
        proc = self.sidecar_process
        if proc and proc.poll() is None:
            self.sidecar_status = "Running" if self._is_sidecar_ready() else "Starting"
            self._refresh_icon()
            return

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / "slicer-sidecar.log"
        log = log_path.open("a", encoding="utf-8")
        log.write(f"\n[{datetime.now().isoformat(timespec='seconds')}] Starting slicer sidecar\n{SIDECAR_CMD}\n")
        log.flush()
        try:
            self.sidecar_process = subprocess.Popen(
                SIDECAR_CMD,
                cwd=str(APP_DIR),
                env=os.environ.copy(),
                stdout=log,
                stderr=subprocess.STDOUT,
                shell=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            self.sidecar_status = "Starting"
        except Exception as exc:
            log.write(f"[{datetime.now().isoformat(timespec='seconds')}] Sidecar start failed: {exc}\n")
            self.sidecar_process = None
            self.sidecar_status = "Start failed"
        self._refresh_icon()

    def stop_sidecar(self, _icon=None, _item=None) -> None:
        self._sidecar_manual_stop = True
        proc = self.sidecar_process
        if not proc or proc.poll() is not None:
            self.sidecar_process = None
            self.sidecar_status = "Stopped" if SIDECAR_CMD else "Not configured"
            self._refresh_icon()
            return
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()
        self.sidecar_process = None
        self.sidecar_status = "Stopped"
        self._refresh_icon()

    def update_from_github(self, _icon=None, _item=None) -> None:
        threading.Thread(target=self._update_from_github_worker, daemon=True).start()

    def _update_from_github_worker(self) -> None:
        self.status = "Updating"
        self._refresh_icon()
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / "flightdeck-update.log"
        try:
            dirty = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(APP_DIR),
                text=True,
                capture_output=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            if dirty.returncode != 0:
                raise RuntimeError((dirty.stderr or dirty.stdout or "git status failed").strip())
            if dirty.stdout.strip():
                raise RuntimeError("Local changes are present. Update skipped.")

            branch = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=str(APP_DIR),
                text=True,
                capture_output=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            branch_name = (branch.stdout or "").strip()
            if branch.returncode != 0 or not branch_name or branch_name == "HEAD":
                raise RuntimeError((branch.stderr or "Flightdeck is not on a named Git branch.").strip())

            pull = subprocess.run(
                ["git", "pull", "--ff-only", "origin", branch_name],
                cwd=str(APP_DIR),
                text=True,
                capture_output=True,
                timeout=120,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            output = (pull.stdout or pull.stderr or "").strip()
            if pull.returncode != 0:
                raise RuntimeError(output or "git pull failed")

            with log_path.open("a", encoding="utf-8") as log:
                log.write(f"\n[{datetime.now().isoformat(timespec='seconds')}] Update OK\n{output}\n")
            self.restart_server()
            self.status = "Updated"
            self._refresh_icon()
            webbrowser.open(URL)
        except Exception as exc:
            with log_path.open("a", encoding="utf-8") as log:
                log.write(f"\n[{datetime.now().isoformat(timespec='seconds')}] Update failed\n{exc}\n")
            self.status = "Update failed"
            self._refresh_icon()

    def open_dashboard(self, _icon=None, _item=None) -> None:
        webbrowser.open(URL)

    def open_logs(self, _icon=None, _item=None) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(LOG_DIR))

    def quit(self, icon=None, _item=None) -> None:
        self._monitor_stop.set()
        self.stop_sidecar()
        self.stop_server()
        (icon or self.icon).stop()

    def _is_http_ready(self) -> bool:
        try:
            with urllib.request.urlopen(f"{URL}/api/settings", timeout=1.5) as response:
                return response.status == 200
        except Exception:
            return False

    def _is_sidecar_ready(self) -> bool:
        if not SIDECAR_CMD or not SIDECAR_URL:
            return False
        try:
            with urllib.request.urlopen(f"{SIDECAR_URL}/health", timeout=1.5) as response:
                return 200 <= response.status < 400
        except Exception:
            return False

    def monitor(self) -> None:
        while not self._monitor_stop.is_set():
            proc = self.process
            if proc is None:
                self.status = "Stopped"
            elif proc.poll() is not None:
                self.status = "Stopped"
                self.process = None
            elif self._is_http_ready():
                self.status = "Running"
            else:
                self.status = "Starting"

            if SIDECAR_CMD:
                sidecar = self.sidecar_process
                if sidecar is None or sidecar.poll() is not None:
                    self.sidecar_status = "Stopped"
                    if not self._sidecar_manual_stop:
                        self.start_sidecar()
                elif self._is_sidecar_ready():
                    self.sidecar_status = "Running"
                else:
                    self.sidecar_status = "Starting"
            self._refresh_icon()
            self._monitor_stop.wait(5)

    def _refresh_icon(self) -> None:
        if self.icon:
            sidecar = f" / Slicer {self.sidecar_status}" if SIDECAR_CMD else ""
            self.icon.title = f"Flightdeck - {self.status}{sidecar}"
            self.icon.update_menu()

    def menu(self):
        sidecar_items = []
        if SIDECAR_CMD:
            sidecar_items = [
                pystray.MenuItem(lambda _item: f"Slicer sidecar - {self.sidecar_status}", None, enabled=False),
                pystray.MenuItem("Restart Slicer Sidecar", lambda icon, item: (self.stop_sidecar(), self.start_sidecar())),
                pystray.MenuItem("Stop Slicer Sidecar", self.stop_sidecar),
            ]
        return pystray.Menu(
            pystray.MenuItem(lambda _item: f"Flightdeck - {self.status}", None, enabled=False),
            *sidecar_items,
            pystray.MenuItem("Open Dashboard", self.open_dashboard, default=True),
            pystray.MenuItem("Update from GitHub", self.update_from_github),
            pystray.MenuItem("Restart", self.restart_server),
            pystray.MenuItem("Open Logs", self.open_logs),
            pystray.MenuItem("Stop", lambda icon, item: self.stop_server()),
            pystray.MenuItem("Exit", self.quit),
        )

    def run(self) -> None:
        self.start_server()
        self.icon = pystray.Icon("Flightdeck", _tray_image(), "Flightdeck", self.menu())
        threading.Thread(target=self.monitor, daemon=True).start()
        self.icon.run()


def _tray_image() -> Image.Image:
    icon_path = APP_DIR / "app" / "static" / "icon-192.png"
    if icon_path.exists():
        return Image.open(icon_path).convert("RGBA").resize((64, 64), Image.LANCZOS)

    image = Image.new("RGBA", (64, 64), (10, 10, 15, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 14, 56, 50), radius=8, fill=(17, 24, 39, 255), outline=(59, 130, 246, 255), width=3)
    draw.polygon([(18, 34), (34, 18), (50, 34), (42, 34), (42, 44), (28, 44), (28, 34)], fill=(34, 197, 94, 255))
    return image


if __name__ == "__main__":
    FlightdeckTray().run()
