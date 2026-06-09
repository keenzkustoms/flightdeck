from __future__ import annotations

import io
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont


@dataclass
class LabelStatus:
    available: bool
    model: str = "QL-700"
    label_size: str = "DK-22212 62mm continuous"
    last_error: Optional[str] = None
    backend: str = "brother_ql"
    printer_name: Optional[str] = None


class LabelPrinter:
    MODEL = "QL-700"
    LABEL_SIZE = "62"
    LABEL_WIDTH_PX = 696
    LABEL_HEIGHT_PX = 520
    VENDOR = "04f9"
    PRODUCT_PRINTER = "2042"
    PRODUCT_EDITOR_LITE = "2049"

    def __init__(self):
        self.last_error: Optional[str] = None
        self.backend = os.getenv("FLIGHTDECK_LABEL_PRINTER_MODEL", "brother_ql").strip().lower()
        self.printer_name = os.getenv("FLIGHTDECK_LABEL_PRINTER_NAME", "").strip()

    def status(self) -> LabelStatus:
        if self.backend in {"ausprint", "ausprint_pro", "ausprint-pro"}:
            return self._ausprint_status()
        return self._brother_status()

    def _brother_status(self) -> LabelStatus:
        self.last_error = None
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            self.last_error = str(exc)
            return LabelStatus(False, last_error=self.last_error, backend="brother_ql")
        printer_line = next((line for line in out.splitlines() if f"{self.VENDOR}:{self.PRODUCT_PRINTER}" in line), "")
        if printer_line:
            node = _usb_device_node(printer_line)
            if node and not os.access(node, os.R_OK | os.W_OK):
                return LabelStatus(False, last_error=f"QL-700 detected but USB permission denied for {node}", backend="brother_ql")
            return LabelStatus(True, backend="brother_ql", printer_name="usb://0x04f9:0x2042")
        if f"{self.VENDOR}:{self.PRODUCT_EDITOR_LITE}" in out:
            return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer", backend="brother_ql")
        return LabelStatus(False, last_error="Brother QL-700 not detected", backend="brother_ql")

    def _ausprint_status(self) -> LabelStatus:
        self.last_error = None
        display_name = self.printer_name or "AusPrint Pro"
        if os.name != "nt":
            self.last_error = "AusPrint Pro backend currently uses a Windows printer queue"
            return LabelStatus(False, model="AusPrint Pro", label_size="300DPI direct thermal", last_error=self.last_error, backend="ausprint_pro", printer_name=display_name)
        try:
            printers = _windows_printers()
        except Exception as exc:
            self.last_error = str(exc)
            return LabelStatus(False, model="AusPrint Pro", label_size="300DPI direct thermal", last_error=self.last_error, backend="ausprint_pro", printer_name=display_name)

        if self.printer_name.startswith("\\\\") and _windows_printer_is_valid(self.printer_name):
            return LabelStatus(True, model="AusPrint Pro", label_size="300DPI direct thermal", backend="ausprint_pro", printer_name=self.printer_name)

        wanted = _normalise_printer_name(self.printer_name)
        candidates = printers
        if wanted:
            candidates = [name for name in printers if wanted in _normalise_printer_name(name)]
        else:
            candidates = [name for name in printers if _looks_like_ausprint_queue(name)]
        if not candidates:
            candidates = [name for name in printers if _looks_like_ausprint_queue(name)]
        if candidates:
            name = candidates[0]
            return LabelStatus(True, model="AusPrint Pro", label_size="300DPI direct thermal", backend="ausprint_pro", printer_name=name)
        known = ", ".join(printers) if printers else "no printers installed"
        hint = _ausprint_device_hint()
        suffix = f"; {hint}" if hint else ""
        self.last_error = f"AusPrint Pro Windows printer queue not found ({known}){suffix}"
        return LabelStatus(False, model="AusPrint Pro", label_size="300DPI direct thermal", last_error=self.last_error, backend="ausprint_pro", printer_name=display_name)

    def render_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 430), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 21)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)

        x = 46
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = ""
        if not str(spool.get("location_printer_id") or "").strip():
            location = (
                spool.get("storage_location_name")
                or spool.get("storage_location")
                or "Storage"
            )
            location_line = f"Loc: {location}"
        draw.text((x, 42), _ellipsize(draw, material, font_bold, 420), fill="black", font=font_bold)
        draw.text((x, 116), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, 420), fill="black", font=font_body)
        draw.text((x, 168), _ellipsize(draw, color_name if include_colour else f"Spool #{spool.get('id', '-')}", font_body, 300), fill="black", font=font_body)
        if color_hex and include_colour:
            draw.text((x, 210), color_hex, fill="black", font=font_badge)
        draw.text((x, 258), f"Spool #{spool.get('id', '-')}", fill="black", font=font_badge)

        if location_line and include_location:
            draw.text((506, 42), "Loc:", fill="black", font=font_small)
            draw.text((506, 72), _ellipsize(draw, location_line[5:], font_body, 150), fill="black", font=font_body)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label weight  |  {added}"
        draw.text((x, 372), bottom, fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((152, 152)), (506, 218))
        else:
            draw.rectangle((506, 218, 658, 370), outline="black")
            draw.text((558, 276), "QR", fill="black", font=font_body)
        return img

    def print_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_spool_label(spool, base_url=base_url)
        if status.backend == "ausprint_pro":
            return self._print_ausprint_label(image, status.printer_name or self.printer_name or "AusPrint")
        try:
            from brother_ql.backends.helpers import send
            from brother_ql.conversion import convert
            from brother_ql.raster import BrotherQLRaster
        except Exception as exc:
            self.last_error = f"brother_ql unavailable: {exc}"
            return False

        try:
            qlr = BrotherQLRaster(self.MODEL)
            instructions = convert(qlr=qlr, images=[image], label=self.LABEL_SIZE, rotate="0", threshold=70.0, dither=False)
            send(instructions=instructions, printer_identifier="usb://0x04f9:0x2042", backend_identifier="pyusb", blocking=True)
            return True
        except Exception as exc:
            message = str(exc)
            if "Access denied" in message or "insufficient permissions" in message:
                message = "QL-700 USB permission denied; add the flightdeck user to lp or apply the Brother udev rule"
            self.last_error = message
            return False

    def _print_ausprint_label(self, image: Image.Image, printer_name: str) -> bool:
        if os.name != "nt":
            self.last_error = "AusPrint Pro printing is currently supported through a Windows printer queue"
            return False
        path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(prefix="flightdeck-label-", suffix=".png", delete=False) as tmp:
                path = Path(tmp.name)
            image.save(path)
            script = _windows_print_image_script(path, printer_name)
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                text=True,
                capture_output=True,
                timeout=30,
            )
            if proc.returncode != 0:
                self.last_error = (proc.stderr or proc.stdout or "AusPrint Pro print failed").strip()
                return False
            return True
        except Exception as exc:
            self.last_error = str(exc)
            return False
        finally:
            try:
                if path is not None:
                    path.unlink(missing_ok=True)
            except Exception:
                pass

    def print_test_label(self) -> bool:
        spool = {
            "id": "TEST",
            "material": "Flightdeck",
            "subtype": "Test",
            "brand": "AusPrint Pro" if self.backend in {"ausprint", "ausprint_pro", "ausprint-pro"} else "QL-700",
            "color_hex": "#ef4444",
            "color_name": "Ready",
            "label_weight_g": 1000,
            "added_at": datetime.utcnow().date().isoformat(),
        }
        return self.print_spool_label(spool)


