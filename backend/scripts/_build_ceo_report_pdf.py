"""Professional Persian CEO work-report PDF — phase-centric, Shamsi dates, fixed BiDi.

Target length: ~15 A4 pages. Lead credit: Omid Ramshini / Vefaq Sharif.
"""
from __future__ import annotations

import re
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
FONTS = DOCS / "fonts"
OUT_FA = DOCS / "گزارش-کار-کامل-پروژه-Arvand-Electrolyzer.pdf"
OUT_EN = DOCS / "Arvand-Electrolyzer-CEO-Work-Report.pdf"
LOGO = ROOT / "frontend" / "public" / "logo-arvand.png"

NAVY = colors.HexColor("#0B1F4A")
NAVY2 = colors.HexColor("#163A7A")
GOLD = colors.HexColor("#8B7A12")
GOLD_SOFT = colors.HexColor("#C4A035")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#E2E8F0")
ROW_ALT = colors.HexColor("#F8FAFC")
OK = colors.HexColor("#15803D")
WHITE = colors.white

LEAD_NAME = "امید رامشینی"
LEAD_NAME_EN = "Omid Ramshini"
VENDOR = "شرکت وفاق شریف"
SUPPORT_PHONE = "09398637969"

_LATIN = re.compile(
    r"(?:https?://\S+)|(?:/[A-Za-z0-9_\-./]+)|(?:[A-Za-z][A-Za-z0-9+.\-_/\\:@#%()]*)|(?:\d+(?:[./]\d+)*)"
)


def fa(text: str) -> str:
    if not text:
        return ""
    text = str(text)
    if not re.search(r"[\u0600-\u06FF]", text):
        return text
    pieces: list[str] = []
    cursor = 0
    for match in _LATIN.finditer(text):
        before = text[cursor : match.start()]
        if before:
            pieces.append(arabic_reshaper.reshape(before))
        pieces.append("\u202A" + match.group(0) + "\u202C")
        cursor = match.end()
    if cursor < len(text):
        pieces.append(arabic_reshaper.reshape(text[cursor:]))
    return get_display("".join(pieces))


def esc(text: str) -> str:
    return fa(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Vazir", str(FONTS / "Vazirmatn-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Vazir-Bold", str(FONTS / "Vazirmatn-Bold.ttf")))


def styles():
    getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker", fontName="Vazir-Bold", fontSize=11, textColor=GOLD_SOFT,
            alignment=TA_CENTER, leading=16,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", fontName="Vazir-Bold", fontSize=20, textColor=WHITE,
            alignment=TA_CENTER, leading=30, spaceAfter=4,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", fontName="Vazir", fontSize=11, textColor=colors.HexColor("#E2E8F0"),
            alignment=TA_CENTER, leading=17,
        ),
        "h1": ParagraphStyle(
            "h1", fontName="Vazir-Bold", fontSize=13, textColor=NAVY,
            alignment=TA_RIGHT, leading=20, spaceBefore=8, spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "h2", fontName="Vazir-Bold", fontSize=11, textColor=NAVY2,
            alignment=TA_RIGHT, leading=17, spaceBefore=8, spaceAfter=4,
        ),
        "date": ParagraphStyle(
            "date", fontName="Vazir-Bold", fontSize=9, textColor=GOLD,
            alignment=TA_RIGHT, leading=14, spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "body", fontName="Vazir", fontSize=9.4, textColor=SLATE,
            alignment=TA_RIGHT, leading=15.5, spaceAfter=3,
        ),
        "body_just": ParagraphStyle(
            "body_just", fontName="Vazir", fontSize=9.4, textColor=SLATE,
            alignment=TA_JUSTIFY, leading=15.8, spaceAfter=5,
        ),
        "meta": ParagraphStyle(
            "meta", fontName="Vazir", fontSize=8.4, textColor=MUTED,
            alignment=TA_RIGHT, leading=13,
        ),
        "check": ParagraphStyle(
            "check", fontName="Vazir", fontSize=9, textColor=SLATE,
            alignment=TA_RIGHT, leading=14.2,
        ),
        "cell": ParagraphStyle(
            "cell", fontName="Vazir", fontSize=8.3, textColor=SLATE,
            alignment=TA_RIGHT, leading=12.5,
        ),
        "cell_b": ParagraphStyle(
            "cell_b", fontName="Vazir-Bold", fontSize=8.3, textColor=NAVY,
            alignment=TA_RIGHT, leading=12.5,
        ),
        "th": ParagraphStyle(
            "th", fontName="Vazir-Bold", fontSize=8.3, textColor=WHITE,
            alignment=TA_RIGHT, leading=12.5,
        ),
        "toc": ParagraphStyle(
            "toc", fontName="Vazir", fontSize=9.5, textColor=SLATE,
            alignment=TA_RIGHT, leading=16, spaceAfter=2,
        ),
    }


def P(text: str, style) -> Paragraph:
    return Paragraph(esc(text), style)


