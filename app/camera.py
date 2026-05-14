from __future__ import annotations
import asyncio
import logging
from typing import Optional

log = logging.getLogger(__name__)

_IDLE_TIMEOUT = 60   # seconds before killing ffmpeg after last client leaves
_FRAME_START = b"\xff\xd8"
_FRAME_END   = b"\xff\xd9"


class BambuCameraProxy:
    """
    Lazy ffmpeg RTSP→MJPEG proxy for one Bambu printer.
    Spawns ffmpeg on first stream request; kills it 60 s after the last client leaves.
    Multiple concurrent clients share a single ffmpeg process.
    Requires RTSP on port 322 (X1C/P1 series). H2D uses a different protocol —
    see notes in TIER1_5_CAMERA_FEEDS.md.
    """

    def __init__(self, rtsp_url: str, printer_id: str):
        self._url = rtsp_url
        self._id = printer_id
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._reader: Optional[asyncio.Task] = None
        self._latest: Optional[bytes] = None
        self._clients: int = 0
        self._idle_task: Optional[asyncio.Task] = None

    # ── lifecycle ──────────────────────────────────────────────────────────

    async def _start(self) -> None:
        if self._proc and self._proc.returncode is None:
            return
        self._latest = None
        self._proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", self._url,
            "-f", "image2pipe", "-vcodec", "mjpeg",
            "-r", "10", "-q:v", "5",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        self._reader = asyncio.create_task(self._read_frames())
        log.info("camera ffmpeg started: %s", self._id)

    async def stop(self) -> None:
        if self._reader:
            self._reader.cancel()
            self._reader = None
        if self._proc:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except Exception:
                self._proc.kill()
            self._proc = None
        self._latest = None
        log.info("camera ffmpeg stopped: %s", self._id)

    async def _idle_shutdown(self) -> None:
        await asyncio.sleep(_IDLE_TIMEOUT)
        if self._clients == 0:
            await self.stop()

    # ── frame reader ───────────────────────────────────────────────────────

    async def _read_frames(self) -> None:
        """Continuously read stdout and extract JPEG frames."""
        buf = b""
        while self._proc and self._proc.returncode is None:
            try:
                chunk = await self._proc.stdout.read(65536)
                if not chunk:
                    break
                buf += chunk
                while True:
                    s = buf.find(_FRAME_START)
                    if s < 0:
                        buf = b""
                        break
                    e = buf.find(_FRAME_END, s + 2)
                    if e < 0:
                        buf = buf[s:]
                        break
                    self._latest = buf[s : e + 2]
                    buf = buf[e + 2 :]
            except Exception:
                break

    # ── streaming ──────────────────────────────────────────────────────────

    async def stream(self):
        """Async generator: yields multipart/x-mixed-replace MJPEG frames."""
        if self._idle_task:
            self._idle_task.cancel()
            self._idle_task = None

        await self._start()
        self._clients += 1

        for _ in range(50):
            if self._latest:
                break
            await asyncio.sleep(0.1)

        last_sent = None
        try:
            while True:
                frame = self._latest
                if frame is not None and frame is not last_sent:
                    last_sent = frame
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                        + frame + b"\r\n"
                    )
                await asyncio.sleep(0.1)   # ~10 fps
        finally:
            self._clients = max(0, self._clients - 1)
            if self._clients == 0:
                self._idle_task = asyncio.create_task(self._idle_shutdown())
