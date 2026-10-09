from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ImageChops, ImageDraw, ImageFont


@dataclass
class LabelStatus:
    available: bool
    model: str = "QL-700"
    label_size: str = "DK-22212 62mm continuous"
    last_error: Optional[str] = None
    backend: str = "brother_ql"
    printer_name: Optional[str] = None


AUSPRINT_BACKENDS = {"ausprint", "ausprint_pro", "ausprint-pro"}


class LabelPrinter:
    """Spool and rack label printing.

    Backends (FLIGHTDECK_LABEL_PRINTER_MODEL):
      brother_ql   - Brother QL-700. On Linux it talks USB directly through brother_ql;
                     on Windows it prints through the installed Windows printer queue
                     named by FLIGHTDECK_LABEL_PRINTER_NAME (default: any QL-700 queue).
      ausprint_pro - AusPrint Pro 300DPI direct thermal printer through its Windows queue.
    """
    MODEL = "QL-700"
    LABEL_SIZE = "62"
    LABEL_WIDTH_PX = 696
    SPOOL_LABEL_HEIGHT_PX = 340
    LABEL_HEIGHT_PX = 520
    VENDOR = "04f9"
    PRODUCT_PRINTER = "2042"
    PRODUCT_EDITOR_LITE = "2049"

    def __init__(self):
        self.last_error: Optional[str] = None
        self.backend = os.getenv("FLIGHTDECK_LABEL_PRINTER_MODEL", "brother_ql").strip().lower()
        self.printer_name = os.getenv("FLIGHTDECK_LABEL_PRINTER_NAME", "").strip()

    def status(self) -> LabelStatus:
        if self.backend in AUSPRINT_BACKENDS:
            return self._ausprint_status()
        if os.name == "nt":
            return self._brother_windows_status()
        return self._brother_status()

    def _brother_status(self) -> LabelStatus:
        self.last_error = None
        if not shutil.which("lsusb"):
            return self._status_pyusb()
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            pyusb_status = self._status_pyusb()
            if pyusb_status.available or pyusb_status.last_error:
                return pyusb_status
            self.last_error = _friendly_usb_error(exc)
            return LabelStatus(False, last_error=self.last_error)
        printer_line = next((line for line in out.splitlines() if f"{self.VENDOR}:{self.PRODUCT_PRINTER}" in line), "")
        if printer_line:
            node = _usb_device_node(printer_line)
            if node and not os.access(node, os.R_OK | os.W_OK):
                return LabelStatus(False, last_error=f"QL-700 detected but USB permission denied for {node}")
            return LabelStatus(True)
        if f"{self.VENDOR}:{self.PRODUCT_EDITOR_LITE}" in out:
            return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer")
        return LabelStatus(False, last_error="Brother QL-700 not detected")

    def _status_pyusb(self) -> LabelStatus:
        try:
            import usb.core
        except Exception as exc:
            self.last_error = f"PyUSB unavailable for QL-700 detection: {exc}"
            return LabelStatus(False, last_error=self.last_error)
        try:
            printer = usb.core.find(idVendor=int(self.VENDOR, 16), idProduct=int(self.PRODUCT_PRINTER, 16))
            if printer is not None:
                return LabelStatus(True)
            editor_lite = usb.core.find(idVendor=int(self.VENDOR, 16), idProduct=int(self.PRODUCT_EDITOR_LITE, 16))
            if editor_lite is not None:
                return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer")
        except Exception as exc:
            self.last_error = _friendly_usb_error(exc)
            return LabelStatus(False, last_error=self.last_error)
        self.last_error = "Brother QL-700 not detected"
        return LabelStatus(False, last_error=self.last_error)

    def _brother_windows_status(self) -> LabelStatus:
        self.last_error = None
        display_name = self.printer_name or "QL-700"
        try:
            printers = _windows_printers()
        except Exception as exc:
            self.last_error = str(exc)
            return LabelStatus(False, last_error=self.last_error, printer_name=display_name)

        if self.printer_name.startswith("\\\\") and _windows_printer_is_valid(self.printer_name):
            return LabelStatus(True, printer_name=self.printer_name)

        wanted = _normalise_printer_name(self.printer_name)
        if wanted:
            candidates = [name for name in printers if wanted in _normalise_printer_name(name)]
        else:
            candidates = [name for name in printers if _looks_like_brother_ql_queue(name)]
        if not candidates:
            candidates = [name for name in printers if _looks_like_brother_ql_queue(name)]
        if candidates:
            return LabelStatus(True, printer_name=candidates[0])

        known = ", ".join(printers) if printers else "no printers installed"
        hint = _brother_device_hint()
        suffix = f"; {hint}" if hint else ""
        self.last_error = f"Brother QL-700 Windows printer queue not found ({known}){suffix}"
        return LabelStatus(False, last_error=self.last_error, printer_name=display_name)

    def _ausprint_status(self) -> LabelStatus:
        self.last_error = None
        display_name = self.printer_name or "AusPrint Pro"
        base = dict(model="AusPrint Pro", label_size="300DPI direct thermal", backend="ausprint_pro")
        if os.name != "nt":
            self.last_error = "AusPrint Pro backend currently uses a Windows printer queue"
            return LabelStatus(False, last_error=self.last_error, printer_name=display_name, **base)
        try:
            printers = _windows_printers()
        except Exception as exc:
            self.last_error = str(exc)
            return LabelStatus(False, last_error=self.last_error, printer_name=display_name, **base)

        if self.printer_name.startswith("\\\\") and _windows_printer_is_valid(self.printer_name):
            return LabelStatus(True, printer_name=self.printer_name, **base)

        wanted = _normalise_printer_name(self.printer_name)
        if wanted:
            candidates = [name for name in printers if wanted in _normalise_printer_name(name)]
        else:
            candidates = [name for name in printers if _looks_like_ausprint_queue(name)]
        if not candidates:
            candidates = [name for name in printers if _looks_like_ausprint_queue(name)]
        if candidates:
            return LabelStatus(True, printer_name=candidates[0], **base)
        known = ", ".join(printers) if printers else "no printers installed"
        hint = _ausprint_device_hint()
        suffix = f"; {hint}" if hint else ""
        self.last_error = f"AusPrint Pro Windows printer queue not found ({known}){suffix}"
        return LabelStatus(False, last_error=self.last_error, printer_name=display_name, **base)

    def render_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        # Spool labels stay full-size; rack/location labels use their own compact layout.
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, self.SPOOL_LABEL_HEIGHT_PX), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 38)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 19)
        number_text = str(display_id)

        x = 38
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = _spool_label_location_text(spool)
        draw.text((x, 12), _ellipsize(draw, material, font_bold, 420), fill="black", font=font_bold)
        draw.text((x, 48), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, 420), fill="black", font=font_body)
        if include_colour:
            colour_line = color_name
            if color_hex:
                colour_line = f"{colour_line} {color_hex}"
            draw.text((x, 78), _ellipsize(draw, colour_line, font_body, 420), fill="black", font=font_body)

        box = (x, 128, x + 182, 288)
        draw.rounded_rectangle(box, radius=14, outline="black", width=4)
        font_number = _hero_number_font(draw, number_text, max_width=box[2] - box[0] - 24)
        _draw_text_centered_in_box(draw, number_text, box, font_number)

        if location_line and include_location:
            draw.text((506, 12), "Loc:", fill="black", font=font_small)
            loc_font = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
            draw.text((506, 38), _ellipsize(draw, location_line, loc_font, 150), fill="black", font=loc_font)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label  |  {added}"
        draw.text((x, 296), bottom, fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        qr_size = 136
        qr_y = 148
        if qr:
            img.paste(qr.resize((qr_size, qr_size)), (506, qr_y))
        else:
            draw.rectangle((506, qr_y, 506 + qr_size, qr_y + qr_size), outline="black")
            draw.text((558, qr_y + 52), "QR", fill="black", font=font_body)
        return img

    def render_compact_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        """Short rack-position strip for a numbered cupboard slot."""
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 210), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_number = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 86)
        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)

        x = 28
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = _rack_spool_label_location_text(spool)

        draw.rounded_rectangle((x, 26, 178, 178), radius=14, outline="black", width=3)
        number_text = f"{display_id}"
        bbox = draw.textbbox((0, 0), number_text, font=font_number)
        draw.text((x + (150 - (bbox[2] - bbox[0])) / 2, 54), number_text, fill="black", font=font_number)

        info_x = 202
        info_width = 280
        draw.text((info_x, 24), _ellipsize(draw, material, font_title, info_width), fill="black", font=font_title)
        draw.text((info_x, 68), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, info_width), fill="black", font=font_body)
        colour_line = color_name if include_colour else f"Spool #{display_id}"
        if color_hex and include_colour:
            colour_line = f"{colour_line}  {color_hex}"
        draw.text((info_x, 102), _ellipsize(draw, colour_line, font_body, info_width), fill="black", font=font_body)

        if location_line and include_location:
            draw.rounded_rectangle((info_x, 142, info_x + info_width, 176), radius=8, outline="black", width=2)
            draw.text((info_x + 12, 147), _ellipsize(draw, location_line, font_badge, info_width - 24), fill="black", font=font_badge)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label | {added}"
        draw.text((x, 184), _ellipsize(draw, bottom, font_small, 455), fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((160, 160)), (512, 26))
        else:
            draw.rectangle((512, 26, 672, 186), outline="black")
            draw.text((570, 92), "QR", fill="black", font=font_body)
        return img

    def print_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        if os.name == "nt" and status.backend == "brother_ql" and _ql700_compact_label_enabled():
            image = _prepare_compact_ql700_label(self.render_compact_ql700_label(spool, base_url=base_url))
            return self._print_windows_label(image, status.printer_name or self.printer_name or "QL-700", "Brother QL-700")
        image = self.render_spool_label(spool, base_url=base_url)
        return self._print_image(image, status)

    def print_compact_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_compact_spool_label(spool, base_url=base_url)
        return self._print_image(image, status)

    def render_location_label(self, location: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 190), "white")
        draw = ImageDraw.Draw(img)
        name = str(location.get("name") or "Rack").strip() or "Rack"
        notes = str(location.get("notes") or "").strip()
        rack_range, rack_direction = _rack_label_parts(name, notes)
        title = f"Rack {rack_range}" if rack_range else name
        row_name = re.sub(r"\s*[·-]\s*\d+\s*-\s*\d+\s*$", "", name).strip() or "Rack"

        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        font_row = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)

        draw.text((34, 20), _ellipsize(draw, title, font_title, 430), fill="black", font=font_title)
        draw.text((36, 78), _ellipsize(draw, row_name, font_row, 430), fill="black", font=font_row)
        subtitle = rack_direction or notes or "Scan to open this rack in Flightdeck"
        draw.text((36, 108), _ellipsize(draw, subtitle, font_body, 430), fill="black", font=font_body)
        draw.rounded_rectangle((36, 140, 250, 173), radius=8, outline="black", width=2)
        draw.text((48, 147), "FLIGHTDECK RACK", fill="black", font=font_badge)
        draw.text((276, 149), datetime.utcnow().strftime("%d/%m/%y"), fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        loc_id = location.get("id")
        qr_url = f"{qr_base}/#/spools?view=cabinet"
        if loc_id is not None:
            qr_url += f"&location={loc_id}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((150, 150)), (512, 20))
        else:
            draw.rectangle((512, 20, 662, 170), outline="black")
            draw.text((568, 84), "QR", fill="black", font=font_body)
        return img

    def print_location_label(self, location: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_location_label(location, base_url=base_url)
        return self._print_image(image, status)

    def render_drawer_banner(self, drawer: int) -> Image.Image:
        """Large face sticker: DRAWER D1 / SPOOLS 1–27."""
        drawer = int(drawer)
        first, last = _drawer_number_range(drawer)
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 280), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle((8, 8, self.LABEL_WIDTH_PX - 9, 271), outline="black", width=4)
        title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
        body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 52)
        small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
        _draw_centered(draw, f"DRAWER D{drawer}", 28, title)
        _draw_centered(draw, f"SPOOLS  {first} – {last}", 120, body)
        _draw_centered(draw, "9 per row  ·  3 rows", 200, small)
        return img

    def render_drawer_row_label(self, drawer: int, row: int) -> Image.Image:
        """Row strip: D1 · ROW 1 + 1 2 3 … 9 left→right."""
        drawer = int(drawer)
        row = int(row)
        numbers = _drawer_row_numbers(drawer, row)
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 220), "white")
        draw = ImageDraw.Draw(img)
        pad = 16
        draw.rectangle((8, 8, self.LABEL_WIDTH_PX - 9, 211), outline="black", width=3)
        title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        _draw_centered(draw, f"D{drawer}  ·  ROW {row}", 24, title)

        # Fit nine numbers inside the border — two/three-digit rows need a smaller size.
        inner_left = pad + 8
        inner_right = self.LABEL_WIDTH_PX - pad - 8
        max_width = inner_right - inner_left
        nums_font = None
        line = ""
        for size in (36, 32, 28, 26, 24, 22, 20):
            candidate = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
            # Prefer even column layout; fall back to spaced string that fits.
            gap = "  "
            line = gap.join(str(n) for n in numbers)
            if draw.textlength(line, font=candidate) <= max_width:
                nums_font = candidate
                break
        if nums_font is None:
            nums_font = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
            line = " ".join(str(n) for n in numbers)

        # Draw as equal columns so wide digits never clip the outline.
        col_w = max_width / len(numbers)
        for i, n in enumerate(numbers):
            text = str(n)
            tw = draw.textlength(text, font=nums_font)
            x = inner_left + i * col_w + (col_w - tw) / 2
            draw.text((x, 102), text, fill="black", font=nums_font)

        _draw_centered(draw, "left → right", 168, small)
        return img

    def render_home_slot_label(self, location: dict) -> Image.Image:
        """Single home marker for an empty drawer slot (D2 R2 #42)."""
        name = str(location.get("name") or "").strip()
        match = re.match(r"^D([1-6]) R([1-3]) #(\d{1,3})$", name)
        if not match:
            # Fall back to generic location label if not a drawer slot.
            return self.render_location_label(location)
        drawer, row, number = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 210), "white")
        draw = ImageDraw.Draw(img)
        box = (24, 24, 200, 186)
        draw.rounded_rectangle(box, radius=14, outline="black", width=4)
        number_text = str(number)
        font_number = _hero_number_font(draw, number_text, max_width=box[2] - box[0] - 24)
        _draw_text_centered_in_box(draw, number_text, box, font_number)
        draw.text((230, 40), "HOME", fill="black", font=_font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28))
        draw.text(
            (230, 90),
            name,
            fill="black",
            font=_font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44),
        )
        draw.text(
            (230, 150),
            f"Drawer {drawer}  ·  Row {row}",
            fill="black",
            font=_font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22),
        )
        return img

    def print_drawer_banner(self, drawer: int) -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        return self._print_image(self.render_drawer_banner(drawer), status)

    def print_drawer_row_label(self, drawer: int, row: int) -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        return self._print_image(self.render_drawer_row_label(drawer, row), status)

    def print_home_slot_label(self, location: dict) -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        return self._print_image(self.render_home_slot_label(location), status)

    def _print_image(self, image: Image.Image, status: Optional[LabelStatus] = None) -> bool:
        if status is None:
            status = self.status()
        if status.backend == "ausprint_pro":
            return self._print_windows_label(image, status.printer_name or self.printer_name or "AusPrint", "AusPrint Pro")
        if os.name == "nt":
            image = _prepare_windows_label_image(image, model_name="Brother QL-700")
            return self._print_windows_label(image, status.printer_name or self.printer_name or "QL-700", "Brother QL-700")
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
            elif "No backend available" in message:
                message = "QL-700 USB backend unavailable. On Windows, install a WinUSB/libusb driver for the QL-700 with Zadig, or connect the label printer to the Pi/NAS."
            self.last_error = message
            return False

    def _print_windows_label(self, image: Image.Image, printer_name: str, model_name: str) -> bool:
        """Print through a Windows printer queue using System.Drawing from PowerShell."""
        if os.name != "nt":
            self.last_error = f"{model_name} Windows printing is currently supported through a Windows printer queue"
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
                self.last_error = (proc.stderr or proc.stdout or f"{model_name} print failed").strip()
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

    def render_compact_ql700_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        """Compact spool label tuned for QL-700 62mm paper on Windows (FLIGHTDECK_LABEL_PAPER_NAME)."""
        if _ql700_compact_62mm_enabled():
            try:
                compact_length_mm = float(os.getenv("FLIGHTDECK_LABEL_COMPACT_LENGTH_MM", "35"))
            except ValueError:
                compact_length_mm = 35.0
            compact_length_px = max(330, int(round(compact_length_mm / 25.4 * 300)))
            img = Image.new("RGB", (732, compact_length_px), "white")
            qr_size = 205
            qr_xy = (500, 102)
            loc_x = 500
            left_default = 30
            title_width = 400
        else:
            img = Image.new("RGB", (696, 330), "white")
            qr_size = 190
            qr_xy = (470, 104)
            loc_x = 420
            left_default = 58
            title_width = 382
        draw = ImageDraw.Draw(img)
        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)

        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        storage = _spool_label_location_text(spool)
        display_id = spool.get("display_id") or spool.get("id") or "-"
        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")

        try:
            x = int(os.getenv("FLIGHTDECK_LABEL_COMPACT_LEFT_PAD_PX", str(left_default)))
        except ValueError:
            x = left_default
        draw.text((x, 26), _ellipsize(draw, material, font_title, title_width), fill="black", font=font_title)
        draw.text((x, 86), _ellipsize(draw, brand, font_body, max(260, title_width - 50)), fill="black", font=font_body)
        draw.text((x, 128), _ellipsize(draw, color_name, font_body, max(220, title_width - 110)), fill="black", font=font_body)
        if color_hex:
            draw.text((x, 170), color_hex, fill="black", font=font_bold)
        draw.text((x, 218), f"Spool #{display_id}", fill="black", font=font_bold)
        draw.text((x, 276), f"{round(float(spool.get('label_weight_g') or 0))}g | {added}", fill="black", font=font_small)
        draw.text((loc_x, 32), "Loc:", fill="black", font=font_small)
        draw.text((loc_x, 58), _ellipsize(draw, storage, font_body, 130), fill="black", font=font_body)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr = _qr_image(f"{qr_base}/#/spool/{spool.get('id')}")
        if qr:
            img.paste(qr.resize((qr_size, qr_size)), qr_xy)
        else:
            draw.rectangle((qr_xy[0], qr_xy[1], qr_xy[0] + qr_size, qr_xy[1] + qr_size), outline="black")
            draw.text((qr_xy[0] + 65, qr_xy[1] + 76), "QR", fill="black", font=font_body)
        img.info["dpi"] = (300, 300)
        return img

    def print_test_label(self) -> bool:
        spool = {
            "id": "TEST",
            "material": "Flightdeck",
            "subtype": "Test",
            "brand": "AusPrint Pro" if self.backend in AUSPRINT_BACKENDS else "QL-700",
            "color_hex": "#ef4444",
            "color_name": "Ready",
            "label_weight_g": 1000,
            "added_at": datetime.utcnow().date().isoformat(),
        }
        return self.print_spool_label(spool)


