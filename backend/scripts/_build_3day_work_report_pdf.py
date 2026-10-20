# -*- coding: utf-8 -*-
"""گزارش کار ۳ روز اخیر پروژه PVC Arvand — PDF راست‌چین فارسی."""
from __future__ import annotations

import re
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
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
OUT = DOCS / "گزارش-کار-۳-روز-اخیر-Arvand-Electrolyzer.pdf"

NAVY = colors.HexColor("#0B1F4A")
NAVY2 = colors.HexColor("#163A7A")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#E2E8F0")
ROW_ALT = colors.HexColor("#F8FAFC")
WHITE = colors.white

# LRE / PDF isolate Latin (python-bidi does not support LRI/PDI)
_LRE = "\u202A"
_PDF = "\u202C"
_RLM = "\u200F"
_LRM = "\u200E"

_RESHAPER = arabic_reshaper.ArabicReshaper(
    configuration={
        "delete_harakat": True,
        "support_ligatures": True,
        "RIAL SIGN": False,
    }
)

# Latin / code / IP / pure-Latin parenthetical islands (keep as LTR).
# Do NOT swallow Persian letters inside "(…)" — that reverses words like «نه».
_LATIN = re.compile(
    r"(?:"
    r"https?://[^\s<>]+|"
    r"`[^`]+`|"
    r"/[A-Za-z0-9_\-./]+|"
    r"\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?|"
    r"\((?:[A-Za-z0-9][A-Za-z0-9+.\-_/\\:@#%\s]*)\)|"
    r"[A-Za-z][A-Za-z0-9+.\-_/\\:@#%]*|"
    r"V\s*\d+(?:\.\d+)+|"
    r"\d+(?:\.\d+){1,3}"
    r")"
)


def _reshape_fa(chunk: str) -> str:
    if not chunk:
        return ""
    # RLM beside ASCII parens so mirrors stay correct next to Latin islands
    chunk = chunk.replace("(", "(" + _RLM).replace(")", _RLM + ")")
    return _RESHAPER.reshape(chunk)


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
            pieces.append(_reshape_fa(before))
        pieces.append(_LRE + match.group(0) + _PDF)
        cursor = match.end()
    if cursor < len(text):
        pieces.append(_reshape_fa(text[cursor:]))
    return get_display(_RLM + "".join(pieces))


