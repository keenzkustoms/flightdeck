from __future__ import annotations
import asyncio
import logging
import time
from typing import Optional

log = logging.getLogger(__name__)

_IDLE_TIMEOUT       = 60    # seconds before killing ffmpeg after last client leaves
_STALE_TIMEOUT      = 8     # seconds without a new frame before declaring stream dead
_INITIAL_TIMEOUT    = 10    # max seconds to wait for the very first frame after (re)start
_MAX_SESSION_LIFE   = 900   # 15 min — H2D firmware silently freezes long-lived RTSP sessions
_FRAME_START = b"\xff\xd8"
_FRAME_END   = b"\xff\xd9"
_STREAM_WIDTH = "960"
_STREAM_FPS = "5"
_STREAM_QUALITY = "7"


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
        self._watchdog_task: Optional[asyncio.Task] = None
        self._latest: Optional[bytes] = None
        self._last_frame_at: float = 0.0
        self._last_changed_at: float = 0.0
        self._last_frame_sig: Optional[tuple[int, int, int]] = None
        self._started_at: float = 0.0
        self._clients: int = 0
        self._idle_task: Optional[asyncio.Task] = None
        self._start_lock = asyncio.Lock()

    # ── lifecycle ──────────────────────────────────────────────────────────

    async def _start(self) -> None:
        async with self._start_lock:
            if self._proc and self._proc.returncode is None:
                return
            if self._reader and not self._reader.done():
                self._reader.cancel()
                self._reader = None
            self._latest = None
            self._last_frame_at = 0.0
            self._last_changed_at = 0.0
            self._last_frame_sig = None
            self._started_at = time.monotonic()
            self._proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-loglevel", "error",
                "-fflags", "nobuffer",
                "-flags", "low_delay",
                "-rtsp_transport", "tcp",
                "-i", self._url,
                "-vf", f"scale={_STREAM_WIDTH}:-2",
                "-f", "image2pipe", "-vcodec", "mjpeg",
                "-r", _STREAM_FPS, "-q:v", _STREAM_QUALITY,
                "pipe:1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            self._reader = asyncio.create_task(self._read_frames(self._proc))
            if not self._watchdog_task or self._watchdog_task.done():
                self._watchdog_task = asyncio.create_task(self._watchdog())
            log.info("camera ffmpeg started: %s", self._id)

    async def stop(self) -> None:
        if self._watchdog_task:
            self._watchdog_task.cancel()
            self._watchdog_task = None
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

    async def _watchdog(self) -> None:
        """Kill ffmpeg if no frames arrive — covers both stale streams and stuck reconnects.
        Also recycles the RTSP session periodically: H2D firmware silently freezes
        long-lived connections while continuing to send the same frame."""
        while True:
            await asyncio.sleep(5)
            if self._clients == 0:
                continue
            now = time.monotonic()
            if not self._proc or self._proc.returncode is not None:
                log.warning("camera worker missing while clients are watching, restarting: %s", self._id)
                await self._start()
                continue
            if self._last_frame_at == 0.0:
                if self._started_at > 0 and (now - self._started_at) > _INITIAL_TIMEOUT:
                    log.warning("camera no initial frame after %ds, restarting: %s", _INITIAL_TIMEOUT, self._id)
                    if self._proc:
                        try: self._proc.kill()
                        except Exception: pass
            elif (now - self._last_frame_at) > _STALE_TIMEOUT:
                log.warning("camera stale (%ds no frames), restarting: %s", _STALE_TIMEOUT, self._id)
                if self._proc:
                    try: self._proc.kill()
                    except Exception: pass
            elif (now - self._started_at) > _MAX_SESSION_LIFE:
                log.info("camera session max lifetime reached, recycling RTSP connection: %s", self._id)
                if self._proc:
                    try: self._proc.kill()
                    except Exception: pass

    # ── frame reader ───────────────────────────────────────────────────────

    async def _read_frames(self, proc: asyncio.subprocess.Process) -> None:
        """Continuously read stdout and extract JPEG frames. Auto-restarts on exit if clients remain."""
        buf = b""
        while proc.returncode is None:
            try:
                chunk = await proc.stdout.read(65536)
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
                    frame = buf[s : e + 2]
                    self._latest = frame
                    now = time.monotonic()
                    self._last_frame_at = now
                    sig = (len(frame), frame[32:64], frame[-64:])
                    if sig != self._last_frame_sig:
                        self._last_frame_sig = sig
                        self._last_changed_at = now
                    buf = buf[e + 2 :]
            except Exception:
                break

        # ffmpeg exited — restart if clients are still watching
        if self._proc is proc:
            self._proc = None
        if self._clients > 0 and self._reader and not self._reader.cancelled():
            log.warning("camera stream dropped, restarting in 3s: %s", self._id)
            await asyncio.sleep(3)
            await self._start()

    # ── streaming ──────────────────────────────────────────────────────────

    async def stream(self):
        """Async generator: yields multipart/x-mixed-replace MJPEG frames."""
        if self._idle_task:
            self._idle_task.cancel()
            self._idle_task = None

        self._clients += 1
        await self._start()

        for _ in range(50):
            if self._latest:
                break
            if not self._proc or self._proc.returncode is not None:
                await self._start()
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