def _drawer_number_range(drawer: int) -> tuple[int, int]:
    drawer = max(1, min(6, int(drawer)))
    first = (drawer - 1) * 27 + 1
    return first, first + 26


def _drawer_row_numbers(drawer: int, row: int) -> list[int]:
    drawer = max(1, min(6, int(drawer)))
    row = max(1, min(3, int(row)))
    start = (drawer - 1) * 27 + (row - 1) * 9 + 1
    return list(range(start, start + 9))


def _draw_centered(draw: ImageDraw.ImageDraw, text: str, y: int, font) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (LabelPrinter.LABEL_WIDTH_PX - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, fill="black", font=font)


def _font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [path]
    bold = "Bold" in path or "bold" in path
    if os.name == "nt":
        win_dir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
        candidates.extend([
            str(win_dir / ("arialbd.ttf" if bold else "arial.ttf")),
            str(win_dir / ("segoeuib.ttf" if bold else "segoeui.ttf")),
            str(win_dir / ("calibrib.ttf" if bold else "calibri.ttf")),
        ])
    candidates.extend([
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ])
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _ellipsize(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "...", font=font) > max_width:
        text = text[:-1]
    return text + "..."


def _hero_number_font(draw: ImageDraw.ImageDraw, number_text: str, *, max_width: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    for size in (156, 140, 124, 108, 92, 78):
        font = _font(bold_path, size)
        if draw.textlength(number_text, font=font) <= max_width:
            return font
    return _font(bold_path, 78)


def _draw_text_centered_in_box(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    font,
) -> None:
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = left + ((right - left) - text_w) / 2 - bbox[0]
    y = top + ((bottom - top) - text_h) / 2 - bbox[1]
    draw.text((x, y), text, fill="black", font=font)


def _luminance(hex_color: str) -> float:
    h = hex_color.replace("#", "")
    if len(h) < 6:
        return 0
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _rack_label_parts(name: str, notes: str) -> tuple[Optional[str], Optional[str]]:
    text = f"{name} {notes}"
    range_match = re.search(r"(?<![\d-])(\d+\s*-\s*\d+)(?!\s*-)", text)
    direction_match = re.search(r"\b(left\s+to\s+right|right\s+to\s+left)\b", text, re.IGNORECASE)
    rack_range = range_match.group(1).replace(" ", "") if range_match else None
    direction = direction_match.group(1).lower() if direction_match else None
    return rack_range, direction


def _spool_label_location_text(spool: dict) -> str:
    """Plain home/storage location for full spool stickers."""
    loaded = bool(str(spool.get("location_printer_id") or "").strip())
    current_location = spool.get("storage_location_name") or spool.get("storage_location")
    home_location = spool.get("home_storage_location_name") or spool.get("home_storage_location")
    location = (home_location or current_location or "Storage") if loaded else (current_location or home_location or "Storage")
    return str(location).strip() or "Storage"


def _rack_spool_label_location_text(spool: dict) -> str:
    """Rack row marker for compact slot stickers beside the physical rack."""
    for key in ("storage_location_name", "storage_location", "home_storage_location_name", "home_storage_location"):
        text = str(spool.get(key) or "").strip()
        if text and re.search(r"rack\s*row", text, re.IGNORECASE):
            return text
    try:
        num = int(spool.get("display_id") or spool.get("id") or 0)
    except (TypeError, ValueError):
        num = 0
    if num > 0:
        row = (num - 1) // 10 + 1
        start = (row - 1) * 10 + 1
        end = start + 9
        return f"Rack Row {row} · {start}-{end}"
    return _spool_label_location_text(spool)


def _compact_location_name(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        return "Storage"
    range_match = re.search(r"(?<![\d-])(\d+\s*-\s*\d+)(?!\s*-)", text)
    if range_match:
        return f"Rack {range_match.group(1).replace(' ', '')}"
    return text


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


def _friendly_usb_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    if getattr(exc, "winerror", None) == 2 or "The system cannot find the file specified" in message:
        return "USB detection tool not found. On Windows, QL-700 printing needs a WinUSB/libusb driver via Zadig, or connect the label printer to the Pi/NAS."
    if "No backend available" in message:
        return "QL-700 USB backend unavailable. On Windows, install a WinUSB/libusb driver for the QL-700 with Zadig, or connect the label printer to the Pi/NAS."
    if "Access denied" in message or "insufficient permissions" in message:
        return "QL-700 USB permission denied; add the flightdeck user to lp or apply the Brother udev rule"
    return message


# ---------------------------------------------------------------------------
# Windows printer-queue backend (Brother QL-700 via its Windows driver, AusPrint Pro)
# ---------------------------------------------------------------------------

def _prepare_windows_label_image(image: Image.Image, model_name: str) -> Image.Image:
    """Scale and rotate a full-size label for the Windows QL-700 driver.

    FLIGHTDECK_LABEL_SCALE (default 0.5) and FLIGHTDECK_LABEL_ROTATION (default 90)
    were tuned on the shop printer; change them if labels print cropped or sideways.
    """
    if "brother ql-700" not in model_name.lower():
        return image
    try:
        scale = float(os.getenv("FLIGHTDECK_LABEL_SCALE", "0.5"))
    except ValueError:
        scale = 0.5
    try:
        rotation = int(float(os.getenv("FLIGHTDECK_LABEL_ROTATION", "90")))
    except ValueError:
        rotation = 90
    scale = max(0.1, min(1.0, scale))
    out = image.convert("RGB")
    if scale != 1.0:
        size = (
            max(1, int(round(out.width * scale))),
            max(1, int(round(out.height * scale))),
        )
        out = out.resize(size, Image.Resampling.LANCZOS)
    if rotation % 360:
        # PIL rotates counter-clockwise for positive angles; users expect 90 to mean clockwise.
        out = out.rotate(-rotation, expand=True, fillcolor="white")
    out.info["dpi"] = (300, 300)
    return out


def _ql700_compact_label_enabled() -> bool:
    return os.getenv("FLIGHTDECK_LABEL_PAPER_NAME", "").strip().lower() in {
        "62mm",
        "62mm x 29mm",
        "small address label",
    }


def _ql700_compact_62mm_enabled() -> bool:
    return os.getenv("FLIGHTDECK_LABEL_PAPER_NAME", "").strip().lower() == "62mm"


def _prepare_compact_ql700_label(image: Image.Image) -> Image.Image:
    out = image.convert("RGB")
    if os.getenv("FLIGHTDECK_LABEL_COMPACT_ROTATE", "90").strip() not in {"0", "false", "False", "off"}:
        out = out.rotate(-90, expand=True, fillcolor="white")
    try:
        top_pad = int(os.getenv("FLIGHTDECK_LABEL_COMPACT_TOP_PAD_PX", "34"))
    except ValueError:
        top_pad = 34
    if top_pad > 0:
        canvas = Image.new("RGB", out.size, "white")
        canvas.paste(out, (0, top_pad))
        out = canvas
    try:
        left_shift = int(os.getenv("FLIGHTDECK_LABEL_COMPACT_LEFT_SHIFT_PX", "0"))
    except ValueError:
        left_shift = 0
    if left_shift:
        if left_shift > 0:
            bbox = ImageChops.difference(out, Image.new("RGB", out.size, "white")).getbbox()
            if bbox:
                left_shift = min(left_shift, max(0, bbox[0] - 4))
        canvas = Image.new("RGB", out.size, "white")
        canvas.paste(out, (-left_shift, 0))
        out = canvas
    try:
        bottom_trim = int(os.getenv("FLIGHTDECK_LABEL_COMPACT_BOTTOM_TRIM_PX", "0"))
    except ValueError:
        bottom_trim = 0
    if bottom_trim > 0:
        out = out.crop((0, 0, out.width, max(1, out.height - bottom_trim)))
    out.info["dpi"] = (300, 300)
    return out


def _run_powershell(script: str, timeout: int = 10) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _windows_printers() -> list[str]:
    import json

    proc = _run_powershell("Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json")
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "Get-Printer failed").strip())
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