def _font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def _ellipsize(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "...", font=font) > max_width:
        text = text[:-1]
    return text + "..."


def _luminance(hex_color: str) -> float:
    h = hex_color.replace("#", "")
    if len(h) < 6:
        return 0
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _qr_image(url: str) -> Optional[Image.Image]:
    try:
        import qrcode
        qr = qrcode.QRCode(border=1, box_size=4)
        qr.add_data(url)
        qr.make(fit=True)
        return qr.make_image(fill_color="black", back_color="white").convert("RGB")
    except Exception:
        return None


def _usb_device_node(lsusb_line: str) -> Optional[str]:
    match = re.match(r"Bus\s+(\d+)\s+Device\s+(\d+):", lsusb_line)
    if not match:
        return None
    return f"/dev/bus/usb/{match.group(1)}/{match.group(2)}"


def _windows_printers() -> list[str]:
    script = "Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json"
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        text=True,
        capture_output=True,
        timeout=10,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "Get-Printer failed").strip())
    import json

    raw = proc.stdout.strip()
    if not raw:
        return []
    data = json.loads(raw)
    if isinstance(data, str):
        return [data]
    if isinstance(data, list):
        return [str(item) for item in data if item]
    return []


def _normalise_printer_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def _looks_like_ausprint_queue(name: str) -> bool:
    normal = _normalise_printer_name(name)
    return any(term in normal for term in ("ausprint", "ausprintpro", "labelprinter"))


