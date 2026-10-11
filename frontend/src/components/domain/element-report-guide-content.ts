/** Localized copy for the Element Report / Element Dashboard in-app guide. */

export type GuideLocale = "en" | "fa";

export type GuideSectionId =
  | "intro"
  | "places"
  | "lifecycle"
  | "report"
  | "tabs"
  | "fields"
  | "relations"
  | "workflows"
  | "tips";

export interface GuideField {
  name: string;
  meaning: string;
}

export interface GuideStep {
  title: string;
  body: string;
}

export interface GuideTab {
  name: string;
  body: string;
}

export interface GuideContent {
  title: string;
  subtitle: string;
  openGuide: string;
  sections: { id: GuideSectionId; label: string }[];
  intro: { lead: string; points: string[] };
  places: { lead: string; cards: { title: string; body: string }[] };
  lifecycle: { lead: string; stages: { key: string; title: string; body: string }[] };
  report: {
    lead: string;
    banner: { title: string; body: string }[];
    chips: { title: string; body: string }[];
    gauges: { title: string; body: string }[];
  };
  tabs: { lead: string; items: GuideTab[] };
  fields: { lead: string; items: GuideField[] };
  relations: {
    lead: string;
    nodes: { id: string; title: string; body: string }[];
    links: { from: string; to: string; label: string }[];
    notes: string[];
  };
  workflows: { lead: string; items: GuideStep[] };
  tips: { lead: string; items: string[] };
}