def esc(text: str) -> str:
    return fa(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def register_fonts() -> tuple[str, str]:
    regular = FONTS / "Vazirmatn-Regular.ttf"
    bold = FONTS / "Vazirmatn-Bold.ttf"
    if not regular.is_file():
        regular = Path(r"C:\Windows\Fonts\tahoma.ttf")
        bold = Path(r"C:\Windows\Fonts\tahomabd.ttf")
        if not bold.is_file():
            bold = regular
    pdfmetrics.registerFont(TTFont("ReportFA", str(regular)))
    pdfmetrics.registerFont(TTFont("ReportFA-Bold", str(bold)))
    return "ReportFA", "ReportFA-Bold"


def styles(font: str, font_bold: str) -> dict[str, ParagraphStyle]:
    return {
        "cover_title": ParagraphStyle(
            "cover_title",
            fontName=font_bold,
            fontSize=20,
            leading=32,
            alignment=TA_CENTER,
            textColor=NAVY,
            spaceAfter=8,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            fontName=font,
            fontSize=12,
            leading=20,
            alignment=TA_CENTER,
            textColor=SLATE,
            spaceAfter=4,
        ),
        "h1": ParagraphStyle(
            "h1",
            fontName=font_bold,
            fontSize=14,
            leading=24,
            alignment=TA_RIGHT,
            textColor=NAVY,
            spaceBefore=14,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            fontName=font_bold,
            fontSize=12,
            leading=20,
            alignment=TA_RIGHT,
            textColor=NAVY2,
            spaceBefore=10,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            fontName=font,
            fontSize=10,
            leading=18,
            alignment=TA_RIGHT,
            textColor=SLATE,
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            fontName=font,
            fontSize=10,
            leading=17,
            alignment=TA_RIGHT,
            textColor=SLATE,
            rightIndent=4,
            spaceAfter=2,
        ),
        "meta": ParagraphStyle(
            "meta",
            fontName=font,
            fontSize=9,
            leading=14,
            alignment=TA_RIGHT,
            textColor=MUTED,
        ),
        "footer": ParagraphStyle(
            "footer",
            fontName=font,
            fontSize=8,
            leading=11,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
        "th": ParagraphStyle(
            "th",
            fontName=font_bold,
            fontSize=9,
            leading=14,
            alignment=TA_CENTER,
            textColor=WHITE,
        ),
        "td": ParagraphStyle(
            "td",
            fontName=font,
            fontSize=8.5,
            leading=13,
            alignment=TA_RIGHT,
            textColor=SLATE,
        ),
        "tdc": ParagraphStyle(
            "tdc",
            fontName=font,
            fontSize=8.5,
            leading=13,
            alignment=TA_CENTER,
            textColor=SLATE,
        ),
    }


def rule() -> HRFlowable:
    return HRFlowable(width="100%", thickness=1, color=LINE, spaceBefore=4, spaceAfter=8)


def bullet_block(items: list[str], st: ParagraphStyle) -> list:
    out = []
    for item in items:
        # Bullet after content so visual RTL keeps mark on the right
        out.append(Paragraph(esc(item + " •"), st))
    return out


def make_table(headers: list[str], rows: list[list[str]], st: dict) -> Table:
    # ReportLab col 0 is left; reverse so logical first column sits on the right
    headers_v = list(reversed(headers))
    rows_v = [list(reversed(r)) for r in rows]
    n = len(headers_v)
    data = [[Paragraph(esc(h), st["th"]) for h in headers_v]]
    for row in rows_v:
        cells = []
        for i, cell in enumerate(row):
            # rightmost logical date/hash column → last index after reverse
            style = st["tdc"] if i == n - 1 or i == n - 2 and n >= 3 else st["td"]
            if n == 2:
                style = st["td"] if i == 0 else st["tdc"]
            cells.append(Paragraph(esc(cell), style))
        data.append(cells)
    usable = A4[0] - 36 * mm
    if n == 2:
        col_w = [usable * 0.62, usable * 0.38]
    elif n == 3:
        col_w = [usable * 0.55, usable * 0.18, usable * 0.27]
    else:
        col_w = [usable / n] * n
    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("BACKGROUND", (0, 1), (-1, -1), WHITE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, ROW_ALT]),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def add_page_number(canvas, doc):
    canvas.saveState()
    page = doc.page
    canvas.setFont("ReportFA", 8)
    label = fa(f"صفحه {page}")
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(A4[0] / 2, 12 * mm, label)
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 16 * mm, A4[0] - 20 * mm, 16 * mm)
    canvas.restoreState()