def _looks_like_brother_ql_queue(name: str) -> bool:
    normal = _normalise_printer_name(name)
    return any(term in normal for term in ("brotherql700", "ql700", "brotherql"))


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
        proc = _run_powershell(script)
        return proc.returncode == 0 and proc.stdout.strip().lower() == "true"
    except Exception:
        return False


def _pnp_rows(script: str) -> list[dict]:
    import json

    try:
        proc = _run_powershell(script)
        if proc.returncode != 0:
            return []
        raw = proc.stdout.strip()
        if not raw:
            return []
        data = json.loads(raw)
        rows = data if isinstance(data, list) else [data]
        return [row for row in rows if isinstance(row, dict)]
    except Exception:
        return []


def _brother_device_hint() -> str:
    rows = _pnp_rows(r"""
Get-PnpDevice |
  Where-Object {
    $_.FriendlyName -match 'Brother|QL-700|QL700' -or
    $_.InstanceId -match 'VID_04F9|USBPRINT\\BROTHER'
  } |
  Select-Object -Property Status,Class,FriendlyName,InstanceId |
  ConvertTo-Json
""")
    if not rows:
        return ""
    names = [str(row.get("FriendlyName") or "").strip() for row in rows if str(row.get("FriendlyName") or "").strip()]
    instance_ids = [str(row.get("InstanceId") or "").upper() for row in rows]
    active_printer_mode = any(
        str(row.get("Status") or "").lower() == "ok"
        and ("PID_2042" in str(row.get("InstanceId") or "").upper() or "USBPRINT\\BROTHER" in str(row.get("InstanceId") or "").upper())
        for row in rows
    )
    if active_printer_mode:
        return "QL-700 is detected in printer mode. Install/add the Brother QL-700 Windows printer driver so it appears in Windows Printers"
    if any("PID_2049" in instance or "USBSTOR" in instance for instance in instance_ids):
        return "QL-700 is detected in Editor Lite storage mode. Hold the Editor Lite button until the light turns off, then install/add the Brother QL-700 printer driver so it appears in Windows Printers"
    if names:
        return f"detected device: {', '.join(names[:4])}. Install/add the Brother QL-700 Windows printer driver so it appears in Windows Printers"
    return ""