const en: GuideContent = {
  title: "Element Report & Dashboard Guide",
  subtitle: "How the plant, cell shop, parts and coating fit together — and what every number means",
  openGuide: "Guide",
  sections: [
    { id: "intro", label: "What it is" },
    { id: "places", label: "Where to find it" },
    { id: "lifecycle", label: "Element life cycle" },
    { id: "report", label: "Main Menu report" },
    { id: "tabs", label: "Dashboard tabs" },
    { id: "fields", label: "Fields glossary" },
    { id: "relations", label: "Table relations" },
    { id: "workflows", label: "How to work" },
    { id: "tips", label: "Tips" },
  ],
  intro: {
    lead: "Element Report is the management view of every cell (element) and its three parts: anode, cathode and membrane. It answers — in one place — where elements are, which parts are near end of life, what is at the coater, and whether the serial numbers in the tables still match.",
    points: [
      "Live numbers refresh about every 60 seconds from Assembly Data, warehouse, recoating and voltage alerts.",
      "Clicking a card or stage opens the full Element Dashboard with the matching filter already set.",
      "Life warnings use the day-limits you set under Limits. Until you enter the real design life, the defaults are only placeholders.",
    ],
  },
  places: {
    lead: "The same family of numbers appears in two places — a compact report and the full dashboard.",
    cards: [
      {
        title: "Element Report (Main Menu / Overview)",
        body: "A compact strip under the live voltage report. Shows plant occupancy, shop readiness, life warnings, coating status and the eight life-cycle stages. Built for a manager who needs the pulse of the plant without leaving the home screen.",
      },
      {
        title: "Element Dashboard (/element-dashboard)",
        body: "The full workplace: Overview, Cell Shop, Parts (DOL), Installed Parts, Coating, Data Integrity and Limits. Use it to move elements through the shop, export lists and repair spelling mismatches.",
      },
      {
        title: "Who can see it",
        body: "Anyone with view access to Elements, Anodes, Cathodes, Membranes or Warehouse. Repair buttons on Data Integrity need an administrator.",
      },
    ],
  },
  lifecycle: {
    lead: "An element moves from the plant into the cell shop and back. Stages are derived from Assembly Data dates, plus optional shop stages you set by hand (or that an assembly-inspection report sets for you).",
    stages: [
      { key: "in_service", title: "In service", body: "Commissioned and running in an electrolyzer. Counts toward plant occupancy." },
      { key: "installed", title: "Installed", body: "Assembled in a cell but not yet commissioned. Still in the plant, not in the shop pipeline." },
      { key: "decommissioned", title: "Decommissioned", body: "Shut down. Must go to the cell shop. This is the first shop signal." },
      { key: "awaiting_disassembly", title: "Waiting for disassembly", body: "In the shop, waiting to be taken apart. Set manually when the element arrives." },
      { key: "disassembled", title: "Disassembled", body: "Taken apart (disassembly date in Assembly Data). Recent counts show the last 30 days." },
      { key: "awaiting_assembly", title: "Waiting for assembly", body: "Parts ready; waiting for assembly to start." },
      { key: "assembling", title: "Being assembled", body: "Assembly in progress. An unsigned assembly-inspection report also puts the element here." },
      { key: "awaiting_qc", title: "Assembled, waiting for QC", body: "Maintenance/process signatures done; waiting for the inspector signature." },
      { key: "ready", title: "Ready in shop", body: "Passed QC (or marked ready). Available to install or commission again." },
    ],
  },
  report: {
    lead: "Each block on the Main Menu Element Report has one job. Click it to jump into the dashboard.",
    banner: [
      { title: "In service / capacity", body: "How many elements are commissioned versus the plant capacity (24 × 168 = 4032 cells)." },
      { title: "Ready in shop", body: "Elements that finished QC and can go back into the plant." },
      { title: "In the cell shop", body: "Sum of shop stages from waiting for disassembly through ready (not counting plain “disassembled” stock)." },
    ],
    chips: [
      { title: "To send to the shop", body: "Decommissioned + waiting for disassembly — elements that still need shop attention." },
      { title: "Parts near end of life", body: "Installed anodes, cathodes and membranes in warning or past the life limit." },
      { title: "At coater · to coat", body: "Pieces currently away at the coater, and pieces not installed that should be sent next." },
    ],
    gauges: [
      { title: "Plant occupancy", body: "Share of capacity that is in service, installed or decommissioned (still in the plant)." },
      { title: "Parts in good life", body: "Share of installed parts whose life used is still below the warning threshold. Needs real life limits." },
      { title: "Shop readiness", body: "Share of shop work that is already in the Ready stage." },
      { title: "Reaching limit in 90 days", body: "Installed parts that will hit the life limit within the next 90 days (not yet expired)." },
    ],
  },
  tabs: {
    lead: "Open the Element Dashboard from the Main Menu button, the sidebar, or any report card.",
    items: [
      {
        name: "Overview",
        body: "Pipeline cards, KPI row, charts by electrolyzer and monthly flow, life histograms, oldest waiting elements and recent shop moves. The starting board for a daily check.",
      },
      {
        name: "Cell Shop",
        body: "List elements by stage, select many rows or paste numbers, move them to the next stage with an optional note, or clear the stage. History per element is one click away. Export the list to CSV.",
      },
      {
        name: "Anodes / Cathodes / Membranes",
        body: "DOL and life used for every serial. Filter by where (installed / not installed), life status, “due within N days”, and DOL range. Sort columns and export.",
      },
      {
        name: "Installed Parts",
        body: "Which anode, cathode and membrane sit on which element, fill per electrolyzer, and serials that are wrongly recorded in more than one cell.",
      },
      {
        name: "Coating",
        body: "Recoating jobs: at the coater, returned waiting for check, should go now, installed and due. Charts by year/month and by coater.",
      },
      {
        name: "Data Integrity",
        body: "Checks that serials, elements, groups and electrolyzers match their master tables with the same spelling. Admins can repair spelling and fill blank master fields.",
      },
      {
        name: "Limits",
        body: "Design life in days for anode, cathode and membrane, warning percent, and optional minimum coating thickness. These drive every life badge and forecast.",
      },
    ],
  },
  fields: {
    lead: "The same field names appear in tables, exports and filters.",
    items: [
      { name: "Element / Element No", meaning: "Cell serial from Assembly Data. The hub that links anode, cathode, membrane, group and electrolyzer." },
      { name: "Group", meaning: "Group number assigned to the element (Group Definition)." },
      { name: "Electrolyzer + Position", meaning: "Where the cell sits in the plant (e.g. A1-12)." },
      { name: "Stage", meaning: "Derived life-cycle state (in service … ready). Manual shop stages only stick if they are newer than the last Assembly Data event." },
      { name: "Since / Days", meaning: "When the current stage started, and how many days the element has been there." },
      { name: "DOL (life basis)", meaning: "Days on line counted only while the part was installed in running cells. Overlapping installations are merged so they are not double-counted." },
      { name: "Total DOL", meaning: "All days on line over the whole life of the part (electrodes also show coating DOL separately)." },
      { name: "Coating DOL", meaning: "For anodes and cathodes: DOL since the last coating return. This is the life basis for end-of-life warnings." },
      { name: "Life used %", meaning: "Life basis ÷ life limit × 100. Green = OK, amber = warning, red = past limit." },
      { name: "Days left", meaning: "Days until the life limit at today’s pace (negative when already past)." },
      { name: "Due within N days", meaning: "Installed parts that will reach the limit inside the next N days but are not yet expired." },
      { name: "Residual thickness", meaning: "Last measured coating thickness. Compared to the minimum in Limits when that minimum is set." },
      { name: "Recoats / Last coating", meaning: "How many times the piece went for recoating, and when it last came back." },
      { name: "At coater / Days away", meaning: "Piece is dispatched and not yet returned; days since dispatch." },
      { name: "CE / value % (elsewhere)", meaning: "Current efficiency is a separate module. Element Report does not compute CE; it tracks physical life and shop flow." },
    ],
  },
  relations: {
    lead: "Tables do not use foreign keys. They join by the same serial or number written the same way (compact form: upper-case, no spaces).",
    nodes: [
      { id: "assembly", title: "Assembly Data", body: "Element No, Anode No, Cathode No, Membrane No, Group, Electrolyzer, dates (assembly, commission, decommission, disassembly)." },
      { id: "anode", title: "Anode Details", body: "Master list of anode serials, coating type, manufacturer." },
      { id: "cathode", title: "Cathode Details", body: "Master list of cathode serials and coating." },
      { id: "membrane", title: "Membrane Details", body: "Master list of membrane serials and type." },
      { id: "shop", title: "Shop stage / events", body: "Manual stage for an element and the move history (who / when / note)." },
      { id: "coat", title: "Recoating & warehouse", body: "Dispatch/return to the coater, coating checks, warehouse “at coater” state." },
      { id: "voltage", title: "Voltage alerts", body: "Open cell-voltage alerts shown on the overview KPI row." },
    ],
    links: [
      { from: "assembly", to: "anode", label: "Anode No" },
      { from: "assembly", to: "cathode", label: "Cathode No" },
      { from: "assembly", to: "membrane", label: "Membrane No" },
      { from: "assembly", to: "shop", label: "Element No" },
      { from: "anode", to: "coat", label: "serial" },
      { from: "cathode", to: "coat", label: "serial" },
      { from: "assembly", to: "voltage", label: "cell" },
    ],
    notes: [
      "Saving an anode, cathode, membrane, element, segregation or inspection rewrites the spelling to the master when needed and can create a missing master.",
      "Junk placeholders (XXXXX, free text without digits, Arabic/Persian letters only) are ignored by the dashboard so they do not pollute masters.",
      "A part mounted in more than one cell is reported under Installed Parts — fix those rows by hand.",
    ],
  },
  workflows: {
    lead: "Typical day-to-day paths.",
    items: [
      {
        title: "1. Morning check on the Main Menu",
        body: "Read Element Report under the voltage strip. If “to send to the shop” or “near end of life” is high, open the dashboard from that chip.",
      },
      {
        title: "2. Move a decommissioned element through the shop",
        body: "Cell Shop → filter Decommissioned → select rows → choose the next stage (e.g. Waiting for disassembly) → optional note → Move. When Assembly Data gets a newer date, the manual stage clears by itself.",
      },
      {
        title: "3. Find parts that must go for coating",
        body: "Coating tab → Send for coating (not installed and due) or Installed and due (plan the next shutdown). Export CSV for the workshop list.",
      },
      {
        title: "4. Manage by DOL",
        body: "Parts tab → choose Anode/Cathode/Membrane → Life = Warning + past limit, or Due within 90 days → sort by days left → export.",
      },
      {
        title: "5. Clean data spelling",
        body: "Data Integrity → review spelling and missing masters → Admin: Fix spelling / Fill blank master fields. A summary line is written to the audit log.",
      },
      {
        title: "6. Set real life limits once",
        body: "Limits tab → enter design life (days) for anode, cathode, membrane and the warning percent. Optionally set minimum coating thickness so thin coatings are flagged.",
      },
    ],
  },
  tips: {
    lead: "Keep these in mind so the numbers stay trustworthy.",
    items: [
      "Empty Start-up / missing commissioning dates make DOL and “in service” counts incomplete — fix Assembly Data first.",
      "Voltage readings sometimes store a position label in the element field; those are not real elements and are ignored by shop logic.",
      "Membranes that are only “removed” and have no warehouse stock line are not treated as real spare stock.",
      "CSV export uses UTF-8 with BOM so Excel shows Persian text correctly.",
      "Deep links look like /element-dashboard?tab=shop&stage=ready — you can bookmark them.",
    ],
  },
};

