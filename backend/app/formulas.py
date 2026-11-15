"""Every calculation the program runs, with the numbers a plant engineer can change.

The expression of each formula stays in the code. Settings stores only the
numbers (loss factor, Faraday divisors, design capacity, …). A missing or
broken override falls back to the built-in default, so a bad save cannot
blank a calculation.
"""
from __future__ import annotations

import json
import math
from typing import Any

from sqlalchemy.orm import Session

from . import models


def _p(name: str, en: str, fa: str, default: float, unit: str = "", lo: float | None = None, hi: float | None = None) -> dict[str, Any]:
    return {"name": name, "label_en": en, "label_fa": fa, "default": float(default), "unit": unit, "min": lo, "max": hi}


FORMULAS: list[dict[str, Any]] = [
    {
        "key": "report_periods",
        "title_en": "Reporting periods",
        "title_fa": "بازه گزارش",
        "where_en": "Live voltage report (electricity cost and production cards) and the plant energy total.",
        "where_fa": "گزارش ولتاژ زنده (کارت هزینه برق و کارت تولید) و جمع انرژی واحد.",
        "calculates_en": "How many hours a day, a week and a month stand for when a rate is turned into a total.",
        "calculates_fa": "هر روز، هفته و ماه چند ساعت حساب می‌شود تا یک نرخ به جمع تبدیل شود.",
        "expression": "day = {hours_day} h, week = {hours_week} h, month = {hours_month} h",
        "params": [
            _p("hours_day", "Hours in a day", "ساعت در یک روز", 24, "h", 1, 48),
            _p("hours_week", "Hours in a week", "ساعت در یک هفته", 168, "h", 1, 336),
            _p("hours_month", "Hours in a month", "ساعت در یک ماه", 720, "h", 1, 1488),
        ],
    },
    {
        "key": "electricity_cost",
        "title_en": "Electricity cost",
        "title_fa": "هزینه برق",
        "where_en": "Main menu → Live voltage report → Electricity cost card. The toman price itself is edited under Plant settings.",
        "where_fa": "منوی اصلی ← گزارش ولتاژ زنده ← کارت هزینه برق. خود قیمت تومان در تنظیمات واحد ویرایش می‌شود.",
        "calculates_en": "Cost of the selected day, week or month from the average plant power.",
        "calculates_fa": "هزینه روز، هفته یا ماه انتخاب‌شده از روی توان متوسط واحد.",
        "expression": "((MW × {loss_factor} + {auxiliary_mw}) × hours) × 1000 × price",
        "params": [
            _p("loss_factor", "Loss factor on the MW", "ضریب تلفات روی مگاوات", 1.02, "", 0, 3),
            _p("auxiliary_mw", "Auxiliary load", "بار جانبی", 4.16, "MW", 0, 50),
        ],
    },
    {
        "key": "unit_capacity",
        "title_en": "Unit capacity",
        "title_fa": "ظرفیت واحد",
        "where_en": "Main menu → Live voltage report → Unit capacity card. The company plan percent is edited under Plant settings.",
        "where_fa": "منوی اصلی ← گزارش ولتاژ زنده ← کارت ظرفیت واحد. درصد برنامه شرکت در تنظیمات واحد ویرایش می‌شود.",
        "calculates_en": "Standard cell-room capacity. The card compares the live load with this, and with the company plan percent of it.",
        "calculates_fa": "ظرفیت استاندارد سل‌روم. کارت، بار لحظه‌ای را با این عدد و با درصد برنامه شرکت از آن مقایسه می‌کند.",
        "expression": "standard = {design_ka} kA; plan target = standard × plan% / 100; shown % = live kA / plan target × 100",
        "params": [
            _p("design_ka", "Standard unit capacity", "ظرفیت استاندارد واحد", 356.4, "kA", 1, 2000),
        ],
    },
    {
        "key": "production",
        "title_en": "Chlorine and caustic production",
        "title_fa": "تولید کلر و کاستیک",
        "where_en": "Live voltage report → Chlorine and caustic card, and the lost production of a shutdown.",
        "where_fa": "گزارش ولتاژ زنده ← کارت تولید کلر و کاستیک، و تولید ازدست‌رفته یک توقف.",
        "calculates_en": "Tons of chlorine and of NaOH 100% from the in-service kiloamperes.",
        "calculates_fa": "تُن کلر و سود ۱۰۰٪ از روی کیلوآمپر در سرویس.",
        "expression": "chlorine t = kA × {cl2_ton_per_ka_hour} × hours; caustic t = kA × {naoh_ton_per_ka_hour} × hours",
        "params": [
            _p("cl2_ton_per_ka_hour", "Chlorine per kA per hour", "کلر به ازای هر کیلوآمپر در ساعت", 0.2074, "t", 0, 5),
            _p("naoh_ton_per_ka_hour", "NaOH 100% per kA per hour", "سود ۱۰۰٪ به ازای هر کیلوآمپر در ساعت", 0.2336, "t", 0, 5),
        ],
    },
    {
        "key": "plant_power",
        "title_en": "Plant power and energy",
        "title_fa": "توان و انرژی واحد",
        "where_en": "Live voltage report → Plant total current, Average plant power, and the electrolyzer bars.",
        "where_fa": "گزارش ولتاژ زنده ← جریان کل واحد، توان متوسط واحد، و نمودار الکترولایزرها.",
        "calculates_en": "Electrical power from the cell-stack voltage and the shift-report current, then energy over a day.",
        "calculates_fa": "توان الکتریکی از ولتاژ مجموعه سلول‌ها و جریان گزارش شیفت، سپس انرژی در یک روز.",
        "expression": "kW = stack voltage (V) × current (kA), when the stack is above {stack_min_v} V; kA below {offline_ka} counts as off when there is no shift report; kWh = kW × hours in a day; MW = kW / 1000",
        "params": [
            _p("stack_min_v", "Minimum stack voltage that counts", "کمترین ولتاژ مجموعه که حساب می‌شود", 50, "V", 0, 500),
            _p("offline_ka", "Current treated as offline", "جریانی که خاموش حساب می‌شود", 1, "kA", 0, 20),
        ],
    },
    {
        "key": "standardized_voltage",
        "title_en": "Standardized voltage (Un)",
        "title_fa": "ولتاژ استاندارد (Un)",
        "where_en": "Voltage → Standardized voltage, and the Un/CE pages. iRef, tKorr and cKorr are edited in Correction factors.",
        "where_fa": "ولتاژ ← ولتاژ استاندارد، و صفحه‌های Un/CE. چگالی جریان مرجع و ضرایب دما و غلظت در تب ضرایب تصحیح ویرایش می‌شوند.",
        "calculates_en": "Cell voltage brought back to the reference current density, temperature and concentration (Access UnBer).",
        "calculates_fa": "ولتاژ سلول که به چگالی جریان، دما و غلظت مرجع برگردانده می‌شود (فرمول UnBer اکسس).",
        "expression": "Un = {u0} + (iRef / i) × (U − {u0}) − ({t_ref} − t) × tKorr + ({c_ref} − c) × cKorr; element temperature correction, when on: t − (Um − Ui) × {temp_span}",
        "params": [
            _p("u0", "Zero-load voltage U0", "ولتاژ بار صفر U0", 2.42, "V", 0, 5),
            _p("t_ref", "Reference temperature", "دمای مرجع", 90, "°C", 0, 120),
            _p("c_ref", "Reference NaOH concentration", "غلظت مرجع سود", 32, "%", 0, 60),
            _p("temp_span", "Element temperature-correction span", "ضریب تصحیح دمای المنت", 30, "", 0, 200),
        ],
    },
    {
        "key": "anodic_ce",
        "title_en": "Anodic current efficiency",
        "title_fa": "بازده جریان آندی",
        "where_en": "Current efficiency page and the Un/CE anodic balance (Access Eta*Ber).",
        "where_fa": "صفحه بازده جریان و تراز آندی Un/CE (فرمول‌های Eta*Ber اکسس).",
        "calculates_en": "The share of current lost to chlorate, hypochlorite, acid, oxygen, alkali and carbonate, and the membrane efficiency that remains.",
        "calculates_fa": "سهم جریان که صرف کلرات، هیپوکلریت، اسید، اکسیژن، قلیا و کربنات می‌شود، و بازده ممبرانی که می‌ماند.",
        "expression": "ηNaClO3 = ((c_an × V') − (c_pb × V)) / (n × kA × {f_naclo3}) × 100; ηHOCl = (c × V') / (n × kA × {f_hocl}) × 100; ηNaOCl = (c × V') / (n × kA × {f_naclo}) × 100; ηHCl = ((c_pb × V) − (c_an × V')) / (n × kA × {f_hcl}) × 100; ηAlkali = (c × V) / (n × kA × {f_alkali}) × 100; ηNa2CO3 = (c × V) / (n × kA × {f_na2co3}) × 100; ηO2 = 2 × (YO2 − {o2_background} + AKF) / (YCl2 + 2 × YO2) × (100 − ηNaClO3 − ηHOCl); ηmembrane = 100 − ηO2 − ηNaClO3 − ηHOCl − ηHCl + ηNa2CO3 + ηAlkali",
        "params": [
            _p("f_naclo3", "NaClO3 divisor", "مقسوم‌علیه کلرات", 0.662, "", 0.01, 20),
            _p("f_hocl", "HOCl divisor", "مقسوم‌علیه HOCl", 0.98, "", 0.01, 20),
            _p("f_naclo", "NaOCl divisor", "مقسوم‌علیه NaOCl", 1.38869, "", 0.01, 20),
            _p("f_hcl", "HCl divisor", "مقسوم‌علیه اسید", 1.36, "", 0.01, 20),
            _p("f_alkali", "Alkali / Faraday divisor", "مقسوم‌علیه قلیا (فارادی)", 1.4923, "", 0.01, 20),
            _p("f_na2co3", "Na2CO3 divisor", "مقسوم‌علیه کربنات", 1.978, "", 0.01, 20),
            _p("o2_background", "Oxygen background", "اکسیژن زمینه", 0.18, "%", 0, 5),
        ],
    },
    {
        "key": "spc",
        "title_en": "Specific power consumption (SPC)",
        "title_fa": "مصرف ویژه انرژی (SPC)",
        "where_en": "Un/CE → SPC board (Access SPCBer). The Faraday divisor is the alkali factor of the anodic efficiency formula.",
        "where_fa": "Un/CE ← تابلوی SPC (فرمول SPCBer اکسس). مقسوم‌علیه فارادی همان ضریب قلیای فرمول بازده آندی است.",
        "calculates_en": "Kilowatt-hours per ton of NaOH 100% from the standardized voltage and the current efficiency.",
        "calculates_fa": "کیلووات‌ساعت برای هر تُن سود ۱۰۰٪ از ولتاژ استاندارد و بازده جریان.",
        "expression": "SPC = Un × {scale} / (alkali Faraday × CE)",
        "params": [
            _p("scale", "SPC scale", "ضریب SPC", 100000, "", 1, 1_000_000),
        ],
    },
    {
        "key": "cathodic_ce",
        "title_en": "Cathodic current efficiency",
        "title_fa": "بازده جریان کاتدی",
        "where_en": "Cathodic efficiency sheet for Train 1 and Train 2 (the plant workbook).",
        "where_fa": "برگه بازده کاتدی قطار ۱ و قطار ۲ (دفترچه واحد).",
        "calculates_en": "Current density, theoretical and corrected voltage, power efficiency and cathodic CE from the three daily readings.",
        "calculates_fa": "چگالی جریان، ولتاژ تئوری و تصحیح‌شده، بازده توان و بازده کاتدی از سه قرائت روزانه.",
        "expression": "j30 = Σ load / ({area_m2} × on); q32 = (({theory_slope} × j30 + {theory_intercept}) × {theory_scale}) / ({faraday} × {theory_ce}); q34 = q33 − (({temp_ref} − t) × {temp_num} × j30) / {temp_den}; q37 = (100 × production × 1000) / (avg kA × {day_hours} × {faraday} × {elements} × on); q39 = (production × {prod_factor} × {prod_hours}) / (j30 × on)",
        "params": [
            _p("area_m2", "Electrode area", "سطح الکترود", 2.72, "m²", 0.1, 20),
            _p("elements", "Cells in the design count", "تعداد سلول در فرمول", 163, "", 1, 400),
            _p("faraday", "Faraday factor", "ضریب فارادی", 1.4923, "", 0.01, 20),
            _p("theory_slope", "Theoretical voltage slope", "شیب ولتاژ تئوری", 0.1265, "", 0, 5),
            _p("theory_intercept", "Theoretical voltage base", "پایه ولتاژ تئوری", 2.4, "V", 0, 5),
            _p("theory_scale", "Theoretical voltage scale", "ضریب ولتاژ تئوری", 1000, "", 1, 10000),
            _p("theory_ce", "CE assumed in the theoretical voltage", "بازده فرض‌شده در ولتاژ تئوری", 0.95, "", 0.1, 1.5),
            _p("temp_ref", "Reference temperature", "دمای مرجع", 90, "°C", 0, 120),
            _p("temp_num", "Temperature correction numerator", "صورت تصحیح دما", 7, "", 0, 100),
            _p("temp_den", "Temperature correction denominator", "مخرج تصحیح دما", 3, "", 0.1, 100),
            _p("prod_factor", "Production factor", "ضریب تولید", 5.46, "", 0, 50),
            _p("prod_hours", "Production hours factor", "ساعت در ضریب تولید", 12, "h", 0, 48),
            _p("day_hours", "Hours in the daily balance", "ساعت تراز روزانه", 24, "h", 1, 48),
        ],
    },
    {
        "key": "sec",
        "title_en": "Specific consumption match (SEC)",
        "title_fa": "تطابق مصرف ویژه (SEC)",
        "where_en": "Monitoring schematic and the SEC match summary. Compares the live cell voltage with the design load curve.",
        "where_fa": "شماتیک مانیتورینگ و خلاصه تطابق SEC. ولتاژ زنده سلول را با منحنی طراحی بار مقایسه می‌کند.",
        "calculates_en": "Actual and design kWh per ton of NaOH, and how far the cell is from the design curve.",
        "calculates_fa": "کیلووات‌ساعت واقعی و طراحی برای هر تُن سود، و فاصله سلول از منحنی طراحی.",
        "expression": "design V = {v0} + {slope} × (kA / {rated_ka}); SEC = V × {cells} × {k}; match is ok up to {ok_pct}% away and a warning up to {warn_pct}%",
        "params": [
            _p("k", "Faraday constant K", "ثابت فارادی K", 4.277, "kWh/V·t", 0.1, 20),
            _p("v0", "Design voltage at zero load", "ولتاژ طراحی در بار صفر", 2.39, "V", 0, 5),
            _p("slope", "Design voltage slope", "شیب ولتاژ طراحی", 0.126, "", 0, 2),
            _p("cells", "Cells per electrolyzer", "سلول در هر الکترولایزر", 163, "", 1, 400),
            _p("rated_ka", "Rated current", "جریان نامی", 14.85, "kA", 0.1, 40),
            _p("ok_pct", "OK up to this gap", "تا این درصد سبز است", 3, "%", 0, 50),
            _p("warn_pct", "Warning up to this gap", "تا این درصد هشدار است", 8, "%", 0, 50),
        ],
    },
    {
        "key": "cell_health",
        "title_en": "Cell health score",
        "title_fa": "امتیاز سلامت سلول",
        "where_en": "Monitoring → cell health board (shown only after Plant settings turns it on).",
        "where_fa": "مانیتورینگ ← تابلوی سلامت سلول (فقط بعد از روشن کردن آن در تنظیمات واحد).",
        "calculates_en": "A 0–100 score: weighted average of peer voltage, voltage trend, standardized voltage, current efficiency, membrane life and the shared electrolyzer conditions.",
        "calculates_fa": "امتیاز ۰ تا ۱۰۰: میانگین وزنی ولتاژ نسبت به همسایه‌ها، روند ولتاژ، ولتاژ استاندارد، بازده جریان، عمر ممبران و شرایط مشترک الکترولایزر.",
        "expression": "score = Σ (factor score × weight) / Σ weight; status is ok from {status_ok}, watch from {status_watch}, investigate from {status_investigate}, otherwise critical",
        "params": [
            _p("w_peer_voltage", "Weight: peer voltage", "وزن: ولتاژ نسبت به بقیه", 3, "", 0, 20),
            _p("w_voltage_trend", "Weight: voltage trend", "وزن: روند ولتاژ", 2, "", 0, 20),
            _p("w_un_ce", "Weight: standardized voltage", "وزن: ولتاژ استاندارد", 2, "", 0, 20),
            _p("w_current_efficiency", "Weight: current efficiency", "وزن: بازده جریان", 2, "", 0, 20),
            _p("w_life", "Weight: membrane life", "وزن: عمر ممبران", 1, "", 0, 20),
            _p("w_electrolyzer", "Weight: electrolyzer conditions", "وزن: شرایط الکترولایزر", 1, "", 0, 20),
            _p("status_ok", "OK from this score", "خوب از این امتیاز", 80, "", 0, 100),
            _p("status_watch", "Watch from this score", "مراقبت از این امتیاز", 60, "", 0, 100),
            _p("status_investigate", "Investigate from this score", "بررسی از این امتیاز", 40, "", 0, 100),
            _p("peer_near", "Peer gap still ok", "اختلاف ولتاژ که هنوز خوب است", 0.02, "V", 0, 2),
            _p("peer_watch", "Peer gap: watch", "اختلاف ولتاژ: مراقبت", 0.05, "V", 0, 2),
            _p("peer_investigate", "Peer gap: investigate", "اختلاف ولتاژ: بررسی", 0.10, "V", 0, 2),
            _p("peer_critical", "Peer gap: critical", "اختلاف ولتاژ: بحرانی", 0.18, "V", 0, 2),
            _p("trend_steady", "Trend still steady", "روند که هنوز ثابت است", 0.2, "mV/day", 0, 20),
            _p("trend_watch", "Trend: watch", "روند: مراقبت", 0.4, "mV/day", 0, 20),
            _p("trend_investigate", "Trend: investigate", "روند: بررسی", 1.0, "mV/day", 0, 20),
            _p("trend_high", "Trend: high", "روند: بالا", 2.0, "mV/day", 0, 20),
            _p("trend_se_factor", "Trend must exceed its error by", "روند باید چند برابر خطایش باشد", 2, "", 0, 10),
            _p("temp_warn_low", "Preferred temperature, low", "دمای مطلوب، پایین", 80, "°C", 0, 120),
            _p("temp_warn_high", "Preferred temperature, high", "دمای مطلوب، بالا", 92, "°C", 0, 120),
            _p("temp_danger_low", "Safe temperature, low", "دمای ایمن، پایین", 75, "°C", 0, 120),
            _p("temp_danger_high", "Safe temperature, high", "دمای ایمن، بالا", 95, "°C", 0, 120),
            _p("naoh_low", "Preferred NaOH, low", "سود مطلوب، پایین", 30, "%", 0, 60),
            _p("naoh_high", "Preferred NaOH, high", "سود مطلوب، بالا", 34, "%", 0, 60),
            _p("delta_p_warn", "ΔP warning", "هشدار اختلاف فشار", 50, "mbar", 0, 1000),
            _p("ce_a", "CE band A", "بازده باند A", 96, "%", 0, 120),
            _p("ce_b", "CE band B", "بازده باند B", 94, "%", 0, 120),
            _p("ce_c", "CE band C", "بازده باند C", 92, "%", 0, 120),
            _p("ce_d", "CE band D", "بازده باند D", 90, "%", 0, 120),
            _p("un_a", "Un band A", "ولتاژ استاندارد باند A", 3.05, "V", 0, 6),
            _p("un_b", "Un band B", "ولتاژ استاندارد باند B", 3.15, "V", 0, 6),
            _p("un_c", "Un band C", "ولتاژ استاندارد باند C", 3.25, "V", 0, 6),
            _p("un_d", "Un band D", "ولتاژ استاندارد باند D", 3.40, "V", 0, 6),
            _p("ka_good_low", "Good current, low", "جریان خوب، پایین", 8, "kA", 0, 40),
            _p("ka_good_high", "Good current, high", "جریان خوب، بالا", 16, "kA", 0, 40),
            _p("ka_edge_low", "Acceptable current, low", "جریان قابل قبول، پایین", 6, "kA", 0, 40),
            _p("ka_edge_high", "Acceptable current, high", "جریان قابل قبول، بالا", 18, "kA", 0, 40),
            _p("spc_a", "SPC band A", "مصرف ویژه باند A", 2100, "kWh/t", 0, 20000),
            _p("spc_b", "SPC band B", "مصرف ویژه باند B", 2300, "kWh/t", 0, 20000),
            _p("spc_c", "SPC band C", "مصرف ویژه باند C", 2500, "kWh/t", 0, 20000),
            _p("brine_ca_mg", "Brine Ca+Mg limit", "حد کلسیم و منیزیم آب‌نمک", 20, "ppb", 0, 10000),
            _p("brine_fe", "Brine iron limit", "حد آهن آب‌نمک", 50, "ppb", 0, 10000),
            _p("brine_al", "Brine aluminium limit", "حد آلومینیوم آب‌نمک", 50, "ppb", 0, 10000),
            _p("brine_sio2", "Brine silica limit", "حد سیلیس آب‌نمک", 500, "ppb", 0, 100000),
            _p("brine_sulfate", "Brine sulfate limit", "حد سولفات آب‌نمک", 8, "g/L", 0, 1000),
            _p("brine_organics", "Brine organics limit", "حد مواد آلی آب‌نمک", 1, "", 0, 1000),
            _p("envelope_warn", "Penalty for a warning condition", "جریمه یک شرط هشدار", 8, "", 0, 100),
            _p("envelope_danger", "Penalty for a danger condition", "جریمه یک شرط خطر", 18, "", 0, 100),
            _p("life_full", "Membrane life still full up to", "عمر ممبران تا این درصد هنوز کامل است", 50, "%", 0, 200),
            _p("life_watch", "Membrane life: watch from", "عمر ممبران: مراقبت از", 75, "%", 0, 200),
            _p("life_high", "Membrane life: high from", "عمر ممبران: بالا از", 90, "%", 0, 200),
            _p("life_end", "Membrane life: at design life", "عمر ممبران: در عمر طراحی", 100, "%", 0, 300),
            _p("peer_low_ok", "Below the median, still ok", "پایین‌تر از میانه، هنوز خوب", 0.10, "V", 0, 2),
            _p("peer_low_watch", "Below the median: watch", "پایین‌تر از میانه: مراقبت", 0.20, "V", 0, 2),
            _p("peer_low_investigate", "Below the median: investigate", "پایین‌تر از میانه: بررسی", 0.35, "V", 0, 2),
        ],
    },
]