def build() -> Path:
    font, font_bold = register_fonts()
    st = styles(font, font_bold)
    story: list = []

    # —— Cover ——
    story.append(Spacer(1, 28 * mm))
    story.append(Paragraph(esc("گزارش کار جامع"), st["cover_title"]))
    story.append(Paragraph(esc("پروژه سامانه مدیریت الکترولایزر آروند (PVC Arvand)"), st["cover_title"]))
    story.append(rule())
    story.append(Paragraph(esc("بازه زمانی: ۱۱ تا ۱۴ مهر ۱۴۰۵"), st["cover_sub"]))
    story.append(Paragraph(esc("نسخه نرم‌افزار در پایان بازه: V 1.06"), st["cover_sub"]))
    story.append(Paragraph(esc("مخزن GitHub: omidram/pvc-arvand-web — شاخه main"), st["cover_sub"]))
    story.append(Spacer(1, 10 * mm))
    story.append(
        Paragraph(
            esc(
                "این گزارش خلاصهٔ دقیق تمام کارهای انجام‌شده در سه روز اخیر است؛ "
                "شامل توسعهٔ کد، هم‌ترازی با Access، مدیریت دادهٔ کارخانه، رفع باگ‌های استقرار، و آماده‌سازی سرور."
            ),
            st["body"],
        )
    )
    story.append(Spacer(1, 8 * mm))
    story.append(
        make_table(
            ["فیلد", "مقدار"],
            [
                ["پروژه", "Arvand Electrolyzer Management / PVC Arvand Web"],
                ["آخرین کامیت", "5316feb — V 1.06"],
                ["دامنهٔ کار", "Frontend (Next.js) + Backend (FastAPI) + Deploy + Seed Data"],
                ["هدف عملیاتی", "هم‌ترازی با Access Uhde + برابری داده لپ‌تاپ/سرور + پایداری UI"],
            ],
            st,
        )
    )
    story.append(PageBreak())

    # —— Summary ——
    story.append(Paragraph(esc("۱. خلاصه اجرایی"), st["h1"]))
    story.append(rule())
    story.append(
        Paragraph(
            esc(
                "در سه روز گذشته تمرکز اصلی روی تکمیل قابلیت‌های عملیاتی سامانه، "
                "هم‌سان‌سازی رابط کاربری با فرم‌های Access اصلی Uhde، انتقال امن دادهٔ جداول کارخانه به GitHub، "
                "مدیریت رمز عبور ادمین، و رفع باگ‌های بحرانی استقرار روی سرور کارخانه (۱۹۲٫۱۶۸٫۲۰٫۲۵) بوده است."
            ),
            st["body"],
        )
    )
    story.append(Paragraph(esc("محورها به ترتیب اهمیت:"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "امنیت و کاربران: تغییر رمز ادمین، سیاست قدرت رمز، تنظیم رمز کاربران توسط ادمین",
                "داده و استقرار: seed دیتابیس گیاهی بدون ولتاژ (حدود ۷ مگابایت)، اسکریپت restore، مستندات deploy",
                "Datasheet View: نمایش همه فیلدهای فرم در جداول Assembly / Inspection / Assembly Inspection",
                "کمبوی الکترولایزر یکپارچه در کل برنامه + رفع باگ datalist که فقط A1 را نشان می‌داد",
                "Statistics و Shutdown مطابق Access (High Voltages، Un Distribution، Groups، Power)",
                "رفع هنگ Loading در Standardized Voltage → Input Elements",
                "نسخه‌گذاری منوی اصلی: Version : V 1.03 … V 1.06",
                "پشتیبانی استقرار سرور بدون Docker با screen (backend روی پورت ۸۰۱۰ / frontend روی پورت ۳۰۰۰)",
            ],
            st["bullet"],
        )
    )
    story.append(PageBreak())

    # —— Day by day ——
    story.append(Paragraph(esc("۲. گزارش روزبه‌روز"), st["h1"]))
    story.append(rule())

    story.append(Paragraph(esc("۲.۱ — روز اول: ۱۱ مهر ۱۴۰۵"), st["h2"]))
    story.append(
        Paragraph(
            esc("کامیت‌های اصلی: b553ebb، 7137274، 63343f4، 8c36473، ab7ee59، b95df07"),
            st["meta"],
        )
    )
    story.extend(
        bullet_block(
            [
                "RBAC در سطح فیلد، logout خودکار idle، و گزارش کار مدیرعامل (Word/PDF راست‌چین)",
                "فرم بازرسی مونتاژ Uhde (Assembly Inspection) با مدل، API، PDF و UI شیت",
                "کاتالوگ‌های Excel کارخانه در docs/plant-data: ANODE، CATHODE، TAFKIK، montage",
                "بهبود lookupهای combo برای آند/کاتد و جلوگیری از آلودگی لیست با سریال‌های کوتاه",
                "پیش‌فرض تقویم شمسی، رفع اندازه دکمه Plant Charts، جلوگیری از پیشنهاد پسورد Chrome روی فیلدهای غیرپسورد",
                "تنظیم frontend/.env برای API روی هاست LAN سرور ۱۹۲٫۱۶۸٫۲۰٫۲۵",
                "رفع خطای TypeScript در access-fields مربوط به type پسورد",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۲.۲ — روز دوم: ۱۳ مهر ۱۴۰۵"), st["h2"]))
    story.append(
        Paragraph(
            esc("کامیت‌های اصلی: f0cbac0، 5a9b2ae، e23ce2d، 9998d8d، 2b4486a"),
            st["meta"],
        )
    )
    story.extend(
        bullet_block(
            [
                "نرمال‌سازی سریال آند/کاتد به پیشوند A…/C… در import و seed Excel",
                "به‌روزرسانی deploy/update.sh و update.ps1 برای حفظ volume دیتابیس زنده",
                "بازنویسی آمار مصرف توان و فرم‌های Analysis نزدیک‌تر به Access",
                "مدیریت رمز: /auth/change-password، POST /users/{id}/password، policy قدرت رمز، دیالوگ تغییر رمز، صفحه Users",
                "کامپوننت مشترک ElectrolyzerCombo و اتصال در assembly، analyses، voltage، reports، monitoring، arrangement و …",
                "ساخت pvc_arvand_plant_seed.db (حدود ۷ مگابایت بدون voltage_readings/audit/alert) + restore_plant_seed.py + deploy/restore-plant-seed.sh",
                "Export اکسل shutdowns / causes / categories از DB زنده برای Git",
                "Datasheet View: حذف sheetMode=summary از Assembly Data؛ فیلدهای کامل Inspections و Assembly Inspection",
                "اصلاح export_plant_seed برای compact واقعی فایل seed (جلوگیری از فایل حدود ۸۰۰ مگابایت روی دیسک)",
                "به‌روزرسانی .gitignore با لیست مسیرهای دیتابیس و استثنای seed کامیت‌شده",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۲.۳ — روز سوم: ۱۴ مهر ۱۴۰۵"), st["h2"]))
    story.append(Paragraph(esc("کامیت اصلی: 5316feb (V 1.06) + کارهای پشتیبانی استقرار"), st["meta"]))
    story.extend(
        bullet_block(
            [
                "Shutdown List کاملاً قابل ویرایش با combo الکترولایزر، Code/Reason/Category و رابطه پرشدن خودکار فیلدها",
                "Analysis: برچسب دمای T به t در همه فرم‌ها",
                "Version در منوی اصلی از مقدار اشتباه Access (d) به Version: V 1.03…1.06 تغییر کرد (فایل app-version.ts)",
                "Statistics: نوار High Voltages مثل Access با Deviation بر حسب mV؛ Un Distribution هم‌تراز؛ حذف دکمه‌های تکراری و تاریخ میلادی در Average Power",
                "Groups: سه ماسک Access با API /statistics/group-voltages (avg-date / by-date / avg-el-date)",
                "رفع کمبوی الکترولایزر: جایگزینی datalist با select تا هر ۲۴ الکترولایزر (A1–M2) دیده شود",
                "رفع هنگ Input Elements: محدودسازی لیست به ۵۰۰ ردیف، فیلتر الکترولایزر/تاریخ، order by id به‌جای date روی حدود ۱٫۵ میلیون ردیف",
                "راهنمایی استقرار سرور بدون Docker با GNU screen (arvand_back / arvand_front)، ساخت venv به‌خاطر PEP 668، آزادسازی پورت ۸۰۱۰",
            ],
            st["bullet"],
        )
    )
    story.append(PageBreak())

    # —— Thematic sections ——
    story.append(Paragraph(esc("۳. جزئیات موضوعی کارها"), st["h1"]))
    story.append(rule())

    story.append(Paragraph(esc("۳.۱ امنیت و مدیریت کاربران"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "بک‌اند: require_password_strength، endpoint تغییر رمز خود کاربر و تنظیم رمز توسط ادمین",
                "فرانت: password-policy.ts، change-password-dialog، کنترل‌های session، فرم Users با Set password",
                "ترجمه‌های فارسی/انگلیسی برای سیاست رمز و پیام‌های خطا",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۳.۲ داده کارخانه و GitHub"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "علت کمبود داده روی سرور: git pull فقط کد می‌آورد؛ DB زنده در volume/instance است و در Git نیست",
                "seed کامیت‌شده شامل: elements≈۱۲۷۶۲، anodes≈۹۶۸۹، cathodes≈۹۶۶۰، membranes≈۹۸۳۳، electrode_segregations≈۳۱۹۸، shutdowns=۱۴",
                "عمداً حذف از seed: voltage_readings (حدود ۱٫۵ میلیون)، audit_logs، alert_events",
                "روی سرور: bash deploy/restore-plant-seed.sh (Docker) یا python3 scripts/restore_plant_seed.py --db … (بدون Docker)",
                "کپی کامل ولتاژها همچنان با scp فایل pvc_arvand.db (حدود ۷۸۰ مگابایت) طبق DEPLOY.md",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۳.۳ Datasheet و فرم‌ها"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "AccessWorkspace حالت پیش‌فرض fields: همه FieldDef فرم + ستون‌های اضافهٔ لیست",
                "Assembly Data: status، TBF/DOL و تمام فیلدهای پوشش/ریمارک در Datasheet",
                "Inspections و Assembly Inspection: فیلدهای اسکالر کامل؛ تصاویر امضا مخفی می‌مانند",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۳.۴ Statistics / Voltage / Shutdown"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "High Voltages: Date + Electrolyzer + Deviation > N mV from El. Average + Update Display؛ API threshold_mv",
                "Un Distribution: نوار فیلتر Access (U min/max/Step/Chart)، ستون‌های t An/t Ca/tm",
                "Groups: میانگین Un روزانه بر اساس گروه / گروه×الکترولایزر / الکترولایزر+تاریخ",
                "Shutdown: CRUD درون‌خطی، ElectrolyzerCombo، ارتباط Code↔Cause↔Category از جداول Reasons/Categories",
                "Voltage Input Elements: فیلتر + سقف ۵۰۰؛ جلوگیری از ORDER BY date روی کل جدول",
            ],
            st["bullet"],
        )
    )
    story.append(PageBreak())

    story.append(Paragraph(esc("۳.۵ نسخه و UI عمومی"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "فایل frontend/src/lib/app-version.ts — با هر انتشار ۰٫۰۱ افزایش (V 1.03 → V 1.06)",
                "منوی اصلی دیگر مقدار version ذخیره‌شده Access (حرف d) را نشان نمی‌دهد",
                "Analysis labels: T → t برای دما در anolyte/catholyte/brine/caustic",
            ],
            st["bullet"],
        )
    )

    story.append(Paragraph(esc("۳.۶ استقرار سرور کارخانه"), st["h2"]))
    story.extend(
        bullet_block(
            [
                "سرور: ۱۹۲٫۱۶۸٫۲۰٫۲۵ — فرانت پورت ۳۰۰۰، بک‌اند پورت ۸۰۱۰، بدون Docker روی این VM",
                "screen sessions: arvand_back / arvand_front (و گاهی backend)",
                "PEP 668: نصب پکیج فقط داخل backend/.venv",
                "health check صحیح: GET http://127.0.0.1:8010/health — مسیر /api/health درست نیست",
                "خطای address already in use: آزادسازی پورت با fuser -k 8010/tcp قبل از uvicorn",
            ],
            st["bullet"],
        )
    )

    # —— Commits table ——
    story.append(Paragraph(esc("۴. جدول کامیت‌های بازه"), st["h1"]))
    story.append(rule())
    story.append(
        make_table(
            ["تاریخ", "هش", "عنوان"],
            [
                ["۱۴ مهر ۱۴۰۵", "5316feb", "Statistics/Shutdown Access UX + الکترولایزر کامل + رفع هنگ Input Elements (V 1.06)"],
                ["۱۳ مهر ۱۴۰۵", "2b4486a", "Datasheet کامل + refresh plant seed"],
                ["۱۳ مهر ۱۴۰۵", "9998d8d", "Plant seed DB و restore برای برابری shutdown/جداول"],
                ["۱۳ مهر ۱۴۰۵", "e23ce2d", "ElectrolyzerCombo مشترک در فرم‌ها و فیلترها"],
                ["۱۳ مهر ۱۴۰۵", "5a9b2ae", "مدیریت رمز ادمین + سیاست قدرت رمز"],
                ["۱۳ مهر ۱۴۰۵", "f0cbac0", "Seed Excel با پیشوند A/C + حفظ DB در update"],
                ["۱۱ مهر ۱۴۰۵", "b95df07", "frontend .env برای API روی سرور کارخانه"],
                ["۱۱ مهر ۱۴۰۵", "ab7ee59", "رفع خطای TS access-fields"],
                ["۱۱ مهر ۱۴۰۵", "8c36473", "Combo آند/کاتد، شمسی پیش‌فرض، پسورد Chrome"],
                ["۱۱ مهر ۱۴۰۵", "63343f4", "Assembly Inspection + کاتالوگ Excel کارخانه"],
                ["۱۱ مهر ۱۴۰۵", "7137274", "گزارش Word راست‌چین مدیرعامل + فیکس TS ولتاژ"],
                ["۱۱ مهر ۱۴۰۵", "b553ebb", "RBAC فیلدی، آمار/shutdown Access-style، idle logout"],
            ],
            st,
        )
    )
    story.append(PageBreak())

    # —— Files ——
    story.append(Paragraph(esc("۵. مهم‌ترین فایل‌ها و مسیرها"), st["h1"]))
    story.append(rule())
    story.append(
        make_table(
            ["حوزه", "مسیر"],
            [
                ["نسخه UI", "frontend/src/lib/app-version.ts"],
                ["کمبوی الکترولایزر", "frontend/src/components/ui/electrolyzer-combo.tsx"],
                ["Datasheet fields", "frontend/src/lib/access-datasheet-fields.ts"],
                ["Shutdown List", "frontend/src/app/shutdowns/page.tsx"],
                ["Statistics", "frontend/src/app/statistics/page.tsx"],
                ["Voltage Input Elements", "frontend/src/app/voltage/page.tsx"],
                ["High deviation API", "backend/app/routers/voltage.py"],
                ["Group voltages API", "backend/app/routers/statistics.py"],
                ["Export/restore seed", "backend/scripts/export_plant_seed.py ، restore_plant_seed.py"],
                ["Deploy restore", "deploy/restore-plant-seed.sh ، docs/DEPLOY.md"],
                ["Plant seed DB", "docs/plant-data/pvc_arvand_plant_seed.db"],
            ],
            st,
        )
    )

    story.append(Paragraph(esc("۶. وضعیت فعلی و توصیه‌ها"), st["h1"]))
    story.append(rule())
    story.extend(
        bullet_block(
            [
                "کد آخرین نسخه روی GitHub main است (5316feb / V 1.06)",
                "برای سرور: git pull + ری‌استارت uvicorn از .venv + ری‌استارت next start در screen",
                "برای برابری جداول کارگاهی: اجرای restore_plant_seed روی DB زنده سرور",
                "برای برابری کامل ولتاژ: scp دیتابیس کامل لپ‌تاپ؛ seed گیت ولتاژ ندارد",
                "نسخه بعدی را با افزایش V 1.07 در app-version.ts ثبت کنید",
            ],
            st["bullet"],
        )
    )

    story.append(Spacer(1, 12 * mm))
    story.append(rule())
    story.append(Paragraph(esc("پایان گزارش — تهیه برای آرشیو پروژه PVC Arvand / آروند"), st["meta"]))
    story.append(Paragraph(esc("مرجع مخزن: https://github.com/omidram/pvc-arvand-web"), st["meta"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=20 * mm,
        title="گزارش کار ۳ روز اخیر — PVC Arvand",
        author="PVC Arvand Project",
    )
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"Wrote {path} ({path.stat().st_size / 1024:.1f} KB)")