def section_banner(title: str, s) -> KeepTogether:
    t = Table([[P(title, s["h1"])]], colWidths=[180 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF2FF")),
                ("BOX", (0, 0), (-1, -1), 0.7, NAVY2),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return KeepTogether([Spacer(1, 5), t, Spacer(1, 5)])


def phase_card(title: str, date: str, s) -> KeepTogether:
    data = [[P(title, s["h2"])], [P(f"بازه / تاریخ شاخص: {date}", s["date"])]]
    t = Table(data, colWidths=[180 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFFBEB")),
                ("BOX", (0, 0), (-1, -1), 0.8, GOLD),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 3)])


def kv_table(rows: list[tuple[str, str]], s) -> Table:
    data = [[P(v, s["cell"]), P(k, s["cell_b"])] for k, v in rows]
    t = Table(data, colWidths=[128 * mm, 52 * mm])
    cmds = [
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (1, 0), (1, -1), colors.HexColor("#F8FAFC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(len(data)):
        if i % 2 == 1:
            cmds.append(("BACKGROUND", (0, i), (0, i), ROW_ALT))
    t.setStyle(TableStyle(cmds))
    return t


def checklist(items: list[tuple[bool, str]], s) -> list:
    out = []
    for done, text in items:
        mark = "✓" if done else "○"
        st = ParagraphStyle(
            f"c_{done}_{abs(hash(text)) % 99999}",
            parent=s["check"],
            textColor=OK if done else SLATE,
        )
        out.append(P(f"{mark}  {text}", st))
    return out


def data_table(headers: list[str], rows: list[list[str]], s, widths) -> Table:
    data = [[P(h, s["th"]) for h in headers]]
    data += [[P(c, s["cell"]) for c in row] for row in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(cmds))
    return t


def callout(text: str, s, bg="#ECFDF5", border=OK) -> Table:
    box = Table([[P(text, s["body"])]], colWidths=[180 * mm])
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
                ("BOX", (0, 0), (-1, -1), 1.0, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return box


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, h - 11 * mm, w, 11 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, h - 11.9 * mm, w, 1.1 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Vazir", 7.6)
    canvas.drawCentredString(
        w / 2, h - 7.2 * mm,
        fa("گزارش کار پروژه · Arvand Electrolyzer · پتروشیمی اروند · طراح و توسعه‌دهنده: امید رامشینی"),
    )
    canvas.setFillColor(colors.HexColor("#F1F5F9"))
    canvas.rect(0, 0, w, 11 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(1)
    canvas.line(16 * mm, 11 * mm, w - 16 * mm, 11 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Vazir", 7.6)
    canvas.drawCentredString(
        w / 2, 4.5 * mm,
        fa(f"صفحه {doc.page}  |  {VENDOR}  |  پشتیبانی فنی: {SUPPORT_PHONE}  |  تاریخ تنظیم: ۱۴۰۵/۰۷/۱۱"),
    )
    canvas.restoreState()


def cover(story, s):
    story.append(Spacer(1, 8 * mm))
    if LOGO.exists():
        img = Image(str(LOGO), width=78 * mm, height=30 * mm, kind="proportional")
        img.hAlign = "CENTER"
        story.append(img)
        story.append(Spacer(1, 5 * mm))

    hero = Table(
        [[
            [
                Spacer(1, 6 * mm),
                P("گزارش کار کامل پروژه", s["cover_kicker"]),
                Spacer(1, 3 * mm),
                P("Arvand Electrolyzer Management Program", s["cover_title"]),
                P("سامانه یکپارچه مدیریت الکترولایزر — پتروشیمی اروند", s["cover_sub"]),
                Spacer(1, 2 * mm),
                P("جایگزین عملیاتی Uhde Administrator مبتنی بر Microsoft Access", s["cover_sub"]),
                Spacer(1, 7 * mm),
            ]
        ]],
        colWidths=[180 * mm],
    )
    hero.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(hero)
    accent = Table([[""]], colWidths=[180 * mm], rowHeights=[2.4 * mm])
    accent.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), GOLD)]))
    story.append(accent)
    story.append(Spacer(1, 6 * mm))
    story.append(
        kv_table(
            [
                ("نام رسمی برنامه", "Arvand Electrolyzer Management Program"),
                ("کارفرما / بهره‌بردار", "شرکت پتروشیمی اروند (واحد کلر–آلکالی / PVC)"),
                ("مجری توسعه", VENDOR),
                ("طراح اصلی و توسعه‌دهنده اصلی", f"{LEAD_NAME} ({LEAD_NAME_EN})"),
                ("پشتیبانی فنی", SUPPORT_PHONE),
                ("هدف راهبردی", "جایگزینی کامل Access قدیمی با سامانه تحت‌وب مدرن و پایدار"),
                ("بازه اجرای ثبت‌شده", "۱۴۰۵/۰۶/۳۱ تا ۱۴۰۵/۰۷/۱۱"),
                ("وضعیت کلی", "نسخه عملیاتی — آماده بهره‌برداری آزمایشی / واقعی"),
                ("مخاطب سند", "مدیرعامل / مدیریت ارشد پتروشیمی اروند"),
                ("حجم تقریبی سند", "حدود ۱۵ صفحه — گزارش فازبه‌فاز و تفصیلی"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 6 * mm))
    story.append(callout(
        "این سند روایت فازبه‌فاز اجرای پروژه را با تمرکز بر دستاوردهای عملیاتی، ارزش مدیریتی، "
        f"معماری فنی، حاکمیت داده و آمادگی بهره‌برداری ارائه می‌کند. طراحی و پیاده‌سازی اصلی سامانه "
        f"توسط {LEAD_NAME} در قالب {VENDOR} انجام شده است.",
        s,
    ))
    story.append(PageBreak())


def add_phase(story, s, title, date, lead_paras, items, out):
    story.append(phase_card(title, date, s))
    for p in lead_paras:
        story.append(P(p, s["body_just"]))
    story.extend(checklist([(True, x) for x in items], s))
    story.append(P(out, s["meta"]))


def build():
    register_fonts()
    s = styles()
    doc = SimpleDocTemplate(
        str(OUT_EN),
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=16 * mm,
        bottomMargin=15 * mm,
        title="گزارش کار کامل — Arvand Electrolyzer Management Program",
        author=f"{LEAD_NAME_EN} — {VENDOR}",
        subject="CEO Work Report — PVC Arvand Electrolyzer Management Program",
    )
    story: list = []
    cover(story, s)

    # TOC
    story.append(section_banner("فهرست مطالب", s))
    for line in [
        "۱) خلاصه مدیریتی و ارزش راهبردی پروژه",
        "۲) مشخصات اجرایی و تیم پروژه",
        "۳) نقشه فازهای پروژه (تاریخ شمسی)",
        "۴) شرح تفصیلی فازها (۰ تا ۱۰)",
        "۵) معماری فنی و استک فناوری",
        "۶) کاتالوگ ماژول‌ها و پوشش Access",
        "۷) داده، مهاجرت و کیفیت اطلاعات",
        "۸) امنیت، نقش‌ها و حاکمیت سازمانی",
        "۹) تصویر قابلیت‌ها به‌تفکیک حوزه عملیاتی",
        "۱۰) ریسک‌ها، محدودیت‌ها، مدیریت تغییر و اقدامات پیشنهادی",
        "۱۰-ب) اقلام تحویلی و نقشه راه ۹۰ روز پس از Go-Live",
        "۱۱) وضعیت پیشنهادی برای مدیرعامل و جمع‌بندی",
        "۱۲) مشخصات تهیه‌کننده و پشتیبانی فنی",
    ]:
        story.append(P(line, s["toc"]))
    story.append(PageBreak())

    # 1 Executive
    story.append(section_banner("۱) خلاصه مدیریتی و ارزش راهبردی پروژه", s))
    for p in [
        "پروژه با مأموریت روشن آغاز شد: حذف وابستگی عملیاتی واحد الکترولیز به نرم‌افزار قدیمی Uhde Administrator مبتنی بر Microsoft Access و جایگزینی آن با سامانه‌ای تحت‌وب که هم زبان مهندسان و اپراتورهای کارخانه را بلد باشد، هم استانداردهای روز نرم‌افزار سازمانی (امنیت، ممیزی، استقرار شبکه، دوزبانگی و قابلیت توسعه) را رعایت کند.",
        "خروجی پروژه صرفاً یک «وب‌سایت جایگزین» نیست؛ بلکه یک پلتفرم عملیاتی یکپارچه است که چرخه عمر المان (مونتاژ تا دمونتاژ)، جذب داده واقعی از اکسل‌های کارخانه و AriaORMS، پایش زنده سلول‌روم، گزارش‌های مدیریتی ولتاژ/آمپر/انرژی/آنالیز/توقف، انبار و تفکیک الکترود، و حاکمیت دسترسی نقش‌محور را در یک نقطه جمع کرده است.",
        "از منظر مدیریت ارشد، ارزش اصلی سامانه در سه لایه است: (۱) کاهش ریسک عملیاتی ناشی از وابستگی به Access قدیمی و فایل‌های پراکنده؛ (۲) افزایش شفافیت تصمیم با داشبورد و هشدار لحظه‌ای؛ (۳) ایجاد بستر قابل اداره برای IT و بهره‌برداری بدون از دست رفتن دانش ضمنی کاربران باسابقه.",
    ]:
        story.append(P(p, s["body_just"]))
    story.append(P("دستاوردهای کلیدی قابل ارائه به مدیریت:", s["h2"]))
    story.extend(
        checklist(
            [
                (True, "دیجیتالی‌سازی کامل چرخه مونتاژ، نصب، بهره‌برداری و دمونتاژ با تاریخ شمسی"),
                (True, "جذب داده واقعی از اکسل‌های عملیاتی، LIMS، SiteMan/F2 و سامانه AriaORMS"),
                (True, "پایش زنده سلول‌روم همراه با آستانه هشدار، Acknowledge/Resolve و سلامت سلول"),
                (True, "گزارش‌های یکپارچه ولتاژ، آمپر، توان/انرژی، آنالیز شیمیایی و توقف واحد"),
                (True, "دسترسی نقش‌محور (Admin / User / Visitor / Inspector) با سطح فیلد و فرم"),
                (True, "هویت بصری هم‌تراز با برند پتروشیمی اروند و گروه PGPIC"),
                (True, "مسیر استقرار سازمانی روی ویندوز سرور / LAN کارخانه / Docker"),
                (True, "حفظ وفاداری به فرم‌ها و نام‌گذاری Uhde EAP برای پذیرش کاربران قدیمی"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(callout(
        "جمع‌بندی پیشنهادی: سامانه در وضعیت آمادگی عملیاتی کنترل‌شده است و با تکمیل چک‌لیست کوتاه "
        "امنیتی/استقراری (رمز Admin، کلید نشست، فایروال، پشتیبان، UAT یک شیفت)، قابلیت Go-Live روی "
        "سرور کارخانه را دارد.",
        s,
    ))

    # 2 Team
    story.append(section_banner("۲) مشخصات اجرایی و تیم پروژه", s))
    story.append(P(
        "طراحی محصول، معماری نرم‌افزار، پیاده‌سازی Backend و Frontend، مهاجرت داده، یکپارچه‌سازی "
        "AriaORMS، مانیتورینگ، آمار و گزارش‌های مدیریتی، و آماده‌سازی استقرار شبکه تحت مسئولیت مستقیم "
        f"طراح و توسعه‌دهنده اصلی پروژه انجام شده است.",
        s["body_just"],
    ))
    story.append(
        kv_table(
            [
                ("مجری توسعه", VENDOR),
                ("طراح اصلی (Lead Designer)", LEAD_NAME),
                ("توسعه‌دهنده اصلی (Lead Developer)", f"{LEAD_NAME} / {LEAD_NAME_EN}"),
                ("پشتیبانی فنی", SUPPORT_PHONE),
                ("کارفرما / بهره‌بردار", "شرکت پتروشیمی اروند — واحد کلر–آلکالی / PVC"),
                ("هم‌راستایی سازمانی", "فناوری اطلاعات پتروشیمی اروند"),
                ("محصول جایگزین‌شونده", "Uhde Administrator (Microsoft Access)"),
                ("محیط هدف استقرار", "سرور شبکه داخلی کارخانه (LAN)"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(P(
        f"{VENDOR} در این پروژه نقش طراح و سازنده نرم‌افزار صنعتی را ایفا کرده است: از تحلیل عمیق "
        "Access قدیمی و استخراج منطق فرم‌ها تا تحویل سامانه وب مدرن با داده واقعی کارخانه. "
        f"نقطه تماس پشتیبانی فنی پس از تحویل: {LEAD_NAME} — {SUPPORT_PHONE}.",
        s["body_just"],
    ))
    story.append(PageBreak())

    # 3 Phase map
    story.append(section_banner("۳) نقشه فازهای پروژه (تاریخ شمسی)", s))
    story.append(P(
        "اجرای پروژه در یازده فاز (۰ تا ۱۰) برنامه‌ریزی و ثبت شده است. هر فاز خروجی قابل لمس داشته "
        "و فاز بعدی بر پایه همان خروجی بنا شده است؛ از شناخت و معماری تا تحویل شبکه.",
        s["body_just"],
    ))
    story.append(
        data_table(
            ["نتیجه کلیدی", "بازه شمسی", "عنوان فاز", "فاز"],
            [
                ["تعریف مسئله و بستر فنی", "۱۴۰۵/۰۶/۲۰ تا ۱۴۰۵/۰۶/۳۰", "شناخت، معماری و زیرساخت", "۰"],
                ["نسخه اول قابل اجرا", "۱۴۰۵/۰۶/۳۱", "هسته سامانه و انتشار اولیه", "۱"],
                ["آمادگی استقرار سرور", "۱۴۰۵/۰۷/۰۴", "بومی‌سازی فارسی و استقرار", "۲"],
                ["پذیرش کاربران قدیمی + مدرن", "۱۴۰۵/۰۷/۰۵", "وفاداری Access + UX دوگانه", "۳"],
                ["تغذیه خودکار ولتاژ", "۱۴۰۵/۰۷/۰۵ تا ۱۴۰۵/۰۷/۰۹", "اتصال داده زنده AriaORMS", "۴"],
                ["پایش زنده و هشدار", "۱۴۰۵/۰۷/۰۶ تا ۱۴۰۵/۰۷/۰۸", "مانیتورینگ و اتاق فرمان", "۵"],
                ["کنترل سازمانی", "۱۴۰۵/۰۷/۰۶", "حاکمیت دسترسی، انبار، ممیزی", "۶"],
                ["پوشش عملیاتی گسترده", "۱۴۰۵/۰۷/۰۷", "تکمیل گردش‌کارهای کارخانه", "۷"],
                ["تصمیم‌یار مهندسی", "۱۴۰۵/۰۷/۰۹", "سلامت سلول و TAFKIK", "۸"],
                ["ارائه سازمانی", "۱۴۰۵/۰۷/۰۹", "برندینگ محصول اروند", "۹"],
                ["آمادگی LAN و داده واقعی", "۱۴۰۵/۰۷/۱۰ تا ۱۴۰۵/۰۷/۱۱", "تکمیل نهایی و تحویل", "۱۰"],
            ],
            s,
            [52 * mm, 48 * mm, 60 * mm, 20 * mm],
        )
    )
    story.append(PageBreak())

    # 4 Detailed phases
    story.append(section_banner("۴) شرح تفصیلی فازها", s))

    add_phase(
        story, s,
        "فاز ۰ — شناخت، معماری و زیرساخت",
        "۱۴۰۵/۰۶/۲۰ تا ۱۴۰۵/۰۶/۳۰",
        [
            "در این فاز، مسئله از سطح «ساخت چند فرم وب» به سطح «بازطراحی سیستم عملیاتی کارخانه» ارتقا یافت. "
            "بدون این شناخت عمیق، هر جایگزینی Access یا ناقص می‌ماند یا برای کاربران غیرقابل پذیرش می‌شد.",
            "تمرکز روی استخراج منطق واقعی Uhde EAP، نام‌گذاری آلمانی/عملیاتی فرم‌ها، وابستگی جداول، و "
            "هم‌ترازی با واقعیت میدانی واحد الکترولیز (مونتاژ، ولتاژ، آنالیز، انبار، توقف) بود.",
        ],
        [
            "تحلیل عمیق نرم‌افزار قدیمی Uhde Administrator و وابستگی‌های Access",
            "استخراج منطق فرم‌ها، جداول، منوها و نام‌گذاری عملیاتی از پایگاه Access",
            "جلسات هم‌ترازی نیاز با واقعیت میدانی واحد الکترولیز",
            "تعریف هدف راهبردی: حفظ زبان کارخانه + ارتقای فناوری و امنیت",
            "طراحی معماری هدف: Frontend مدرن، Backend مهندسی، داده نرمال‌شده",
            "انتخاب استک پایدار و قابل نگهداری برای تیم کارخانه و IT",
            "تعریف مدل داده جدید به‌جای جداول پراکنده Access",
            "آماده‌سازی چارچوب امنیتی، حقوقی و استقرار از روز اول",
        ],
        "خروجی: نقشه راه اجرایی شفاف و بستر فنی قابل توسعه.",
    )

    add_phase(
        story, s,
        "فاز ۱ — هسته سامانه و انتشار اولیه",
        "۱۴۰۵/۰۶/۳۱",
        [
            "نخستین نسخه قابل لمس سامانه ساخته شد؛ نقطه‌ای که پروژه از ایده به محصول تبدیل گردید و امکان "
            "نمایش، آزمایش و بازخورد ذی‌نفعان فراهم شد.",
        ],
        [
            "پیاده‌سازی هسته Backend با API استاندارد و ساختار ماژولار (FastAPI)",
            "Frontend با حس‌وحال کلاسیک EAP برای کاهش مقاومت کاربری (Next.js)",
            "صفحه ورود امن مبتنی بر نشست و توکن",
            "منوی اصلی هم‌سبک Uhde برای شروع سریع کاربران قدیمی",
            "مدیریت المان و فرم داده‌های مونتاژ (Assembly Data)",
            "ماژول ولتاژ استاندارد به‌عنوان قلب داده‌های فرآیندی",
            "ماژول آنالیز شیمیایی و بازرسی المان",
            "نمای کلی کارخانه برای نگاه مدیریتی یک‌صفحه‌ای",
            "تنظیمات پایه کارخانه و کاربران اولیه",
            "پشتیبانی هم‌زمان انگلیسی و فارسی",
            "مستندسازی بصری اولیه برای ارائه به ذی‌نفعان",
        ],
        "خروجی: نسخه اول عملیاتی برای نمایش، آزمایش و توسعه مرحله‌ای.",
    )

    add_phase(
        story, s,
        "فاز ۲ — بومی‌سازی فارسی و استقرار سازمانی",
        "۱۴۰۵/۰۷/۰۴",
        [
            "تمرکز این فاز روی قابل نصب بودن سامانه روی سرور سازمانی و قابل فهم بودن آن برای کاربر ایرانی "
            "کارخانه بود؛ سامانه باید هم «کار کند» و هم «در سازمان قابل استقرار و آموزش» باشد.",
        ],
        [
            "طراحی مسیر استقرار روی سرورهای سازمانی ویندوز / شبکه داخلی",
            "آماده‌سازی اسکریپت‌های نصب و به‌روزرسانی تکرارپذیر",
            "استانداردسازی فایل‌های استقرار برای محیط سرور",
            "فارسی‌سازی عمیق منوها و برچسب‌های Access",
            "نگاشت نام فرم‌های آلمانی قدیمی به مسیرهای وب فارسی/انگلیسی",
            "کاهش اصطکاک آموزش با حفظ نام‌های آشنای قبلی",
        ],
        "خروجی: سامانه نه‌فقط کار می‌کند، بلکه در سازمان قابل استقرار و آموزش است.",
    )

    add_phase(
        story, s,
        "فاز ۳ — وفاداری Access همراه با تجربه کاربری مدرن",
        "۱۴۰۵/۰۷/۰۵",
        [
            "چالش نسل کاربری حل شد: کاربران باسابقه Access و کاربران متوقع رابط مدرن، هر دو پوشش داده شدند "
            "بدون اجبار یک سبک واحد به همه.",
        ],
        [
            "هم‌راستاسازی فرم‌ها و کپشن‌ها با واقعیت Access",
            "پنل All Forms برای دسترسی سریع به میانبرهای آشنا",
            "سوئیچ درون‌برنامه‌ای تم کلاسیک / مدرن",
            "حفظ حس EAP برای اپراتورهای باسابقه",
            "تجربه مدرن برای مدیران بدون از دست رفتن دقت عملیاتی",
        ],
        "خروجی: پذیرش دوگانه بدون اجبار یک سبک واحد به همه کاربران.",
    )
    story.append(PageBreak())

    add_phase(
        story, s,
        "فاز ۴ — اتصال به داده زنده کارخانه (AriaORMS / LogSheets)",
        "۱۴۰۵/۰۷/۰۵ تا ۱۴۰۵/۰۷/۰۹",
        [
            "نقطه عطف داده: سامانه از ورود دستی فاصله گرفت و به جریان واقعی کارخانه وصل شد. این اتصال، "
            "پایه مانیتورینگ، آمار ولتاژ و تصمیم‌گیری روزانه است.",
        ],
        [
            "خواندن Excel خروجی LogSheets از AriaORMS",
            "انتقال خودکار داده به مسیر ولتاژ استاندارد",
            "پوشه مراقبت (Watch) برای دریافت فایل‌های جدید",
            "همگام‌سازی دستی اضطراری از تنظیمات",
            "زمان‌بندی کشیدن روزانه نیمه‌شب با اعتبار ذخیره‌شده",
            "بازه Lookback برای جبران فایل‌های تأخیری یا جاافتاده",
            "پشتیبانی برچسب‌های پیچیده سلول از جمله الگوی BlueStar برای L2/M2",
            "پایدارسازی مسیر تولید مربوط به تنظیمات همگام‌سازی",
        ],
        "خروجی: تغذیه مستمر داده فرآیندی و کاهش خطای اپراتوری.",
    )

    add_phase(
        story, s,
        "فاز ۵ — مانیتورینگ و اتاق فرمان دیجیتال سلول‌روم",
        "۱۴۰۵/۰۷/۰۶ تا ۱۴۰۵/۰۷/۰۸",
        [
            "سامانه از بانک اطلاعات به ابزار دیده‌بانی عملیاتی تبدیل شد؛ مدیریت و شیفت بهره‌برداری می‌توانند "
            "وضعیت سلول‌روم را در یک نگاه ببینند و به ناهنجاری واکنش دهند.",
        ],
        [
            "صفحه Monitoring به‌عنوان نمای فرمان سلول‌روم",
            "شماتیک Train / الکترولایزر / سلول با نفوذ لایه‌ای",
            "گیج‌های وضعیت در منوی اصلی برای نگاه سریع مدیریتی",
            "آستانه‌های هشدار و خطر قابل تنظیم",
            "صندوق هشدار با چرخه Acknowledge / Resolve",
            "تاریخچه ولتاژ در بازه‌های کوتاه تا دوساله و سفارشی",
            "سری رکتیفایر و نمایش آمپر هم‌روز / روزهای قبل",
            "خروجی Excel/PDF برای جلسات بهره‌برداری و مدیریت",
            "ارتقای تجربه بصری مانیتورینگ در تم مدرن",
        ],
        "خروجی: پایش لحظه‌ای و تصمیم سریع‌تر در مواجهه با ناهنجاری.",
    )

    add_phase(
        story, s,
        "فاز ۶ — حاکمیت دسترسی، انبار و ممیزی سازمانی",
        "۱۴۰۵/۰۷/۰۶",
        [
            "بدون کنترل دسترسی و ردپای عملیات، هیچ سامانه کارخانه‌ای کامل نیست. این فاز زیرساخت حاکمیتی "
            "را برای IT، HSE و بهره‌برداری تکمیل کرد.",
        ],
        [
            "نقش‌های برنامه با ماتریس None / View / Edit در سطح فرم و فیلد",
            "نقش آماده Inspector برای تمرکز روی Voltage و Monitoring",
            "انبار قطعات Lagerbestand هم‌راستا با Access",
            "Audit Log سراسری برای ورود، تغییر رمز و عملیات نوشتنی",
            "رفع موانع Build برای نسخه Production پایدار",
        ],
        "خروجی: ارتقا از ابزار مهندسی به سامانه قابل اداره سازمانی.",
    )
    story.append(PageBreak())

    add_phase(
        story, s,
        "فاز ۷ — تکمیل گردش‌کارهای واقعی کارخانه",
        "۱۴۰۵/۰۷/۰۷",
        [
            "خلأهای عملیاتی میان ماژول‌ها بسته شد تا کاربر برای کارهای روزمره از Access خارج شود و همه "
            "گردش‌کارهای پرتکرار در یک سامانه واحد انجام شود.",
        ],
        [
            "تکمیل Warehouse / Storage برای آند، کاتد و ممبران",
            "Cell Arrangement و ارتباط با رکوردهای زنده",
            "گزارش‌های نگهداری برای پیگیری تعمیرات",
            "تقویم شمسی در ورود و نمایش تاریخ‌ها",
            "تاریخچه ولتاژ بلندمدت تا افق دوساله",
            "ایمپورت کامل مونتاژ / دمونتاژ از اکسل کارخانه",
            "ایمپورت آنالیز LIMS سلسله‌مراتبی",
            "ایمپورت ولتاژ SiteMan/F2 و فایل‌های TAFKIK",
            "لیست توقف با مدت h:mm، نوع NaCl و ترجمه علل",
            "صفحات آمار هم‌سبک Access (نه خروجی خام JSON)",
        ],
        "خروجی: پوشش سرتاسری فرآیندهای پرتکرار در یک سامانه واحد.",
    )

    add_phase(
        story, s,
        "فاز ۸ — لایه تصمیم‌یار مهندسی (سلامت سلول و TAFKIK)",
        "۱۴۰۵/۰۷/۰۹",
        [
            "پروژه از ثبت داده فراتر رفت و وارد کمک به تصمیم مهندسی شد: شناسایی سلول‌های در حال انحراف، "
            "اولویت‌بندی رسیدگی و پشتیبانی نگهداری پیشگیرانه.",
        ],
        [
            "غنی‌سازی تفکیک الکترود از تاریخچه مونتاژ",
            "امتیازدهی سلامت سلول: Healthy / Watch / Investigate / Critical",
            "مقایسه peer برای شناسایی سلول‌های در حال انحراف",
            "تعریف envelope عملیاتی بار، دما، غلظت و اختلاف فشار",
            "خروجی Excel آنالیزها برای گزارش‌دهی رسمی",
        ],
        "خروجی: پشتیبان تصمیم برای نگهداری پیشگیرانه و کاهش ریسک توقف.",
    )

    add_phase(
        story, s,
        "فاز ۹ — برندینگ و هویت محصول پتروشیمی اروند",
        "۱۴۰۵/۰۷/۰۹",
        [
            "سامانه برای ارائه به مدیریت ارشد باید محصول اروند دیده شود، نه یک ابزار عمومی. هویت بصری "
            "و کلامی با شأن سازمانی هماهنگ شد.",
        ],
        [
            "تثبیت نام رسمی Arvand Electrolyzer Management Program",
            "یکپارچه‌سازی لوگوی شفاف PGPIC / اروند در صفحات کلیدی",
            "طراحی و نصب Favicon اختصاصی برنامه",
            f"فوتر سازمانی Login شامل IT اروند، {VENDOR} و مشخصات طراح/پشتیبانی",
            "صفحه About با معرفی مجری، طراح اصلی و شماره پشتیبانی فنی",
            "بازآرایی مانیتورینگ با اولویت بوم سلول",
        ],
        "خروجی: هویت بصری و کلامی هم‌تراز با شأن سازمانی اروند.",
    )

    add_phase(
        story, s,
        "فاز ۱۰ — تکمیل نهایی، داده واقعی و آماده‌سازی تحویل شبکه",
        "۱۴۰۵/۰۷/۱۰ تا ۱۴۰۵/۰۷/۱۱",
        [
            "تمرکز روی کیفیت داده، پایداری محیط، نمودارهای مدیریتی و آمادگی ارائه روی شبکه داخلی کارخانه "
            "تا سامانه برای تحویل میدانی و استفاده واقعی آماده شود.",
        ],
        [
            "آماده‌سازی فایل import-ready اکسل مونتاژ با قواعد پوشش و توضیحات",
            "پاکسازی و بارگذاری مجدد Assembly از منبع معتبر کارخانه",
            "افزودن فیلدهای توضیحات آند و توضیحات کاتد به فرم و پایگاه",
            "تکمیل هزاران رکورد Remark از اکسل روی داده‌های موجود",
            "پایدارسازی پایگاه پس از فشار فضای ذخیره‌سازی",
            "اصلاح نمایش راست‌چین متن فارسی حاوی واژه انگلیسی (BiDi)",
            "نمودار آمپر جدا در کنار ولتاژ با رنگ متمایز",
            "تب مستقل نمودارهای واحد برای کل سیستم با فیلتر و بازه زمانی",
            "رفع Network Error ورود از IP سرور و اتصال same-origin مناسب LAN",
            "صحت‌سنجی ورود کاربر admin روی مسیر اصلاح‌شده شبکه",
            "خروج خودکار از نشست پس از مدت بیکاری قابل تنظیم در Settings",
            "فیلتر بازه تاریخ روی آمار ولتاژ المان‌ها",
        ],
        "خروجی: آمادگی میدانی برای تحویل، ارائه مدیریتی و استفاده روی سرور کارخانه.",
    )
    story.append(PageBreak())

    # 5 Architecture
    story.append(section_banner("۵) معماری فنی و استک فناوری", s))
    story.append(P(
        "معماری سامانه عمداً ساده، پایدار و قابل نگهداری برای محیط کارخانه انتخاب شده است تا تیم IT "
        "بتواند بدون وابستگی پیچیده خارجی، سرویس را روی شبکه داخلی اجرا و پشتیبانی کند.",
        s["body_just"],
    ))
    story.append(
        data_table(
            ["توضیح", "فناوری / لایه"],
            [
                ["رابط کاربری وب دوزبانه (کلاسیک EAP + مدرن)", "Frontend — Next.js / React / TypeScript"],
                ["API ماژولار، اعتبارسنجی، نقش و ممیزی", "Backend — FastAPI / Python"],
                ["داده عملیاتی محلی؛ قابل انتقال به سرور مشترک", "Database — SQLite (پیش‌فرض سازمانی)"],
                ["ورود، نقش، دسترسی فرم/فیلد، نشست و idle logout", "امنیت — JWT / RBAC / bcrypt"],
                ["Excel/PDF، LogSheets AriaORMS، LIMS، TAFKIK", "یکپارچه‌سازی داده"],
                ["ویندوز سرور / LAN / Docker Compose", "استقرار"],
            ],
            s,
            [110 * mm, 70 * mm],
        )
    )
    story.append(P("اصول طراحی معماری:", s["h2"]))
    story.extend(
        checklist(
            [
                (True, "حفظ زبان عملیاتی Uhde در UI برای پذیرش کاربران باسابقه"),
                (True, "جداسازی Frontend و Backend برای توسعه و استقرار مستقل"),
                (True, "اجرای محاسبات آماری/گزارشی درون‌سامانه بدون وابستگی به سرویس ابری خارجی"),
                (True, "قابلیت پشتیبان‌گیری فایل پایگاه و بازیابی کنترل‌شده"),
                (True, "آماده بودن مسیر ارتقا به پایگاه سروری در صورت نیاز IT"),
            ],
            s,
        )
    )

    # 6 Modules
    story.append(section_banner("۶) کاتالوگ ماژول‌ها و پوشش Access", s))
    story.append(P(
        "جدول زیر نمای فشرده ماژول‌های تحویل‌شده و ارتباط آن‌ها با حوزه‌های اصلی Uhde EAP را نشان می‌دهد. "
        "هدف پوشش عملیاتی روزمره بوده است، نه کپی ظاهری صرف از Access.",
        s["body_just"],
    ))
    story.append(
        data_table(
            ["وضعیت", "معادل / حوزه Access", "ماژول وب"],
            [
                ["عملیاتی", "Main Menu / EAP Hub", "منوی اصلی Access-style"],
                ["عملیاتی", "Assembly / Elements", "مدیریت المان و مونتاژ"],
                ["عملیاتی", "Standardized Voltage", "ولتاژ استاندارد + آمار + نمودار"],
                ["عملیاتی", "Analysis forms", "آنالیز شیمیایی چندفرمی"],
                ["عملیاتی", "Plant Shut Down", "توقف واحد + علل + PDF"],
                ["عملیاتی", "Monitoring / Cell room", "مانیتورینگ زنده + هشدار"],
                ["عملیاتی", "Lagerbestand / Warehouse", "انبار آند/کاتد/غشا"],
                ["عملیاتی", "Inspection / CZ-03", "بازرسی و نقشه‌های شبکه"],
                ["عملیاتی", "TAFKIK / Segregation", "تفکیک الکترود"],
                ["عملیاتی", "Statistics / Reports", "آمار و گزارش‌های مدیریتی"],
                ["عملیاتی", "Users / Security", "کاربران، نقش‌ها، Audit Log"],
                ["عملیاتی", "Plant settings", "تنظیمات واحد، نشست، همگام‌سازی"],
            ],
            s,
            [28 * mm, 72 * mm, 80 * mm],
        )
    )
    story.append(PageBreak())

    # 7 Data
    story.append(section_banner("۷) داده، مهاجرت و کیفیت اطلاعات", s))
    for p in [
        "یکی از دشوارترین بخش‌های پروژه، انتقال دانش و داده از Access و اکسل‌های عملیاتی به مدل نرمال‌شده "
        "وب بود. تمرکز روی داده واقعی کارخانه بوده است، نه داده آزمایشگاهی ساختگی.",
        "مسیرهای ایمپورت برای مونتاژ/دمونتاژ، آنالیز LIMS، ولتاژ SiteMan/F2، TAFKIK و LogSheets AriaORMS "
        "پیاده‌سازی و با قواعد کسب‌وکار کارخانه (پوشش، پوسته، تاریخ شمسی، Remark و …) هم‌راستا شده‌اند.",
    ]:
        story.append(P(p, s["body_just"]))
    story.append(P("اقدامات کیفیت داده انجام‌شده:", s["h2"]))
    story.extend(
        checklist(
            [
                (True, "پاکسازی و بارگذاری مجدد Assembly از منبع معتبر کارخانه"),
                (True, "تکمیل گسترده Remarkها و توضیحات آند/کاتد از اکسل"),
                (True, "نرمال‌سازی نام پوشش و قواعد پوسته (از جمله استثناهای L2/M2)"),
                (True, "یکسان‌سازی aliasهای الکترولایزر (مانند 1A / A1) در آمار ولتاژ"),
                (True, "جبران Un خالی با fallback ولتاژ در گزارش‌های آماری"),
                (True, "پایدارسازی پایگاه پس از فشار فضای دیسک و جداسازی DB از Git"),
            ],
            s,
        )
    )

    # 8 Security
    story.append(section_banner("۸) امنیت، نقش‌ها و حاکمیت سازمانی", s))
    story.append(P(
        "سامانه از ابتدا با فرض استقرار روی شبکه کارخانه و کاربران متعدد با سطوح دسترسی متفاوت طراحی شده است. "
        "کنترل دسترسی فقط در رابط کاربری نیست؛ در Backend برای هر درخواست اعمال می‌شود.",
        s["body_just"],
    ))
    story.extend(
        checklist(
            [
                (True, "ورود اجباری؛ رمز عبور با bcrypt هش می‌شود"),
                (True, "RBAC با سطح فرم و فیلد (None / View / Edit)"),
                (True, "نقش‌های آماده Admin / User / Visitor / Inspector"),
                (True, "Audit Log برای ورود، تغییر رمز و عملیات نوشتنی API/ORM"),
                (True, "خروج خودکار پس از بیکاری (دقیقه قابل تنظیم در Settings)"),
                (True, "عدم ارسال پیش‌فرض داده به سرویس‌های شخص ثالث / AI خارجی"),
                (True, "اسناد حقوقی پایه: License، EULA، Terms، Privacy، Security"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 2 * mm))
    story.append(callout(
        "توصیه امنیتی قبل از Go-Live قطعی: تغییر فوری رمز Admin پیش‌فرض، چرخش کلید نشست‌ها، "
        "محدودسازی پورت روی فایروال سرور، و پشتیبان‌گیری دوره‌ای پایگاه روی دیسک جدا.",
        s,
        bg="#FFFBEB",
        border=GOLD,
    ))
    story.append(PageBreak())

    # 9 Capabilities
    story.append(section_banner("۹) تصویر قابلیت‌ها به‌تفکیک حوزه عملیاتی", s))
    caps = [
        (
            "۹-۱) بهره‌برداری و مانیتورینگ",
            [
                "نمای زنده سلول‌روم و نفوذ Train → الکترولایزر → سلول",
                "هشدار آستانه‌ای و چرخه Acknowledge / Resolve",
                "تاریخچه ولتاژ/آمپر و مقایسه رکتیفایر",
                "سلامت سلول و اولویت‌بندی رسیدگی",
                "داشبورد نمودارهای کل سیستم با فیلتر بازه و سطح",
                "گیج‌های وضعیت در منوی اصلی برای نگاه سریع مدیریتی",
            ],
        ),
        (
            "۹-۲) مهندسی نگهداری و کارگاه",
            [
                "مونتاژ / نصب / دمونتاژ با تاریخ شمسی",
                "انبار قطعات و وضعیت موجودی (روی رک / بیرون / OK / NOT OK)",
                "چیدمان سلول و پیوند به سوابق زنده",
                "بازرسی CZ-03 و ثبت نقص روی شبکه ۱۳×۱۸",
                "تفکیک الکترود TAFKIK و غنی‌سازی از سابقه مونتاژ",
                "گزارش‌های نگهداری و پیگیری تعمیرات/بازپوشش",
            ],
        ),
        (
            "۹-۳) فرآیند و کیفیت",
            [
                "ولتاژ استاندارد، CE، Un و توزیع",
                "آمار المان‌ها با فیلتر تاریخ و بازه",
                "آنالیزهای شیمیایی چندسطحی (Pure brine تا Element)",
                "توقف واحد، دسته/علت، مدت h:mm و خروجی PDF",
                "مصرف انرژی و گزارش‌های روند مدیریتی",
            ],
        ),
        (
            "۹-۴) راهبری IT و امنیت",
            [
                "نقش و دسترسی فرم‌محور و فیلدمحور",
                "لاگ ممیزی و پشتیبان‌گیری",
                "همگام‌سازی زمان‌بندی‌شده داده AriaORMS",
                "مسیر استقرار ویندوز / سرور / Docker",
                "تنظیمات واحد، نسخه، UAN، نوع Plant و idle session",
            ],
        ),
    ]
    for title, items in caps:
        story.append(P(title, s["h2"]))
        story.extend(checklist([(True, x) for x in items], s))

    # 10 Risks
    story.append(section_banner("۱۰) ریسک‌ها، محدودیت‌ها و اقدامات پیشنهادی", s))
    story.append(P(
        "شناسایی ریسک‌ها به‌معنای ضعف پروژه نیست؛ بلکه بخشی از آمادگی مدیریتی برای Go-Live کنترل‌شده است. "
        "جدول زیر مهم‌ترین ریسک‌های باقی‌مانده و اقدام پیشنهادی متناظر را نشان می‌دهد.",
        s["body_just"],
    ))
    story.append(
        data_table(
            ["اقدام پیشنهادی", "سطح", "ریسک / محدودیت"],
            [
                ["آموزش فشرده + UAT یک شیفت", "متوسط", "مقاومت کاربری در ترک Access"],
                ["چک‌لیست امنیتی Go-Live", "بالا تا رفع", "رمز/کلید پیش‌فرض در محیط تولید"],
                ["هماهنگی IT برای پورت و مسیر", "متوسط", "فایروال / دسترسی LAN"],
                ["پشتیبان خودکار روی دیسک جدا", "متوسط", "فضای دیسک و پایداری DB"],
                ["مانیتور Watch + Lookback", "کم–متوسط", "تأخیر فایل AriaORMS"],
                ["فاز پشتیبانی پس از تحویل", "کم", "نیاز به توسعه فرم‌های کمتر استفاده‌شده"],
            ],
            s,
            [70 * mm, 30 * mm, 80 * mm],
        )
    )
    story.append(P("برنامه پیشنهادی مدیریت تغییر (Change Management):", s["h2"]))
    story.extend(
        checklist(
            [
                (False, "جلسه معارفه ۳۰ دقیقه‌ای برای سرپرستان شیفت و مهندسان فرآیند"),
                (False, "کارگاه عملی Operator روی منوی اصلی، ولتاژ، مانیتورینگ و توقف"),
                (False, "کارگاه Inspector روی Voltage Statistics و Monitoring Alerts"),
                (False, "کارگاه Admin روی Users/Roles، Settings، Backup و AriaORMS Sync"),
                (False, "اجرای موازی یک‌هفته‌ای Access + سامانه وب برای کاهش ریسک انتقال"),
                (False, "ثبت بازخورد UAT و بستن موارد بحرانی قبل از قطع Access قدیمی"),
            ],
            s,
        )
    )
    story.append(PageBreak())

    # 10b Deliverables & roadmap
    story.append(section_banner("۱۰-ب) اقلام تحویلی و نقشه راه پس از Go-Live", s))
    story.append(P("اقلام تحویلی اصلی پروژه تا تاریخ تنظیم این گزارش:", s["h2"]))
    story.extend(
        checklist(
            [
                (True, "سامانه وب عملیاتی با منوی EAP، ماژول‌های مهندسی و مانیتورینگ"),
                (True, "Backend API، مدل داده نرمال‌شده و مسیرهای ایمپورت کارخانه"),
                (True, "اتصال AriaORMS / LogSheets و همگام‌سازی زمان‌بندی‌شده"),
                (True, "نقش‌ها، Audit Log، About/License و اسناد امنیتی پایه"),
                (True, "هویت برند اروند (لوگو، Favicon، عنوان رسمی برنامه)"),
                (True, "گزارش کار مدیریتی حاضر برای ارائه به مدیرعامل"),
                (True, "نقطه تماس پشتیبانی فنی مشخص پس از تحویل"),
            ],
            s,
        )
    )
    story.append(P("پیشنهاد نقشه راه ۹۰ روز پس از بهره‌برداری کنترل‌شده:", s["h2"]))
    story.append(
        data_table(
            ["نتیجه مورد انتظار", "اقدام", "بازه"],
            [
                ["ثبات شیفت واقعی", "پایش پایدار LAN، Backup و Sync روزانه", "هفته ۱–۲"],
                ["پذیرش کاربری", "بستن یافته‌های UAT و آموزش تکمیلی", "هفته ۲–۴"],
                ["عمق تحلیلی", "تقویت گزارش‌های انرژی/آمار بر اساس بازخورد شیفت", "ماه ۲"],
                ["حاکمیت داده", "بازبینی نقش‌ها و سیاست رمز/نشست با IT", "ماه ۲–۳"],
                ["توسعه انتخابی", "اولویت‌بندی فرم‌های کم‌مصرف باقی‌مانده Access", "ماه ۳"],
            ],
            s,
            [70 * mm, 70 * mm, 40 * mm],
        )
    )
    story.append(Spacer(1, 3 * mm))
    story.append(P(
        f"در طول دوره پس از تحویل، پشتیبانی فنی از طریق {LEAD_NAME} ({SUPPORT_PHONE}) در دسترس است تا "
        "مسائل استقرار، همگام‌سازی داده و تنظیمات نقش/امنیت با حداقل اختلال در شیفت بهره‌برداری رفع شود.",
        s["body_just"],
    ))
    story.append(P("شاخص‌های موفقیت پیشنهادی برای ارزیابی پس از Go-Live:", s["h2"]))
    story.extend(
        checklist(
            [
                (False, "ورود پایدار کاربران شیفت از ایستگاه‌های شبکه بدون Network Error"),
                (False, "به‌روزرسانی روزانه داده ولتاژ از AriaORMS بدون مداخله دستی مکرر"),
                (False, "ثبت توقف‌ها و آنالیزهای روزمره صرفاً در سامانه وب"),
                (False, "استفاده مدیران از مانیتورینگ/نمودارها در جلسات بهره‌برداری"),
                (False, "وجود Backup معتبر روزانه و امکان بازیابی آزمایشی"),
            ],
            s,
        )
    )
    story.append(PageBreak())

    # 11 CEO status
    story.append(section_banner("۱۱) وضعیت پیشنهادی برای مدیرعامل و جمع‌بندی", s))
    story.append(
        data_table(
            ["وضعیت", "محور"],
            [
                ["بالا و عملیاتی", "پوشش کارکردی نسبت به Access"],
                ["برقرار (اکسل + AriaORMS)", "اتصال به داده واقعی کارخانه"],
                ["محقق‌شده", "ارزش مدیریتی پایش / گزارش / هشدار"],
                ["کامل", "آمادگی ارائه سازمانی و برند"],
                ["بالا؛ نیازمند چک‌لیست کوتاه Go-Live", "آمادگی بهره‌برداری شبکه"],
                ["آماده با نقطه تماس مشخص", "پشتیبانی فنی پس از تحویل"],
            ],
            s,
            [120 * mm, 60 * mm],
        )
    )
    story.append(P("اقدامات کوتاه‌مدت پیشنهادی قبل از بهره‌برداری قطعی:", s["h2"]))
    story.extend(
        checklist(
            [
                (False, "تغییر فوری رمز راهبر Admin در محیط تولید"),
                (False, "چرخش کلید امنیتی نشست‌ها"),
                (False, "اطمینان از باز بودن پورت سامانه روی فایروال سرور"),
                (False, "تنظیم پشتیبان‌گیری دوره‌ای پایگاه روی دیسک جدا"),
                (False, "برگزاری آموزش فشرده Operator / Inspector / Admin"),
                (False, "تأیید نهایی UAT روی یک شیفت واقعی بهره‌برداری"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 3 * mm))
    for p in [
        "پروژه Arvand Electrolyzer Management Program با عبور از ده فاز منسجم، از یک نیاز جایگزینی Access "
        "به یک سامانه عملیاتی–مدیریتی کامل تبدیل شده است.",
        "این سامانه زبان و عادت کاربران کارخانه را حفظ کرده، فناوری و امنیت را به‌روز نموده، داده زنده را "
        "وارد چرخه تصمیم کرده و برای ارائه به مدیریت ارشد، هویت برند پتروشیمی اروند را نمایندگی می‌کند.",
        f"طراحی اصلی، توسعه اصلی و پشتیبانی فنی سامانه بر عهده {LEAD_NAME} ({LEAD_NAME_EN}) از {VENDOR} "
        f"است. شماره تماس پشتیبانی فنی: {SUPPORT_PHONE}.",
    ]:
        story.append(P(p, s["body_just"]))

    story.append(Spacer(1, 3 * mm))
    story.append(callout(
        "پیشنهاد رسمی: تصویب ورود به مرحله بهره‌برداری کنترل‌شده روی سرور کارخانه "
        "و تکمیل چک‌لیست Go-Live در کوتاه‌ترین زمان ممکن.",
        s,
    ))

    # 12 Credits
    story.append(section_banner("۱۲) مشخصات تهیه‌کننده و پشتیبانی فنی", s))
    story.append(P(
        "این گزارش کار برای ارائه به مدیرعامل / مدیریت ارشد پتروشیمی اروند تهیه شده و وضعیت واقعی "
        "فازهای اجراشده پروژه را منعکس می‌کند.",
        s["body_just"],
    ))
    story.append(
        kv_table(
            [
                ("تهیه‌کننده گزارش / طراح اصلی", LEAD_NAME),
                ("Lead Designer & Lead Developer", LEAD_NAME_EN),
                ("شرکت مجری توسعه", VENDOR),
                ("پشتیبانی فنی (Technical Support)", SUPPORT_PHONE),
                ("محصول", "Arvand Electrolyzer Management Program"),
                ("کارفرما", "شرکت پتروشیمی اروند"),
                ("مخاطب", "مدیرعامل / مدیریت ارشد پتروشیمی اروند"),
                ("تاریخ تنظیم گزارش", "۱۴۰۵/۰۷/۱۱"),
            ],
            s,
        )
    )
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.7, color=LINE))
    story.append(Spacer(1, 3 * mm))
    story.append(P(
        f"© حقوق توسعه نرم‌افزار: {VENDOR} — طراح و توسعه‌دهنده اصلی: {LEAD_NAME}",
        s["meta"],
    ))
    story.append(P(
        "هم‌راستایی سازمانی استقرار: فناوری اطلاعات پتروشیمی اروند",
        s["meta"],
    ))

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    OUT_FA.write_bytes(OUT_EN.read_bytes())
    print("OK bytes=", OUT_EN.stat().st_size, "path=", OUT_EN)


if __name__ == "__main__":
    build()
