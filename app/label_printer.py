from __future__ import annotations

import io
import subprocess
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

    def status(self) -> LabelStatus:
        self.last_error = None
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            self.last_error = str(exc)
            return LabelStatus(False, last_error=self.last_error)
        if f"{self.VENDOR}:{self.PRODUCT_PRINTER}" in out:
            return LabelStatus(True)
        if f"{self.VENDOR}:{self.PRODUCT_EDITOR_LITE}" in out:
            return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer")
        return LabelStatus(False, last_error="Brother QL-700 not detected")

    def render_spool_label(self, spool: dict) -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, self.LABEL_HEIGHT_PX), "white")
        draw = ImageDraw.Draw(img)
        swatch = spool.get("color_hex") or "#888888"
        draw.rectangle((0, 0, 112, self.LABEL_HEIGHT_PX), fill=swatch)
        if _luminance(swatch) > 0.85:
            draw.rectangle((0, 0, 111, self.LABEL_HEIGHT_PX - 1), outline="black")

        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)

        x = 136
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        draw.text((x, 54), _ellipsize(draw, material, font_bold, 390), fill="black", font=font_bold)
        draw.text((x, 124), _ellipsize(draw, brand, font_body, 390), fill="black", font=font_body)
        draw.text((x, 176), _ellipsize(draw, color_name, font_body, 390), fill="black", font=font_body)
        draw.text((x, 246), f"Spool #{spool.get('id', '-')}", fill="black", font=font_badge)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label weight  |  {added}"
        draw.text((x, 454), bottom, fill="black", font=font_small)

        qr_url = f"https://flightdeck.tail7de73e.ts.net/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((156, 156)), (510, 320))
        else:
            draw.rectangle((510, 320, 666, 476), outline="black")
            draw.text((562, 378), "QR", fill="black", font=font_body)
        return img

    def print_spool_label(self, spool: dict) -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_spool_label(spool)
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
            self.last_error = str(exc)
            return False

    def print_test_label(self) -> bool:
        spool = {
            "id": "TEST",
            "material": "Flightdeck",
            "subtype": "Test",
            "brand": "QL-700",
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