_BY_KEY = {row["key"]: row for row in FORMULAS}


def defaults(key: str) -> dict[str, float]:
    return {item["name"]: float(item["default"]) for item in _BY_KEY[key]["params"]}


def bundle(db: Session | None) -> dict[str, dict[str, float]]:
    """Current numbers for every formula. Cached on the database session for this request."""
    if db is not None:
        cached = db.info.get("formula_bundle")
        if isinstance(cached, dict):
            return cached
    merged = {row["key"]: defaults(row["key"]) for row in FORMULAS}
    if db is None:
        return merged
    for row in db.query(models.FormulaOverride).all():
        if row.key not in merged or not row.params_json:
            continue
        try:
            saved = json.loads(row.params_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(saved, dict):
            continue
        spec = {item["name"]: item for item in _BY_KEY[row.key]["params"]}
        for name, value in saved.items():
            if name not in spec:
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(number):
                continue
            merged[row.key][name] = number
    db.info["formula_bundle"] = merged
    return merged


def value(db: Session | None, key: str, name: str) -> float:
    return bundle(db)[key][name]


def public(db: Session | None) -> list[dict[str, Any]]:
    current = bundle(db)
    out = []
    for row in FORMULAS:
        numbers = current[row["key"]]
        params = []
        for item in row["params"]:
            params.append({**item, "value": numbers[item["name"]]})
        out.append({**{k: v for k, v in row.items() if k != "params"}, "params": params})
    return out


def _check(key: str, params: dict[str, Any]) -> dict[str, float]:
    spec = _BY_KEY.get(key)
    if spec is None:
        raise KeyError(key)
    allowed = {item["name"]: item for item in spec["params"]}
    unknown = [name for name in params if name not in allowed]
    if unknown:
        raise ValueError("unknown:" + ",".join(unknown))
    clean: dict[str, float] = {}
    for name, raw in params.items():
        try:
            number = float(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} is not a number") from exc
        if not math.isfinite(number):
            raise ValueError(f"{name} is not a number")
        item = allowed[name]
        if item["min"] is not None and number < item["min"]:
            raise ValueError(f"{name} is below {item['min']}")
        if item["max"] is not None and number > item["max"]:
            raise ValueError(f"{name} is above {item['max']}")
        clean[name] = number
    return clean


def save(db: Session, key: str, params: dict[str, Any]) -> dict[str, Any]:
    clean = _check(key, params)
    row = db.get(models.FormulaOverride, key)
    if row is None:
        row = models.FormulaOverride(key=key, params_json="{}")
        db.add(row)
    stored: dict[str, Any] = {}
    if row.params_json:
        try:
            loaded = json.loads(row.params_json)
            if isinstance(loaded, dict):
                stored = loaded
        except (TypeError, ValueError):
            stored = {}
    stored.update(clean)
    row.params_json = json.dumps(stored)
    db.info.pop("formula_bundle", None)
    db.commit()
    return next(item for item in public(db) if item["key"] == key)


def reset(db: Session, key: str) -> dict[str, Any]:
    if key not in _BY_KEY:
        raise KeyError(key)
    row = db.get(models.FormulaOverride, key)
    if row is not None:
        db.delete(row)
    db.info.pop("formula_bundle", None)
    db.commit()
    return next(item for item in public(db) if item["key"] == key)