const fa: GuideContent = {
  title: "راهنمای گزارش و داشبورد المنت‌ها",
  subtitle: "چرخه عمر المنت، کارگاه سل، قطعات و پوشش‌دهی — و معنی هر عدد",
  openGuide: "راهنما",
  sections: [
    { id: "intro", label: "این چیست" },
    { id: "places", label: "کجا پیدا می‌شود" },
    { id: "lifecycle", label: "چرخه عمر المنت" },
    { id: "report", label: "گزارش منوی اصلی" },
    { id: "tabs", label: "تب‌های داشبورد" },
    { id: "fields", label: "واژه‌نامه فیلدها" },
    { id: "relations", label: "ارتباط جدول‌ها" },
    { id: "workflows", label: "روش کار" },
    { id: "tips", label: "نکته‌ها" },
  ],
  intro: {
    lead: "گزارش المنت نمای مدیریتی همه سل‌ها (المنت‌ها) و سه قطعه آن‌هاست: آند، کاتد و غشا. در یک جا می‌بینید المنت کجاست، کدام قطعه نزدیک پایان عمر است، چه چیزی نزد پوشش‌دهنده است و آیا شماره‌های سریال جدول‌ها هنوز با هم جور هستند.",
    points: [
      "اعداد تقریباً هر ۶۰ ثانیه از داده‌های مونتاژ، انبار، پوشش مجدد و هشدار ولتاژ تازه می‌شوند.",
      "با کلیک روی هر کارت یا مرحله، داشبورد کامل با همان فیلتر از پیش تنظیم‌شده باز می‌شود.",
      "هشدار عمر از حدود روزی که در «حدود عمر» می‌گذارید می‌آید. تا عمر طراحی واقعی را وارد نکنید، مقادیر پیش‌فرض فقط موقتی‌اند.",
    ],
  },
  places: {
    lead: "همین خانواده اعداد در دو جا دیده می‌شود — گزارش فشرده و داشبورد کامل.",
    cards: [
      {
        title: "گزارش المنت (منوی اصلی / Overview)",
        body: "نوار فشرده زیر گزارش زنده ولتاژ. اشغال کارخانه، آمادگی کارگاه، هشدار عمر، وضعیت پوشش‌دهی و هشت مرحله چرخه عمر را نشان می‌دهد. برای مدیری که نبض کارخانه را بدون ترک صفحه اصلی می‌خواهد.",
      },
      {
        title: "داشبورد المنت‌ها (/element-dashboard)",
        body: "محل کار کامل: نمای کلی، کارگاه سل، قطعات (DOL)، قطعات نصب‌شده، پوشش‌دهی، صحت داده‌ها و حدود عمر. برای جابه‌جایی المنت در کارگاه، خروجی فهرست و اصلاح املا.",
      },
      {
        title: "چه کسی می‌بیند",
        body: "هر کاربری با دسترسی مشاهده به المنت، آند، کاتد، غشا یا انبار. دکمه‌های اصلاح در صحت داده‌ها فقط برای مدیر سیستم است.",
      },
    ],
  },
  lifecycle: {
    lead: "المنت از کارخانه به کارگاه سل می‌رود و برمی‌گردد. مراحل از تاریخ‌های Assembly Data به‌دست می‌آیند؛ مراحل کارگاه را می‌توانید دستی بگذارید (یا گزارش بازرسی مونتاژ خودش می‌گذارد).",
    stages: [
      { key: "in_service", title: "در سرویس", body: "راه‌اندازی شده و در الکترولایزر در حال کار است. در اشغال کارخانه شمرده می‌شود." },
      { key: "installed", title: "نصب‌شده", body: "در سل مونتاژ شده ولی هنوز راه‌اندازی نشده. در کارخانه است، نه در صف کارگاه." },
      { key: "decommissioned", title: "از مدار خارج شده", body: "خاموش شده و باید به کارگاه برود. اولین سیگنال کارگاه." },
      { key: "awaiting_disassembly", title: "در انتظار دمونتاژ", body: "در کارگاه منتظر باز شدن. وقتی المنت رسید دستی تنظیم کنید." },
      { key: "disassembled", title: "دمونتاژ شده", body: "باز شده (تاریخ دمونتاژ در Assembly Data). شمارش اخیر = ۳۰ روز گذشته." },
      { key: "awaiting_assembly", title: "در انتظار مونتاژ", body: "قطعات آماده‌اند؛ منتظر شروع مونتاژ." },
      { key: "assembling", title: "در حال مونتاژ", body: "مونتاژ جاری است. گزارش بازرسی مونتاژ بدون امضا هم المنت را اینجا می‌گذارد." },
      { key: "awaiting_qc", title: "مونتاژ شده، در انتظار QC", body: "امضای نگهداری/فرایند انجام شده؛ منتظر امضای بازرس." },
      { key: "ready", title: "آماده در کارگاه", body: "QC را گذرانده (یا آماده علامت خورده). آماده نصب یا راه‌اندازی دوباره." },
    ],
  },
  report: {
    lead: "هر بلوک در گزارش منوی اصلی یک کار دارد. رویش کلیک کنید تا وارد داشبورد شوید.",
    banner: [
      { title: "در سرویس / ظرفیت", body: "چند المنت راه‌اندازی شده نسبت به ظرفیت کارخانه (۲۴ × ۱۶۸ = ۴۰۳۲ سل)." },
      { title: "آماده در کارگاه", body: "المنت‌هایی که QC را تمام کرده‌اند و می‌توانند به کارخانه برگردند." },
      { title: "در کارگاه سل", body: "جمع مراحل کارگاه از انتظار دمونتاژ تا آماده (بدون شمارش انبار ساده «دمونتاژ شده»)." },
    ],
    chips: [
      { title: "برای ارسال به کارگاه", body: "خارج از مدار + در انتظار دمونتاژ — هنوز نیازمند توجه کارگاه." },
      { title: "قطعه نزدیک پایان عمر", body: "آند، کاتد و غشای نصب‌شده در وضعیت هشدار یا گذشته از حد عمر." },
      { title: "نزد پوشش‌دهنده · برای پوشش", body: "قطعاتی که الان نزد پوشش‌دهنده‌اند، و قطعات نصب‌نشده‌ای که باید بعدی ارسال شوند." },
    ],
    gauges: [
      { title: "اشغال کارخانه", body: "سهم ظرفیت که در سرویس، نصب‌شده یا خارج از مدار است (هنوز در کارخانه)." },
      { title: "قطعات در محدوده عمر سالم", body: "سهم قطعات نصب‌شده که هنوز زیر آستانه هشدارند. به حدود عمر واقعی نیاز دارد." },
      { title: "آمادگی کارگاه", body: "سهم کار کارگاه که در مرحله آماده است." },
      { title: "رسیدن به حد عمر تا ۹۰ روز", body: "قطعات نصب‌شده‌ای که تا ۹۰ روز آینده به حد عمر می‌رسند (هنوز منقضی نشده‌اند)." },
    ],
  },
  tabs: {
    lead: "داشبورد را از دکمه منوی اصلی، نوار کناری یا هر کارت گزارش باز کنید.",
    items: [
      {
        name: "نمای کلی",
        body: "کارت‌های مراحل، ردیف KPI، نمودار بر اساس الکترولایزر و جریان ماهانه، هیستوگرام عمر، طولانی‌ترین انتظار و جابه‌جایی‌های اخیر. تخته شروع برای کنترل روزانه.",
      },
      {
        name: "کارگاه سل",
        body: "فهرست بر اساس مرحله، انتخاب چند ردیف یا جای‌گذاری شماره، انتقال به مرحله بعد با یادداشت اختیاری، یا پاک کردن مرحله. تاریخچه هر المنت با یک کلیک. خروجی CSV.",
      },
      {
        name: "آند / کاتد / غشا",
        body: "DOL و عمر مصرف‌شده برای هر سریال. فیلتر محل، وضعیت عمر، «رسیدن به حد تا N روز» و بازه DOL. مرتب‌سازی ستون و خروجی.",
      },
      {
        name: "قطعات نصب‌شده",
        body: "کدام آند، کاتد و غشا روی کدام المنت است، پرشدگی هر الکترولایزر، و سریال‌هایی که اشتباه در بیش از یک سل ثبت شده‌اند.",
      },
      {
        name: "پوشش‌دهی",
        body: "کارهای پوشش مجدد: نزد پوشش‌دهنده، برگشته در انتظار بازرسی، باید همین حالا برود، نصب‌شده و نیازمند پوشش. نمودار سال/ماه و پوشش‌دهنده.",
      },
      {
        name: "صحت داده‌ها",
        body: "بررسی می‌کند سریال، المنت، گروه و الکترولایزر با جدول اصلی و همان املا جور باشند. مدیر می‌تواند املا را اصلاح و فیلدهای خالی جدول اصلی را پر کند.",
      },
      {
        name: "حدود عمر",
        body: "عمر طراحی (روز) برای آند، کاتد و غشا، درصد هشدار، و حداقل ضخامت پوشش اختیاری. همه نشان‌های عمر و پیش‌بینی از اینجا می‌آیند.",
      },
    ],
  },
  fields: {
    lead: "همین نام فیلدها در جدول‌ها، خروجی‌ها و فیلترها تکرار می‌شوند.",
    items: [
      { name: "Element / شماره المنت", meaning: "سریال سل از Assembly Data. مرکز ارتباط آند، کاتد، غشا، گروه و الکترولایزر." },
      { name: "Group / گروه", meaning: "شماره گروه المنت (تعریف گروه)." },
      { name: "الکترولایزر + موقعیت", meaning: "جای سل در کارخانه (مثلاً A1-12)." },
      { name: "Stage / مرحله", meaning: "وضعیت چرخه عمر. مرحله دستی کارگاه فقط وقتی می‌ماند که از آخرین رویداد Assembly Data تازه‌تر باشد." },
      { name: "Since / Days", meaning: "شروع مرحله فعلی و تعداد روز ماندن در آن." },
      { name: "DOL (مبنای عمر)", meaning: "روزهای روی خط فقط وقتی قطعه در سل در حال کار نصب بوده. بازه‌های هم‌پوشان یک‌بار شمرده می‌شوند." },
      { name: "Total DOL", meaning: "همه روزهای روی خط در کل عمر قطعه (برای الکترود، DOL پوشش جدا هم هست)." },
      { name: "Coating DOL", meaning: "برای آند و کاتد: DOL از آخرین بازگشت از پوشش‌دهی. مبنای هشدار پایان عمر." },
      { name: "عمر مصرف‌شده ٪", meaning: "مبنای عمر ÷ حد عمر × ۱۰۰. سبز = سالم، کهربایی = هشدار، قرمز = گذشته از حد." },
      { name: "روز باقی‌مانده", meaning: "روز تا رسیدن به حد عمر (منفی یعنی گذشته)." },
      { name: "رسیدن به حد تا N روز", meaning: "قطعات نصب‌شده‌ای که تا N روز آینده به حد می‌رسند ولی هنوز منقضی نشده‌اند." },
      { name: "ضخامت باقی‌مانده", meaning: "آخرین ضخامت پوشش اندازه‌گیری‌شده. با حداقل حدود عمر مقایسه می‌شود اگر تعریف شده باشد." },
      { name: "دفعات پوشش / آخرین پوشش", meaning: "چند بار برای پوشش مجدد رفته و آخرین بازگشت چه زمانی بوده." },
      { name: "نزد پوشش‌دهنده / روز دوری", meaning: "ارسال شده و هنوز برنگشته؛ روز از تاریخ ارسال." },
      { name: "CE / بازده جریان", meaning: "بازده جریان ماژول جداست. گزارش المنت CE حساب نمی‌کند؛ عمر فیزیکی و جریان کارگاه را دنبال می‌کند." },
    ],
  },
  relations: {
    lead: "جدول‌ها کلید خارجی ندارند. با همان شماره سریال (شکل فشرده: حروف بزرگ، بدون فاصله) به هم وصل می‌شوند.",
    nodes: [
      { id: "assembly", title: "Assembly Data", body: "شماره المنت، آند، کاتد، غشا، گروه، الکترولایزر و تاریخ‌ها (مونتاژ، راه‌اندازی، خروج، دمونتاژ)." },
      { id: "anode", title: "جزئیات آند", body: "فهرست اصلی سریال آند، نوع پوشش، سازنده." },
      { id: "cathode", title: "جزئیات کاتد", body: "فهرست اصلی سریال کاتد و پوشش." },
      { id: "membrane", title: "جزئیات غشا", body: "فهرست اصلی سریال غشا و نوع." },
      { id: "shop", title: "مرحله / رویداد کارگاه", body: "مرحله دستی المنت و تاریخچه جابه‌جایی (چه کسی / کی / یادداشت)." },
      { id: "coat", title: "پوشش مجدد و انبار", body: "ارسال/بازگشت پوشش‌دهی، بازرسی پوشش، وضعیت انبار «نزد پوشش‌دهنده»." },
      { id: "voltage", title: "هشدار ولتاژ", body: "هشدارهای باز ولتاژ سل که در ردیف KPI نمای کلی دیده می‌شوند." },
    ],
    links: [
      { from: "assembly", to: "anode", label: "Anode No" },
      { from: "assembly", to: "cathode", label: "Cathode No" },
      { from: "assembly", to: "membrane", label: "Membrane No" },
      { from: "assembly", to: "shop", label: "Element No" },
      { from: "anode", to: "coat", label: "سریال" },
      { from: "cathode", to: "coat", label: "سریال" },
      { from: "assembly", to: "voltage", label: "سل" },
    ],
    notes: [
      "ذخیره آند، کاتد، غشا، المنت، تفکیک یا بازرسی در صورت نیاز املا را مطابق جدول اصلی بازنویسی می‌کند و می‌تواند رکورد اصلی بسازد.",
      "متن‌های بی‌معنی (XXXXX، متن بدون رقم، فقط حروف عربی/فارسی) در داشبورد نادیده گرفته می‌شوند تا جدول اصلی آلوده نشود.",
      "قطعه‌ای که در بیش از یک سل ثبت شده در «قطعات نصب‌شده» گزارش می‌شود — آن ردیف‌ها را دستی درست کنید.",
    ],
  },
  workflows: {
    lead: "مسیرهای روزمره.",
    items: [
      {
        title: "۱. کنترل صبحگاهی در منوی اصلی",
        body: "گزارش المنت را زیر نوار ولتاژ ببینید. اگر «برای ارسال به کارگاه» یا «نزدیک پایان عمر» بالاست، از همان برچسب وارد داشبورد شوید.",
      },
      {
        title: "۲. عبور المنت خارج‌شده از کارگاه",
        body: "کارگاه سل → فیلتر خارج از مدار → انتخاب ردیف‌ها → مرحله بعد (مثلاً در انتظار دمونتاژ) → یادداشت اختیاری → انتقال. وقتی Assembly Data تاریخ تازه‌تری بگیرد، مرحله دستی خودش پاک می‌شود.",
      },
      {
        title: "۳. قطعات نیازمند پوشش‌دهی",
        body: "تب پوشش‌دهی → ارسال برای پوشش‌دهی (نصب‌نشده و نیازمند) یا نصب‌شده و نیازمند. برای کارگاه خروجی CSV بگیرید.",
      },
      {
        title: "۴. مدیریت با DOL",
        body: "تب قطعات → آند/کاتد/غشا → عمر = هشدار + گذشته از حد، یا رسیدن به حد تا ۹۰ روز → مرتب‌سازی بر اساس روز باقی‌مانده → خروجی.",
      },
      {
        title: "۵. پاک‌سازی املای داده",
        body: "صحت داده‌ها → بررسی املا و رکوردهای اصلی گمشده → مدیر: اصلاح املا / پر کردن فیلدهای خالی. خلاصه در گزارش ممیزی ثبت می‌شود.",
      },
      {
        title: "۶. یک‌بار حدود عمر واقعی را بگذارید",
        body: "تب حدود عمر → عمر طراحی (روز) آند، کاتد، غشا و درصد هشدار. در صورت نیاز حداقل ضخامت پوشش را هم بگذارید تا پوشش نازک علامت بخورد.",
      },
    ],
  },
  tips: {
    lead: "برای قابل‌اعتماد ماندن اعداد این‌ها را به خاطر بسپارید.",
    items: [
      "تاریخ راه‌اندازی خالی، DOL و شمارش «در سرویس» را ناقص می‌کند — اول Assembly Data را درست کنید.",
      "در ولتاژ گاهی برچسب موقعیت در فیلد المنت است؛ آن‌ها المنت واقعی نیستند و در منطق کارگاه نادیده گرفته می‌شوند.",
      "غشایی که فقط «برداشته شده» و ردیف انبار ندارد به‌عنوان موجودی یدکی واقعی شمرده نمی‌شود.",
      "خروجی CSV با BOM است تا فارسی در اکسل درست دیده شود.",
      "لینک مستقیم مثلاً /element-dashboard?tab=shop&stage=ready را می‌توانید نشان کنید.",
    ],
  },
};

export const ELEMENT_REPORT_GUIDE: Record<GuideLocale, GuideContent> = { en, fa };