def _windows_printer_is_valid(printer_name: str) -> bool:
    printer = printer_name.replace("'", "''")
    script = rf"""
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = '{printer}'
$valid = $doc.PrinterSettings.IsValid
$doc.Dispose()
if ($valid) {{ 'true' }} else {{ 'false' }}
"""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            text=True,
            capture_output=True,
            timeout=10,
        )
        return proc.returncode == 0 and proc.stdout.strip().lower() == "true"
    except Exception:
        return False


def _ausprint_device_hint() -> str:
    script = r"""
Get-PnpDevice |
  Where-Object {
    $_.FriendlyName -match 'Aus|LabelPrinter|Label Printer|Thermal' -or
    $_.InstanceId -match 'USBPRINT'
  } |
  Select-Object -Property Status,Class,FriendlyName |
  ConvertTo-Json
"""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            text=True,
            capture_output=True,
            timeout=10,
        )
        if proc.returncode != 0:
            return ""
        import json

        raw = proc.stdout.strip()
        if not raw:
            return ""
        data = json.loads(raw)
        rows = data if isinstance(data, list) else [data]
        names = [
            str(row.get("FriendlyName") or "").strip()
            for row in rows
            if isinstance(row, dict) and str(row.get("FriendlyName") or "").strip()
        ]
        names = [
            name for name in names
            if re.search(r"aus|labelprinter|label printer|thermal", name, flags=re.I)
            and "surface thermal" not in name.lower()
        ]
        if names:
            return f"detected device: {', '.join(names[:4])}. Install the AusPrint Windows driver with the printer connected by USB so it appears as AUSPRINT or AUSPRINT-PRO in Windows Printers"
    except Exception:
        return ""
    return ""


def _windows_print_image_script(path: Path, printer_name: str) -> str:
    image_path = str(path).replace("'", "''")
    printer = printer_name.replace("'", "''")
    return rf"""
Add-Type -AssemblyName System.Drawing
$imagePath = '{image_path}'
$printerName = '{printer}'
$img = [System.Drawing.Image]::FromFile($imagePath)
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) {{
  throw "Printer queue not found: $printerName"
}}
$width = [Math]::Max(1, [int][Math]::Ceiling($img.Width * 100 / 300))
$height = [Math]::Max(1, [int][Math]::Ceiling($img.Height * 100 / 300))
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("FlightdeckLabel", $width, $height)
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$handler = [System.Drawing.Printing.PrintPageEventHandler] {{
  param($sender, $eventArgs)
  $eventArgs.Graphics.DrawImage($img, 0, 0, $eventArgs.PageBounds.Width, $eventArgs.PageBounds.Height)
  $eventArgs.HasMorePages = $false
}}
$doc.add_PrintPage($handler)
try {{
  $doc.Print()
}} finally {{
  $doc.Dispose()
  $img.Dispose()
}}
"""
