#!/usr/bin/env python3
"""
Remembers App - sample phone data generator.

Renders a realistic set of phone screenshots / photos with Pillow so the app has
something real to OCR and index. Everything is drawn from scratch (no external
assets), so the script is deterministic and reproducible:

    python3 tools/gen-samples.py

Output: samples/gallery/*.png + samples/gallery/manifest.json
"""
import json
import os
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "samples", "gallery")

SS = (750, 1334)  # screenshot canvas (9:16)
FONT_DIR = "/usr/share/fonts/truetype/dejavu"

F = {
    "reg": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans.ttf"), 26),
    "small": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans.ttf"), 22),
    "tiny": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans.ttf"), 19),
    "bold": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), 27),
    "h1": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), 34),
    "h2": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), 30),
    "mono": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSansMono.ttf"), 24),
    "monob": ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSansMono-Bold.ttf"), 26),
}


def new_screen(bg="#ffffff"):
    img = Image.new("RGB", SS, bg)
    return img, ImageDraw.Draw(img)


def status_bar(d, bg="#0b141a", fg="#e9edef"):
    d.rectangle([0, 0, SS[0], 46], fill=bg)
    d.text((24, 12), "14:22", font=F["small"], fill=fg)
    d.text((SS[0] - 150, 12), "5G  84%", font=F["small"], fill=fg)