def _ausprint_device_hint() -> str:
    rows = _pnp_rows(r"""
Get-PnpDevice |
  Where-Object {
    $_.FriendlyName -match 'Aus|LabelPrinter|Label Printer|Thermal' -or
    $_.InstanceId -match 'USBPRINT'
  } |
  Select-Object -Property Status,Class,FriendlyName |
  ConvertTo-Json
""")
    names = [str(row.get("FriendlyName") or "").strip() for row in rows if str(row.get("FriendlyName") or "").strip()]
    names = [
        name for name in names
        if re.search(r"aus|labelprinter|label printer|thermal", name, flags=re.I)
        and "surface thermal" not in name.lower()
    ]
    if names:
        return f"detected device: {', '.join(names[:4])}. Install the AusPrint Windows driver with the printer connected by USB so it appears as AUSPRINT or AUSPRINT-PRO in Windows Printers"
    return ""


def _windows_print_image_script(path: Path, printer_name: str) -> str:
    image_path = str(path).replace("'", "''")
    printer = printer_name.replace("'", "''")
    paper_name = os.getenv("FLIGHTDECK_LABEL_PAPER_NAME", "62mm").replace("'", "''")
    try:
        paper_width_mm = float(os.getenv("FLIGHTDECK_LABEL_PAPER_WIDTH_MM", "62"))
    except ValueError:
        paper_width_mm = 62.0
    paper_width_hundredths = max(1, int(round(paper_width_mm * 100 / 25.4)))
    return rf"""
Add-Type -AssemblyName System.Drawing
$imagePath = '{image_path}'
$printerName = '{printer}'
$paperName = '{paper_name}'
$paperWidth = {paper_width_hundredths}
$img = [System.Drawing.Image]::FromFile($imagePath)
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) {{
  throw "Printer queue not found: $printerName"
}}
$paper = $doc.PrinterSettings.PaperSizes | Where-Object {{ $_.PaperName -eq $paperName }} | Select-Object -First 1
if ($paper -ne $null) {{
  $doc.DefaultPageSettings.PaperSize = $paper
}} else {{
  $width = $paperWidth
  $height = [Math]::Max(1, [int][Math]::Ceiling($img.Height * 100 / 300))
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("FlightdeckLabel", $width, $height)
}}
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$handler = [System.Drawing.Printing.PrintPageEventHandler] {{
  param($sender, $eventArgs)
  $drawWidth = [Math]::Max(1, [int][Math]::Ceiling($img.Width * 100 / 300))
  $drawHeight = [Math]::Max(1, [int][Math]::Ceiling($img.Height * 100 / 300))
  $x = [Math]::Max(0, [int](($eventArgs.PageBounds.Width - $drawWidth) / 2))
  $y = [Math]::Max(0, [int](($eventArgs.PageBounds.Height - $drawHeight) / 2))
  $eventArgs.Graphics.DrawImage($img, $x, $y, $drawWidth, $drawHeight)
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
