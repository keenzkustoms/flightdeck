from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
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
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()

DEFAULT_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Flightdeck"
DATA_DIR = Path(os.environ.get("FLIGHTDECK_DATA_DIR", DEFAULT_DATA_DIR)).expanduser()
LOG_DIR = DATA_DIR / "logs"
URL = os.environ.get("FLIGHTDECK_URL", "http://127.0.0.1:8000")
HOST = os.environ.get("FLIGHTDECK_HOST", "127.0.0.1")
PORT = os.environ.get("FLIGHTDECK_PORT", "8000")


class FlightdeckTray:
    def __init__(self) -> None:
        self.process: subprocess.Popen | None = None
        self.icon: pystray.Icon | None = None
        self.status = "Starting"
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

    def open_dashboard(self, _icon=None, _item=None) -> None:
        webbrowser.open(URL)

    def open_logs(self, _icon=None, _item=None) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(LOG_DIR))

    def quit(self, icon=None, _item=None) -> None:
        self._monitor_stop.set()
        self.stop_server()
        (icon or self.icon).stop()

    def _is_http_ready(self) -> bool:
        try:
            with urllib.request.urlopen(f"{URL}/api/settings", timeout=1.5) as response:
                return response.status == 200
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
            self._refresh_icon()
            self._monitor_stop.wait(5)

    def _refresh_icon(self) -> None:
        if self.icon:
            self.icon.title = f"Flightdeck - {self.status}"
            self.icon.update_menu()

    def menu(self):
        return pystray.Menu(
            pystray.MenuItem(lambda _item: f"Flightdeck - {self.status}", None, enabled=False),
            pystray.MenuItem("Open Dashboard", self.open_dashboard, default=True),
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
    image = Image.new("RGBA", (64, 64), (10, 10, 15, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 14, 56, 50), radius=8, fill=(17, 24, 39, 255), outline=(59, 130, 246, 255), width=3)
    draw.polygon([(18, 34), (34, 18), (50, 34), (42, 34), (42, 44), (28, 44), (28, 34)], fill=(34, 197, 94, 255))
    return image


if __name__ == "__main__":
    FlightdeckTray().run()