def wrap(text, font, max_w, draw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def para(d, xy, text, font=None, fill="#111111", max_w=670, leading=None):
    font = font or F["reg"]
    leading = leading or int(font.size * 1.42)
    x, y = xy
    for line in wrap(text, font, max_w, d):
        d.text((x, y), line, font=font, fill=fill)
        y += leading
    return y


# ---------------------------------------------------------------- screens ----

def chat_screen(path, meta, contact, messages, header_bg="#075e54", bubble_me="#dcf8c6",
                bubble_them="#ffffff", bg="#efeae2", meta_line=None):
    """WhatsApp-style conversation."""
    img, d = new_screen(bg)
    d.rectangle([0, 0, SS[0], 152], fill=header_bg)
    status_bar(d, bg=header_bg, fg="#eafff8")
    d.text((30, 60), contact, font=F["h2"], fill="#ffffff")
    d.text((30, 108), meta_line or "online", font=F["tiny"], fill="#d9f2ea")
    y = 196
    for who, text in messages:
        lines = wrap(text, F["reg"], 470, d)
        block_h = len(lines) * 36 + 46
        if who == "me":
            x1 = SS[0] - 30
            x0 = x1 - 60 - max(d.textlength(t, font=F["reg"]) for t in lines) - 20
            x0 = max(x0, 150)
            d.rounded_rectangle([x0, y, x1, y + block_h], radius=16, fill=bubble_me)
            ty = y + 16
            for line in lines:
                d.text((x0 + 20, ty), line, font=F["reg"], fill="#111111")
                ty += 36
            d.text((x1 - 90, y + block_h - 28), "14:2%d" % (y % 9), font=F["tiny"], fill="#8a9a91")
        else:
            x0 = 30
            x1 = x0 + 60 + max(d.textlength(t, font=F["reg"]) for t in lines) + 20
            x1 = min(x1, SS[0] - 150)
            d.rounded_rectangle([x0, y, x1, y + block_h], radius=16, fill=bubble_them)
            ty = y + 16
            for line in lines:
                d.text((x0 + 20, ty), line, font=F["reg"], fill="#111111")
                ty += 36
            d.text((x1 - 84, y + block_h - 28), "14:2%d" % (y % 9), font=F["tiny"], fill="#9aa0a6")
        y += block_h + 22
    img.save(path, optimize=True)
    return meta


def sms_screen(path, meta, sender, messages):
    img, d = new_screen("#f7f7f7")
    status_bar(d, bg="#f7f7f7", fg="#222")
    d.text((SS[0] // 2 - 40, 70), "Messages", font=F["tiny"], fill="#666")
    d.text((SS[0] // 2 - int(d.textlength(sender, font=F["h2"])) // 2, 96), sender, font=F["h2"], fill="#111")
    y = 180
    for who, text in messages:
        lines = wrap(text, F["reg"], 520, d)
        block_h = len(lines) * 36 + 40
        if who == "me":
            x1 = SS[0] - 30
            x0 = x1 - 60 - max(d.textlength(t, font=F["reg"]) for t in lines) - 20
            d.rounded_rectangle([max(x0, 140), y, x1, y + block_h], radius=22, fill="#0b84ff")
            ty = y + 14
            for line in lines:
                d.text((max(x0, 140) + 20, ty), line, font=F["reg"], fill="#ffffff")
                ty += 36
        else:
            x0 = 30
            x1 = x0 + 60 + max(d.textlength(t, font=F["reg"]) for t in lines) + 20
            d.rounded_rectangle([x0, y, min(x1, SS[0] - 140), y + block_h], radius=22, fill="#e9e9eb")
            ty = y + 14
            for line in lines:
                d.text((x0 + 20, ty), line, font=F["reg"], fill="#111111")
                ty += 36
        y += block_h + 20
    img.save(path, optimize=True)
    return meta


def browser_screen(path, meta, url, page_title, blocks, accent="#1a73e8", hero=None):
    """Chrome-style mobile browser screenshot."""
    img, d = new_screen("#ffffff")
    status_bar(d, bg="#f1f3f4", fg="#202124")
    d.rectangle([0, 46, SS[0], 150], fill="#f1f3f4")
    d.rounded_rectangle([30, 66, SS[0] - 30, 122], radius=26, fill="#ffffff", outline="#dadce0")
    d.text((56, 84), url, font=F["small"], fill="#3c4043")
    title_font = F["h2"]
    while d.textlength(page_title, font=title_font) > SS[0] - 68 and title_font.size > 20:
        title_font = ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf"), title_font.size - 2)
    d.text((44, 168), page_title, font=title_font, fill="#111111")
    y = 228
    if hero:
        d.rounded_rectangle([30, y, SS[0] - 30, y + 150], radius=14, fill=hero)
        d.text((60, y + 40), "SALE", font=F["h1"], fill="#ffffff")
        d.text((60, y + 88), "Cape Town returns from R1 289", font=F["reg"], fill="#ffffff")
        y += 180
    for kind, text in blocks:
        if kind == "h":
            y = para(d, (34, y), text, font=F["bold"], fill=accent, max_w=680) + 8
        elif kind == "p":
            y = para(d, (34, y), text, font=F["reg"], fill="#3c4043", max_w=680) + 12
        elif kind == "row":
            d.rounded_rectangle([30, y, SS[0] - 30, y + 92], radius=12, fill="#f8f9fa", outline="#e8eaed")
            parts = text.split("|")
            d.text((50, y + 16), parts[0], font=F["bold"], fill="#111111")
            if len(parts) > 1:
                d.text((50, y + 54), parts[1], font=F["small"], fill="#5f6368")
            if len(parts) > 2:
                tw = d.textlength(parts[2], font=F["bold"])
                d.text((SS[0] - 50 - tw, y + 30), parts[2], font=F["bold"], fill="#188038")
            y += 108
        elif kind == "price":
            y = para(d, (34, y), text, font=F["monob"], fill="#188038", max_w=680) + 10
    img.save(path, optimize=True)
    return meta


def note_screen(path, meta, title, lines, accent="#f5b400"):
    img, d = new_screen("#ffffff")
    status_bar(d, bg="#ffffff", fg="#222")
    d.text((30, 70), "14:22", font=F["tiny"], fill="#999")
    d.text((30, 100), "Notes", font=F["tiny"], fill="#999")
    d.text((30, 140), title, font=F["h1"], fill="#111111")
    y = 210
    for ln in lines:
        if ln.startswith("- "):
            d.ellipse([36, y + 12, 48, y + 24], fill=accent)
            y = para(d, (62, y), ln[2:], font=F["reg"], fill="#222222", max_w=630) + 12
        else:
            y = para(d, (32, y), ln, font=F["reg"], fill="#222222", max_w=680) + 14
    d.rectangle([0, SS[1] - 60, SS[0], SS[1]], fill="#fafafa")
    d.text((30, SS[1] - 46), "Edited 12 March 2026", font=F["tiny"], fill="#9aa0a6")
    img.save(path, optimize=True)
    return meta


def ig_post(path, meta, handle, caption_lines, likes="1 284 likes", accent="#c13584"):
    img, d = new_screen("#000000")
    status_bar(d, bg="#000000", fg="#ffffff")
    d.rectangle([0, 46, SS[0], 110], fill="#000000")
    d.ellipse([30, 58, 78, 106], fill=accent)
    d.text((92, 66), handle, font=F["bold"], fill="#ffffff")
    d.rounded_rectangle([30, 130, SS[0] - 30, 990], radius=10, fill="#1c1c1e")
    d.text((60, 200), "photo", font=F["tiny"], fill="#6b6b70")
    # a "photo" inside the post
    for i in range(6):
        d.rounded_rectangle([60 + i * 4, 260 + i * 40, SS[0] - 60 - i * 4, 940 - i * 12],
                            radius=8, fill=(28 + i * 10, 24 + i * 8, 30 + i * 6))
    y = 1020
    d.text((30, y), likes, font=F["bold"], fill="#ffffff")
    y += 42
    for ln in caption_lines:
        if ln.startswith("#"):
            y = para(d, (30, y), ln, font=F["reg"], fill="#4a90d9", max_w=690) + 6
        else:
            y = para(d, (30, y), ln, font=F["reg"], fill="#f0f0f0", max_w=690) + 8
    d.text((30, SS[1] - 40), "View all 214 comments", font=F["small"], fill="#8e8e93")
    img.save(path, optimize=True)
    return meta


def sign_photo(path, meta, title, rows, tint="#e8e2d6", sign_bg="#2e4a3c", sign_fg="#f4f1e6"):
    """A photographed sign / card (parking bay, guesthouse wifi card, clinic door)."""
    img, d = new_screen(tint)
    # subtle photographic vignette + noise-ish bands
    for i in range(40):
        c = 232 - i // 3
        d.rectangle([0, i * 4, SS[0], i * 4 + 4], fill=(c, c - 2, c - 8))
    d.rounded_rectangle([60, 300, SS[0] - 60, 980], radius=18, fill=sign_bg)
    d.rounded_rectangle([84, 324, SS[0] - 84, 956], radius=12, outline=sign_fg, width=3)
    d.text((120, 370), title, font=F["h1"], fill=sign_fg)
    y = 460
    for row in rows:
        d.text((120, y), row, font=F["monob"] if row.isupper() or any(ch.isdigit() for ch in row) else F["reg"],
               fill=sign_fg)
        y += 62
    img.save(path, optimize=True)
    return meta


def list_screen(path, meta, app_title, subtitle, rows, header="#111827", accent="#22c55e", bg="#ffffff"):
    img, d = new_screen(bg)
    status_bar(d, bg=header, fg="#ffffff")
    d.rectangle([0, 46, SS[0], 168], fill=header)
    d.text((30, 74), app_title, font=F["h1"], fill="#ffffff")
    d.text((30, 122), subtitle, font=F["small"], fill="#cbd5e1")
    y = 208
    for row in rows:
        d.rounded_rectangle([26, y, SS[0] - 26, y + 118], radius=14, fill="#f8fafc", outline="#e2e8f0")
        d.text((50, y + 20), row[0], font=F["bold"], fill="#0f172a")
        if len(row) > 1:
            d.text((50, y + 62), row[1], font=F["small"], fill="#64748b")
        if len(row) > 2:
            tw = d.textlength(row[2], font=F["bold"])
            d.text((SS[0] - 52 - tw, y + 44), row[2], font=F["bold"], fill=accent)
        y += 134
    img.save(path, optimize=True)
    return meta


def receipt_photo(path, meta, store, lines, total):
    img, d = new_screen("#ded8cd")
    for i in range(60):
        c = 226 - i // 2
        d.rectangle([0, i * 3, SS[0], i * 3 + 3], fill=(c, c - 3, c - 10))
    d.polygon([(90, 180), (SS[0] - 90, 150), (SS[0] - 70, 1130), (110, 1160)], fill="#fbfaf6")
    d.text((150, 240), store, font=F["h2"], fill="#1f2933")
    d.text((150, 292), "VAT 4890123456", font=F["small"], fill="#52606d")
    y = 360
    for ln in lines:
        d.text((150, y), ln, font=F["mono"], fill="#1f2933")
        y += 46
    d.line([(140, y + 10), (SS[0] - 140, y + 10)], fill="#9aa5b1", width=2)
    d.text((150, y + 40), "TOTAL", font=F["monob"], fill="#111111")
    d.text((SS[0] - 300, y + 40), total, font=F["monob"], fill="#111111")
    img.save(path, optimize=True)
    return meta


def sunset_photo(path, meta, caption):
    """A plain photo (no text) - indexed by its album caption."""
    img, d = new_screen("#101a2b")
    for y in range(SS[1]):
        t = y / SS[1]
        r = int(16 + 220 * max(0, 1 - abs(t - 0.42) * 3.1))
        g = int(24 + 130 * max(0, 1 - abs(t - 0.42) * 3.4))
        b = int(58 + 90 * max(0, 1 - abs(t - 0.30) * 3.0))
        d.rectangle([0, y, SS[0], y + 1], fill=(min(r, 255), min(g, 255), min(b, 255)))
    d.ellipse([300, 470, 450, 620], fill="#ffd479")
    for i, (x, w, h) in enumerate([(20, 90, 300), (110, 70, 380), (200, 110, 260),
                                   (330, 60, 430), (410, 130, 330), (560, 80, 400), (660, 90, 290)]):
        d.rectangle([x, SS[1] - h - 120, x + w, SS[1] - 120], fill=(18 + i * 4, 20 + i * 3, 34 + i * 5))
    d.rectangle([0, SS[1] - 120, SS[0], SS[1]], fill="#0a101c")
    img.save(path, optimize=True)
    return meta


def desk_photo(path, meta, caption):
    """A photo of a desk/ticket - no legible text, indexed by album caption."""
    img, d = new_screen("#2b2118")
    for y in range(0, SS[1], 3):
        c = 60 + (y % 24)
        d.rectangle([0, y, SS[0], y + 3], fill=(c, int(c * 0.78), int(c * 0.55)))
    d.rounded_rectangle([120, 380, 630, 900], radius=10, fill="#d9c9a3")
    d.rounded_rectangle([150, 420, 600, 860], radius=6, outline="#b7a37a", width=2)
    for i in range(5):
        d.rectangle([185, 480 + i * 70, 560, 500 + i * 70], fill="#c4b28c")
    img.save(path, optimize=True)
    return meta


# ----------------------------------------------------------------- driver ----

def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []

    def add(fn, kind, app, title, captured, location, album, **extra):
        meta = {
            "file": fn, "kind": kind, "app": app, "title": title,
            "capturedAt": captured, "location": location, "album": album,
        }
        meta.update(extra)
        manifest.append(meta)
        return meta

    # 1. WhatsApp: friend recommends her cousin the mechanic (the "who recommended" demo)
    chat_screen(os.path.join(OUT, "whatsapp-lerato-mechanic.png"),
                None, "Lerato Mokoena",
                [("them", "Hey! My cousin Thabo does car repairs from his place in Melville"),
                 ("them", "He sorted my Polo's clutch last month, charged me R2 400"),
                 ("them", "Give him a shout on 071 555 0199"),
                 ("me", "Amazing, saving his number now")],
                meta_line="last seen today at 14:12", header_bg="#075e54")
    add("whatsapp-lerato-mechanic.png", "screenshot", "WhatsApp",
        "Chat with Lerato Mokoena", "2026-03-12T14:22:00+02:00", "Melville, Johannesburg", "Screenshots")

    # 2. WhatsApp: friend says watch Shogun (media recommendation)
    chat_screen(os.path.join(OUT, "whatsapp-sipho-series.png"),
                None, "Sipho Ndlovu",
                [("them", "You have to watch Shogun on Disney Plus, best thing I have seen this year"),
                 ("them", "The finale is unreal. Trust me"),
                 ("me", "Okay okay, adding it to the list tonight")],
                meta_line="typing...", header_bg="#128c7e")
    add("whatsapp-sipho-series.png", "screenshot", "WhatsApp",
        "Chat with Sipho Ndlovu", "2026-08-02T20:41:00+02:00", "Sandton, Johannesburg", "Screenshots")

    # 3. Cheap flights browser screenshot (the "cheap flights website" demo)
    browser_screen(os.path.join(OUT, "browser-cheapflights.png"), None,
                   "cheapflights.co.za/flights/jnb-cpt", "Cheap Flights Express - JNB to Cape Town",
                   [("h", "Johannesburg to Cape Town"),
                    ("p", "Return fares for April 2026, prices include taxes."),
                    ("row", "Lift Air LT 412|Direct, 2h 05m|R1 289"),
                    ("row", "FlySafair FA 204|Direct, 2h 10m|R1 344"),
                    ("row", "Airlink 4Z 610|Direct, 2h 15m|R1 512"),
                    ("p", "Tip: Tuesday and Wednesday departures are the cheapest."),
                    ("price", "Cheapest found: R1 289 return")],
                   hero="#0f766e")
    add("browser-cheapflights.png", "screenshot", "Chrome",
        "Cheap Flights Express", "2026-04-18T21:07:00+02:00", "Johannesburg", "Screenshots")

    # 4. Flight confirm — Lift Air booking (boarding pass)
    img, d = new_screen("#0b3b5a")
    status_bar(d, bg="#0b3b5a", fg="#dff3ff")
    d.text((30, 90), "Lift Air", font=F["h1"], fill="#ffffff")
    d.text((30, 140), "Booking confirmed", font=F["small"], fill="#a9d6f0")
    d.rounded_rectangle([30, 210, SS[0] - 30, 940], radius=20, fill="#ffffff")
    d.text((60, 250), "JNB", font=F["h1"], fill="#0b3b5a")
    d.text((470, 250), "CPT", font=F["h1"], fill="#0b3b5a")
    d.line([(170, 275), (450, 275)], fill="#b9c8d3", width=3)
    details = [("Booking ref", "LT7X4QP"), ("Passenger", "L. Mkhungela"),
               ("Date", "Tue 21 April 2026"), ("Departs", "06:15 JNB"),
               ("Arrives", "08:20 CPT"), ("Seat", "14A window"),
               ("Paid", "R1 289 return"), ("Gate", "A12")]
    y = 350
    for k, v in details:
        d.text((60, y), k, font=F["small"], fill="#6b7c8c")
        d.text((330, y), v, font=F["bold"], fill="#102331")
        y += 62
    d.text((60, 880), "Show this at the gate", font=F["small"], fill="#6b7c8c")
    img.save(os.path.join(OUT, "airline-booking-lift.png"), optimize=True)
    add("airline-booking-lift.png", "screenshot", "Lift Air",
        "Lift Air booking LT7X4QP", "2026-04-18T21:24:00+02:00", "Johannesburg", "Screenshots")

    # 5. Parking bay sign photo
    sign_photo(os.path.join(OUT, "parking-level3-bay47.png"), None, "PARKING LEVEL 3",
               ["BAY 47", "LIFT LOBBY B", "RED ZONE", "Mall of Africa"], sign_bg="#1f3d2b")
    add("parking-level3-bay47.png", "photo", "Camera", "Parking level 3 bay 47",
        "2026-06-27T11:52:00+02:00", "Mall of Africa, Waterfall City", "Screenshots")

    # 6. Guest house wifi card photo
    sign_photo(os.path.join(OUT, "guesthouse-wifi-card.png"), None, "PROTEA GUEST HOUSE",
               ["WiFi: Protea_Guest", "Password: Sunset2024!", "Reception 011 555 7788"],
               sign_bg="#3b2f57", tint="#ded7cf")
    add("guesthouse-wifi-card.png", "photo", "Camera", "Guest house wifi card",
        "2026-09-14T18:03:00+02:00", "Dullstroom, Mpumalanga", "Screenshots")

    # 7. Dentist appointment SMS
    sms_screen(os.path.join(OUT, "sms-dentist-reminder.png"), None, "Dr Pillay Dental",
               [("them", "Reminder: your appointment is Thursday 22 September at 15:30 with Dr Naidoo."),
                ("them", "14 Rosebank Road, Johannesburg. Reply C to confirm."),
                ("me", "C")])
    add("sms-dentist-reminder.png", "screenshot", "Messages",
        "Dentist appointment reminder", "2026-09-15T09:04:00+02:00", "Rosebank, Johannesburg", "Screenshots")

    # 8. Washing machine error saved page
    browser_screen(os.path.join(OUT, "browser-washing-machine-e20.png"), None,
                   "repairguy.co.za/fix-e20-error-bosch", "How to fix an E20 error on a Bosch washing machine",
                   [("h", "E20 means the drain pump cannot empty"),
                    ("p", "1. Switch the machine off at the wall and wait five minutes."),
                    ("p", "2. Open the filter cover at the bottom front and drain the water into a tray."),
                    ("p", "3. Clear lint and coins from the impeller, then twist the filter back in."),
                    ("p", "4. Run a rinse cycle. If E20 returns, the pump needs replacing."),
                    ("price", "Replacement pump: R480 at Mica Hardware")])
    add("browser-washing-machine-e20.png", "screenshot", "Chrome",
        "Fix E20 error on Bosch washing machine", "2025-12-03T19:38:00+02:00", "Johannesburg", "Screenshots")

    # 9. Instagram pasta recipe
    ig_post(os.path.join(OUT, "instagram-pasta-recipe.png"), None, "@cookingwithnaledi",
            ["Creamy garlic pasta with spinach - 15 minute dinner",
             "Fry 4 cloves garlic in butter, add 200ml cream, wilt 2 handfuls spinach.",
             "Toss through 300g linguine, finish with parmesan and black pepper.",
             "#weeknightdinner #pasta #15minutes"],
            likes="4 812 likes")
    add("instagram-pasta-recipe.png", "screenshot", "Instagram",
        "Creamy garlic pasta recipe", "2026-02-09T19:12:00+02:00", "Johannesburg", "Screenshots")

    # 10. Instagram jacket on sale
    ig_post(os.path.join(OUT, "instagram-jacket-sale.png"), None, "@zara.southafrica",
            ["The padded winter jacket is R899 in the sale until Sunday",
             "Roomy fit, water repellent shell, in stores and online.",
             "#zarawinter #sale"],
            likes="2 190 likes", accent="#0f172a")
    add("instagram-jacket-sale.png", "screenshot", "Instagram",
        "Padded winter jacket on sale", "2026-06-14T12:40:00+02:00", "Sandton City, Johannesburg", "Screenshots")

    # 11. Gym class timetable
    list_screen(os.path.join(OUT, "gym-timetable.png"), None, "PulseFit Studio", "Classes this week",
                [("Pilates Reformer", "Tuesday 18:00 with Zanele", "R120"),
                 ("Spin 45", "Wednesday 06:00 with Kurt", "R95"),
                 ("Vinyasa Yoga", "Thursday 19:30 with Aisha", "R110")],
                header="#111827", accent="#22c55e")
    add("gym-timetable.png", "screenshot", "PulseFit", "Gym class timetable",
        "2026-05-11T07:26:00+02:00", "Rosebank, Johannesburg", "Screenshots")

    # 12. Load shedding schedule screenshot
    list_screen(os.path.join(OUT, "loadshedding-schedule.png"), None, "EskomSePush", "Stage 4 schedule - Zone 7",
                [("17:00 - 19:30", "Tuesday, off at 19:30", "Stage 4"),
                 ("01:00 - 03:30", "Wednesday", "Stage 4"),
                 ("09:00 - 11:30", "Wednesday", "Stage 4")],
                header="#7f1d1d", accent="#fca5a5")
    add("loadshedding-schedule.png", "screenshot", "EskomSePush", "Load shedding schedule zone 7",
        "2026-07-21T16:41:00+02:00", "Randburg, Johannesburg", "Screenshots")

    # 13. Grocery receipt photo
    receipt_photo(os.path.join(OUT, "receipt-checkers.png"), None, "CHECKERS HYPER FOURWAYS",
                  ["Bread brown          R22.99", "Milk 2L              R34.99",
                   "Chicken breasts 1kg  R89.99", "Coffee beans 250g   R119.00",
                   "Spinach bunch        R19.99", "Linguine 500g        R27.99",
                   "Dishwashing liquid   R41.99"], "R456.90")
    add("receipt-checkers.png", "photo", "Camera", "Grocery receipt Fourways",
        "2026-10-03T17:58:00+02:00", "Fourways, Johannesburg", "Screenshots")

    # 14. Notes: braai checklist / grocery list
    note_screen(os.path.join(OUT, "note-braai-checklist.png"), None, "Braai Saturday",
                ["Guests from 13:00 at our place",
                 "- 2kg lamb chops and boerewors",
                 "- Charcoal, firelighters, matches",
                 "- Salad, garlic bread",
                 "Thabo bringing his portable speaker",
                 "Buy ice and cold drinks on Saturday morning"])
    add("note-braai-checklist.png", "screenshot", "Notes", "Braai Saturday checklist",
        "2026-03-06T08:15:00+02:00", "Johannesburg", "Screenshots")

    # 15. Notes: car service / mechanic details
    note_screen(os.path.join(OUT, "note-mechanic-details.png"), None, "Car service",
                ["Thabo Mokoena - mobile mechanic, Melville",
                 "- 071 555 0199 (call after 16:00)",
                 "- R2 400 clutch job on the Polo",
                 "Next service due at 165 000 km",
                 "He also does brakes and CV joints"])
    add("note-mechanic-details.png", "screenshot", "Notes", "Car service notes",
        "2026-03-13T07:02:00+02:00", "Melville, Johannesburg", "Screenshots")

    # 16. Maps screenshot: hiking trail
    browser_screen(os.path.join(OUT, "maps-hiking-trail.png"), None,
                   "maps.google.com/kloofendal-nature-reserve", "Kloofendal Nature Reserve trailhead",
                   [("h", "Kloofendal Nature Reserve"),
                    ("p", "Parking on Wilgespruit Street, gates open 06:00 to 18:00."),
                    ("p", "Loop trail 5.2 km, moderate, about 1h 40m on foot."),
                    ("p", "Small entry fee R30 per adult. Bring water, no shops inside."),
                    ("price", "300 m from Wilgespruit Street parking")])
    add("maps-hiking-trail.png", "screenshot", "Maps",
        "Kloofendal hiking trail", "2026-08-23T06:48:00+02:00", "Kloofendal, Roodepoort", "Screenshots")

    # 17. Doctor / clinic saved page
    browser_screen(os.path.join(OUT, "browser-medical-aid-claim.png"), None,
                   "discovery.co.za/health/claims", "Submit a health claim online",
                   [("h", "Claims in three steps"),
                    ("p", "1. Open the app and choose Health then Claims."),
                    ("p", "2. Photograph the invoice and the receipt from the doctor."),
                    ("p", "3. Submit within four months of the visit date."),
                    ("price", "Claim reference starts with CLM")])
    add("browser-medical-aid-claim.png", "screenshot", "Chrome",
        "Submit a health claim online", "2026-01-27T13:19:00+02:00", "Johannesburg", "Screenshots")

    # 18. Plain photos indexed by album caption
    sunset_photo(os.path.join(OUT, "photo-sunset-city.png"), None, "sunset")
    add("photo-sunset-city.png", "photo", "Camera", "Johannesburg sunset photo",
        "2026-09-06T18:21:00+02:00", "Northcliff Hill, Johannesburg", "Camera Roll",
        caption="Sunset over the Johannesburg skyline from Northcliff Hill, taken with Naledi after the hike.")

    desk_photo(os.path.join(OUT, "photo-desk-tickets.png"), None, "tickets")
    add("photo-desk-tickets.png", "photo", "Camera", "Desk with old tickets",
        "2026-04-22T09:34:00+02:00", "Johannesburg", "Camera Roll",
        caption="Old concert tickets and the boarding pass stub from the Cape Town trip, kept on my desk.")

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump({"generated": "tools/gen-samples.py", "items": manifest}, fh, indent=2)

    print("wrote %d images + manifest.json to %s" % (len(manifest), OUT))


if __name__ == "__main__":
    main()
