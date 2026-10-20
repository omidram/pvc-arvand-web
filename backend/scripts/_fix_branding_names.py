from pathlib import Path

files = [
    Path("frontend/src/lib/i18n/translations.ts"),
    Path("frontend-modern/src/lib/i18n/translations.ts"),
    Path("backend/app/main.py"),
    Path("frontend/src/app/layout.tsx"),
    Path("frontend-modern/src/app/layout.tsx"),
]

replacements = [
    ("Arvand Electrolyser Management Program", "Arvand Electrolyzer Management Program"),
    ('name: "PVC Arvand"', 'name: "Arvand Electrolyzer Management Program"'),
    ('name: "پی‌وی‌سی اروند"', 'name: "Arvand Electrolyzer Management Program"'),
    ('subtitle: "Electrolyzer Management Program"', 'subtitle: "Arvand Petrochemical Company"'),
    ('subtitle: "برنامه مدیریت الکترولایزر"', 'subtitle: "شرکت پتروشیمی اروند"'),
    ('programTitle: "Element Administration Program"', 'programTitle: "Arvand Electrolyzer Management Program"'),
    ('programTitle: "برنامه مدیریت المان"', 'programTitle: "Arvand Electrolyzer Management Program"'),
    ('title: "PVC Arvand | Uhde Administrator"', 'title: "Arvand Electrolyzer Management Program"'),
    ("PVC Arvand - Electrolyzer Management System", "Arvand Electrolyzer Management Program"),
]

for path in files:
    if not path.exists():
        print("missing", path)
        continue
    text = path.read_text(encoding="utf-8")
    new = text
    for old, repl in replacements:
        new = new.replace(old, repl)
    if new != text:
        path.write_text(new, encoding="utf-8")
        print("updated", path)
    else:
        print("nochange", path)

# Add tip strings if missing
tip_en = (
    '    historyValue: "Value",\n'
    '    tipLoadToday: "Load (same day)",\n'
    '    tipLoadPrevDay: "Load (previous day)",\n'
    '    tipLoadPrev2Day: "Load (2 days ago)",\n'
)
tip_fa = (
    '    historyValue: "مقدار",\n'
    '    tipLoadToday: "آمپر (همان روز)",\n'
    '    tipLoadPrevDay: "آمپر (روز قبل)",\n'
    '    tipLoadPrev2Day: "آمپر (دو روز قبل)",\n'
)
auth_en = (
    '    loginTitle: "Sign in",\n'
    '    brandFooter: "Arvand Petrochemical Company",\n'
)
auth_fa = (
    '    loginTitle: "ورود به سیستم",\n'
    '    brandFooter: "شرکت پتروشیمی اروند",\n'
)

trans = Path("frontend/src/lib/i18n/translations.ts")
text = trans.read_text(encoding="utf-8")
if "tipLoadToday" not in text:
    text = text.replace('    historyValue: "Value",\n', tip_en, 1)
    text = text.replace('    historyValue: "مقدار",\n', tip_fa, 1)
if "brandFooter" not in text:
    text = text.replace('    loginTitle: "Sign in",\n', auth_en, 1)
    text = text.replace('    loginTitle: "ورود به سیستم",\n', auth_fa, 1)
# voltage sync lookback strings may have been lost on checkout - check
if "lookbackPreset" not in text and 'lookbackDays: "Days to pull"' in text:
    text = text.replace(
        '    lookbackDays: "Days to pull",\n    lookbackDaysHelp: "Scheduled run ends yesterday. Sync Now also includes today.",\n',
        '    lookbackDays: "How many past days to download",\n'
        '    lookbackDaysHelp: "Pull this many calendar days from AriaORMS (ending yesterday on the schedule, including today on Sync Now). Use 7–14 if L2/M2 or others look empty after outages.",\n'
        '    lookbackPreset: "{days} days",\n',
        1,
    )
if "lookbackPreset" not in text or "چند روز قبل" not in text:
    text = text.replace(
        '    lookbackDays: "تعداد روزهای دریافت",\n    lookbackDaysHelp: "اجرای زمان‌بندی‌شده تا دیروز است. «اکنون» امروز را هم شامل می‌شود.",\n',
        '    lookbackDays: "چند روز قبل را دریافت کند",\n'
        '    lookbackDaysHelp: "تعداد روزهایی که از AriaORMS گرفته می‌شود (در زمان‌بندی تا دیروز؛ با «اکنون» امروز هم هست). اگر L2/M2 خالی به نظر می‌رسد ۷ تا ۱۴ روز بگذارید.",\n'
        '    lookbackPreset: "{days} روز",\n',
        1,
    )
trans.write_text(text, encoding="utf-8")
print("translations tips/footer ok")
