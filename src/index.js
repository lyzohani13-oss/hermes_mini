const MODEL = "@cf/google/gemma-4-26b-a4b-it";

// فقط این عملیات از خروجی مدل زبانی پذیرفته می‌شوند (قرارداد خروجی ساخت‌یافته)
const ALLOWED_ACTIONS = [
  "add",
  "done",
  "undone",
  "del",
  "edit",
  "search",
  "list",
  "chat"
];

const HELP_TEXT = `سلام! من هرمس هستم 🤖 دستیار کارهای روزانه‌ت.
ساده و محاوره‌ای بنویس؛ لازم نیست دستور خاصی حفظ کنی.

➕ ثبت کار (تا ۱۰ کار در هر پیام)
نان بخر
باید لباس بخرم
برم دکتر و داروخانه
فردا ساعت ۹ درس بخون
اضافه کن گزارش هفتگی

✅ انجام‌شده کردن
نان خریدم
پول رو پرداخت کردم
کار ۱ و ۲ انجام شد
پرداخت پول رو انجام شده ثبت کن

↩️ برگرداندن به انجام‌نشده
زنگ مامان هنوز مونده
پرداخت نکردم
زنگ مامان رو انجام ندادم
زنگ مامان رو برگردون به انجام نشده‌ها

📋 نمایش و جستجو
کارهام  /  لیست کارها رو نمایش بده
کارهای باقی‌مانده  /  چی مونده؟
کارهای انجام‌شده
امروز چی دارم؟  /  فردا چی دارم؟
کارای خرید  /  کارهایی که خرید توش هست
کارهای خرید که مونده
کار شماره ۱ و ۲ رو نشون بده

✏️ ویرایش، ساعت و حذف
کار شماره ۱ رو به خرید کتاب تغییر بده
زنگ مامان رو بذار ساعت ۸ شب
کار ۳ رو حذف کن
همه کارها رو حذف کن (با تأیید)

⏰ یادآوری
یک دقیقه دیگه یادم بنداز قرصمو بخورم
فردا ساعت ۹ یادم بنداز درس بخونم
یادآوری قرص رو حذف کن

❓ پرسش
چند تا کار مونده؟
امروز چندشنبه‌ست؟

💡 اگر چند کار مشابه باشه شماره‌ی دقیق رو می‌پرسم؛ برای انجام‌شده یا برگردوندن می‌تونی «همه» هم بگی و برای انصراف «لغو».
🌅 هر روز ساعت ۸ صبح کارهای باقی‌مانده رو برات می‌فرستم.`;

const CANCEL_WORDS = ["نه", "لغو", "بیخیال", "بی خیال"];

const WORD_NUMBERS = {
  "یک": 1,
  "یه": 1,
  "دو": 2,
  "سه": 3,
  "چهار": 4,
  "پنج": 5,
  "ده": 10,
  "نیم": 0.5
};

// -----------------------------
// ابزارهای عمومی
// -----------------------------

function normalizeDigits(text) {
  const digits = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9"
  };

  return String(text).replace(/[۰-۹٠-٩]/g, d => digits[d]);
}

// نرمال‌سازی برای تشخیص دستور (نیم‌فاصله به فاصله تبدیل می‌شود)
function normalizeText(text) {
  return normalizeDigits(text)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // اعراب و کشیده
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)ب(?=\s|$)/g, "$1به") // «زنگ زدن ب مامان»
    .replace(/(^|\s)ک(?=\s|$)/g, "$1که")
    .toLowerCase();
}

// کلید جستجو: فاصله، نیم‌فاصله، نشانه‌گذاری و تفاوت‌های املایی رایج
// (ي/ی، ك/ک، أ/إ/آ/ا، ؤ/و، ئ/ی، ة/ه، همزه و اعراب) نادیده گرفته می‌شوند.
function searchKey(text) {
  return normalizeText(text)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ی")
    .replace(/[ةۀ]/g, "ه")
    .replace(/ء/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// کلمه «کار» (و «کارها»، «کارهای»، «کار شماره») جزو عنوان حساب نمی‌شود.
function stripTaskWord(text) {
  const t = String(text).trim();

  const cleaned = t
    .replace(
      /^(?:عنوان\s+)?(?:کار|کارها|کارهای|کارهام|کارام|کارم|تسک|تسک ها|تسک های)\s+/,
      ""
    )
    .replace(/^شماره\s+(?=\d)/, "")
    .replace(/^(?:دارای|حاوی)\s+/, "")
    .trim();

  return cleaned || t;
}

// مرجع کار: اگر فقط عدد بود شماره کار، وگرنه عنوان
function taskRef(raw) {
  const title = stripTaskWord(raw);
  const id = /^\d+$/.test(title) ? numberValue(title) : null;

  return id ? { task_id: id } : { title };
}

function isExpired(expiresAt) {
  const time = new Date(
    String(expiresAt).replace(" ", "T") + "Z"
  ).getTime();

  return !Number.isFinite(time) || time < Date.now();
}

function numberValue(value) {
  const n = Number(normalizeDigits(value));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function tehranParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const result = {};
  for (const p of parts) {
    result[p.type] = p.value;
  }

  return result;
}

function tehranDateToUTC(year, month, day, hour, minute) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - 210 * 60000
  );
}

function parseReminderTime(text) {
  const normalized = normalizeText(text);
  const now = new Date();

  const relative = normalized.match(
    /(\d+|یک|یه|دو|سه|چهار|پنج|ده|نیم)\s*(دقیقه|ساعت)\s*(دیگه|دیگ|بعد)/
  );

  if (relative) {
    const words = {
      "یک": 1,
      "یه": 1,
      "ده": 10,
      "دو": 2,
      "سه": 3,
      "چهار": 4,
      "پنج": 5,
      "نیم": 0.5
    };

    const amount = words[relative[1]] ?? Number(relative[1]);

    if (!Number.isFinite(amount)) return null;

    const milliseconds =
      amount * (relative[2] === "ساعت" ? 3600000 : 60000);

    return new Date(now.getTime() + milliseconds);
  }

  const clock = findClock(normalized);

  if (!clock) return null;

  let { hour } = clock;
  const { minute } = clock;

  // «امشب ساعت ۸» یعنی ۲۰:۰۰
  if (normalized.includes("امشب") && hour >= 4 && hour < 12) hour += 12;

  const p = tehranParts(now);

  let year = Number(p.year);
  let month = Number(p.month);
  let day = Number(p.day);

  const shift = /پس ?فردا/.test(normalized)
    ? 2
    : normalized.includes("فردا")
      ? 1
      : 0;

  const today =
    normalized.includes("امروز") || normalized.includes("امشب");

  if (shift) {
    const nextDay = new Date(Date.UTC(year, month - 1, day + shift));
    year = nextDay.getUTCFullYear();
    month = nextDay.getUTCMonth() + 1;
    day = nextDay.getUTCDate();
  }

  let due = tehranDateToUTC(year, month, day, hour, minute);

  if (!shift && !today && due <= now) {
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));

    due = tehranDateToUTC(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      hour,
      minute
    );
  }

  if (due <= now) return null;

  return due;
}

// -----------------------------
// تشخیص مستقیم دستورها
// -----------------------------
// تشخیص بر پایه‌ی «فعل» است، نه قالب ثابت جمله: فعل می‌تواند اول یا آخر جمله
// بیاید و کلمات اضافه (کار، کارها، رو، را، لطفا، ها، به، شماره ...) کنار گذاشته می‌شوند.
// کار جدید با «اضافه کن» / «ثبت کن» یا با جمله‌ی طبیعی (مثل «نان بخر») ساخته می‌شود؛ بخش «تشخیص طبیعی» را ببین.

const START_NOISE = new Set([
  "لطفا", "کار", "کارها", "کارهای", "کارهام", "کارام", "کارم", "کارهایم",
  "کارهامو", "کارای", "کارا", "وظایف", "وظایفم", "وظیفه", "تسکام",
  "تسک", "تسکها", "تسکهای", "رو", "را", "شماره", "عنوان",
  "دارای", "حاوی", "که", "ها", "های", "هایی", "اون", "همون", "هنوز"
]);

const END_NOISE = new Set([
  ...START_NOISE,
  "به", "کن", "کنید", "بذار", "بزار", "برگردون", "برگردان", "بزن",
  "ببر", "بشه", "ثبت", "حساب", "علامت"
]);

const LIST_WORDS = new Set([
  "لیست", "فهرست", "همه", "من", "ی", "تمام", "کل", "چیه", "چی"
]);

const VERBS = {
  add: "اضافه کن(?:ید)?|اضافش کن|ثبت کن(?:ید)?|ثبتش کن",
  edit: "تغییر بده|تغییر بدید|تغییرش بده|عوض کن|عوضش کن|ویرایش کن|ویرایشش کن|تبدیل کن|اصلاح کن",
  show: "پیدا کن|پیداش کن|بگرد|جستجو کن|جستجو|سرچ کن|نشون بده|نشونم بده|نشون بدید|نشان بده|نمایش بده|نمایش|بیار|ببینم",
  del: "حذفش کن|پاکش کن|حذف کن(?:ید)?|پاک کن(?:ید)?|حذف|پاک"
};

const DELETE_ALL_RE =
  /^(?:همه|همشون|همه شون|همه اونا|همه اون ها|همه ی اونا|همه ی کارها|تمام|تمامی|همه چیز)$/;

const UNDONE_RE =
  /(?:^|\s)(?:انجام نشد(?:ه)?(?:\s+ها)?|انجام شده نیست|انجام نیست|انجام ندادم|انجامش ندادم|انجام نکردم|انجامش نکردم|انجام نگرفت(?:ه)?)(?=\s|$)/;

const DONE_RE =
  /(?:^|\s)(?:انجام شد(?:ه)?(?:\s+ها)?|انجام دادم|انجامش دادم|تموم شد(?:ه)?|تمام شد(?:ه)?|تموم کردم|تمومش کردم|تمام کردم|تیک(?:ش)?(?:\s+رو)?\s+بزن|خط(?:ش)?\s+بزن|تیک خورد)(?=\s|$)/;

// فعل را از ابتدا یا انتهای جمله برمی‌دارد و باقی‌مانده را برمی‌گرداند
function takeVerb(n, verbs) {
  let m = n.match(new RegExp(`^(?:(.+?)\\s+)?(?:${verbs})$`));
  if (m) return (m[1] || "").trim();

  m = n.match(new RegExp(`^(?:${verbs})(?:\\s+(.+))?$`));
  if (m) return (m[1] || "").trim();

  return null;
}

// «زنگ مامان مونده، کار رو دوباره انجام نشده کن» → «زنگ مامان»
function dropFillers(text) {
  return String(text)
    .replace(/(?:^|\s)(?:کار|کارها|تسک)\s+(?:رو|را)(?=\s|$)/g, " ")
    .replace(
      /(?:^|\s)(?:مانده|مونده|باقیه|دوباره|دوباره ی|هنوز|هنوزم)(?=\s|$)/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

// کلمات اضافی ابتدا و انتهای عنوان را حذف می‌کند
function cleanTitle(text) {
  const tokens = String(text).split(" ").filter(Boolean);

  while (tokens.length && START_NOISE.has(tokens[0])) tokens.shift();
  while (tokens.length && END_NOISE.has(tokens[tokens.length - 1])) tokens.pop();

  return tokens.join(" ");
}

const REMAIN_RE =
  /(?:^|\s)(?:باقی ?مانده|باقی ?مونده|مانده|مونده|باقیه)(?:\s+ها)?(?=\s|$)/;

function parseFilter(text) {
  if (UNDONE_RE.test(text)) {
    return { filter: "pending", rest: text.replace(UNDONE_RE, " ") };
  }

  if (REMAIN_RE.test(text)) {
    return { filter: "pending", rest: text.replace(REMAIN_RE, " ") };
  }

  if (DONE_RE.test(text)) {
    return { filter: "done", rest: text.replace(DONE_RE, " ") };
  }

  return { filter: null, rest: text };
}

function detectSimpleCommand(text) {
  let n = normalizeText(joinSeparators(text))
    .replace(/[.!؟?،,؛:]+(?=\s|$)/g, " ")
    .replace(/(^|\s)کار (ها|های|هام|هایم|هامو)(?=\s|$)/g, "$1کار$2")
    .replace(ATTACHED_RA_RE, "$1$2 رو") // «کارهارو» → «کارها رو»
    .replace(/(^|\s)لطفا(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // «و» اضافه در ابتدا یا انتهای پیام (مثلاً بعد از «،» پایانی) حذف می‌شود
  n = n.replace(/^و\s+|\s+و$/g, "").trim();

  if (!n) return null;

  let rest;

  // راهنما (متن آزاد؛ بدون دستور اسلشی)
  if (/^(?:راهنما|کمک|help|سلام راهنما)$/.test(n)) {
    return { action: "help" };
  }

  // لغو یادآوری
  if (/(یادآوری|یادم بنداز).*(حذف|پاک|لغو)/.test(n)) {
    return { action: "delete_reminder", title: n };
  }

  // «چند تا کار مونده؟» (قبل از هر دستور دیگر)
  const countQuery = detectCountQuery(n);

  if (countQuery) return countQuery;

  // اضافه کردن کار: «اضافه کن X» / «X رو اضافه کن» / «ثبت کن X»
  rest = takeVerb(n, VERBS.add);

  if (rest !== null) {
    // «پرداخت پول رو انجام شده ثبت کن» → وضعیت کار، نه کار جدید
    const asUndone = UNDONE_RE.test(rest);

    if (asUndone || DONE_RE.test(rest)) {
      const statusTitle = cleanTitle(
        dropFillers(rest.replace(asUndone ? UNDONE_RE : DONE_RE, " "))
      );

      if (statusTitle && !isListOnlyTitle(statusTitle)) {
        return buildStatusAction(asUndone ? "undone" : "done", statusTitle);
      }
    }

    const title = cleanTitle(rest);

    return title
      ? { action: "add", title }
      : { action: "add", title: "" };
  }

  // تعیین یا تغییر ساعت: «زنگ مامان رو بذار ساعت ۸ شب»
  const setTime = detectSetTime(n);

  if (setTime) return setTime;

  // ویرایش: «کار X رو به Y تغییر بده»
  rest = takeVerb(n, VERBS.edit);

  if (rest !== null) {
    const parts =
      rest.match(/^(.+?)\s+(?:رو|را)\s+به\s+(.+)$/) ||
      rest.match(/^(.+?)\s+به\s+(.+)$/);

    if (parts) {
      const oldRef = cleanTitle(parts[1]);
      const newTitle = parts[2].trim();

      if (oldRef && newTitle) {
        return {
          action: "edit",
          ...taskRef(oldRef),
          new_title: newTitle
        };
      }
    }

    return null;
  }

  // نمایش / جستجو / فهرست
  rest = takeVerb(n, VERBS.show);

  if (rest !== null) {
    const { filter, rest: afterFilter } = parseFilter(rest);

    // «دنبال X بگرد» / «X رو در همه روزها جستجو کن»
    const title = cleanTitle(
      afterFilter
        .replace(
          /(?:^|\s)(?:در|تو|توی|از)?\s*(?:همه|تمام)\s+روز(?:\s*ها)?(?=\s|$)/g,
          " "
        )
        .replace(/^\s*دنبال\s+/, "")
        .replace(/\s+/g, " ")
        .trim()
    );

    const tokens = title.split(" ").filter(Boolean);

    // «کارهای امروز رو نشون بده»
    const dayOff = dayOffsetOf(title);

    if (
      dayOff !== null &&
      tokens
        .filter(t => !DAY_WORDS.has(t))
        .every(t => LIST_WORDS.has(t) || LISTQ_WORDS.has(t))
    ) {
      return { action: "day_list", day: dayOff };
    }

    if (!tokens.length || tokens.every(t => LIST_WORDS.has(t))) {
      return { action: "list", filter };
    }

    // «کار شماره 1 و 2 رو نشون بده»
    if (/^\d+(?:\s*(?:و|،|,)?\s*\d+)*$/.test(title)) {
      const ids = [...title.matchAll(/\d+/g)]
        .map(x => numberValue(x[0]))
        .filter(Boolean);

      if (ids.length) {
        return { action: "show_selected", task_ids: [...new Set(ids)] };
      }
    }

    // «کارهایی که خرید توش هست» / «کارهای مربوط به خرید» → «خرید»
    const term = cleanSearchTerm(title);

    if (!term) return { action: "list", filter };

    return { action: "search", title: term, filter };
  }

  // «کارهای خرید که انجام نشده» / «لیست کارهای باقی‌مانده» → فهرست با فیلتر
  const filteredList = detectSearchPhrase(n, true);

  if (filteredList) return filteredList;

  // «چی انجام شده؟» / «کدوم کارها انجام نشده؟» → فهرست با فیلتر
  if (
    (DONE_RE.test(n) || UNDONE_RE.test(n)) &&
    /(?:^|\s)(?:چی|چیه|چیا|کدوم|کدام|کدومه|کدوما|چه)(?=\s|$)/.test(n)
  ) {
    return { action: "list", filter: UNDONE_RE.test(n) ? "pending" : "done" };
  }

  // «زنگ مامان رو برگردون» / «برگردون زنگ مامان رو به انجام نشده ها»
  const back = detectReturnToPending(n);

  if (back) return back;

  // برگرداندن به انجام‌نشده: «کار X رو انجام ندادم» / «X انجام نشده»
  if (UNDONE_RE.test(n)) {
    const title = cleanTitle(dropFillers(n.replace(UNDONE_RE, " ")));

    if (title && !isListOnlyTitle(title)) {
      return buildStatusAction("undone", title);
    }

    // «کارهای انجام نشده» → فهرست باقی‌مانده‌ها
    return title || /کار|تسک|ها/.test(n)
      ? { action: "list", filter: "pending" }
      : null;
  }

  // انجام‌شده
  if (DONE_RE.test(n)) {
    const title = cleanTitle(n.replace(DONE_RE, " "));

    if (title && !isListOnlyTitle(title)) {
      return buildStatusAction("done", title);
    }

    // «کارهای انجام شده» → فهرست انجام‌شده‌ها
    return title || /کار|تسک|ها/.test(n)
      ? { action: "list", filter: "done" }
      : null;
  }

  // حذف (کار، چند کار مشابه، یا همه کارها با تأیید)
  rest = takeVerb(n, VERBS.del);

  if (rest !== null) {
    const title = cleanTitle(rest);

    if (!title) return null;

    if (DELETE_ALL_RE.test(title)) {
      return { action: "confirm_delete_all" };
    }

    return { action: "del", ...taskRef(title) };
  }

  // گفتگو و پرسش: سلام، تشکر، «چند تا کار مونده؟»، «امروز چی دارم؟»، «امروز چندشنبه‌ست؟»
  const info = detectInfoQuery(n);

  if (info) return info;

  // «کارهام» / «لیست» / «فهرست کارها»
  if (isListRequest(n)) {
    return { action: "list" };
  }

  // «کارای خرید» / «کارهایی که خرید توش هست» / «لیست خرید» → جستجو
  const searchPhrase = detectSearchPhrase(n);

  if (searchPhrase) return searchPhrase;

  // عبارت‌های فهرست بدون فعل
  if (/کارام چیه|کارهایم|فهرست کار|لیست کار|کارهای من|همه کارهام/.test(n)) {
    return { action: "list" };
  }

  // «نان بخر» / «حمام برم» → کار جدید؛ «نان خریدم» / «خرید کردم» → انجام‌شده
  // (پرسش، جمله‌ی منفی و گفتگوی عادی هرگز ثبت نمی‌شود)
  // «ناهار» / «حمام» / «ورزش» → کار روزمره
  if (SOLO_TASK_NOUNS.has(n)) return { action: "add", title: n };

  // «زنگ مامان هنوز مونده» → برگرداندن به انجام‌نشده
  const undoneNatural = detectUndoneNatural(text, n);

  if (undoneNatural) return undoneNatural;

  // «پول پرداخت شد» / «پرداخت نشد»
  const passive = detectPassiveStatus(text, n);

  if (passive) return passive;

  // «پرداخت نکردم» / «نان نخریدم» → برگرداندن به انجام‌نشده
  const negated = detectNegatedNatural(text, n);

  if (negated) return negated;

  return detectNaturalIntent(text, n);
}

// -----------------------------
// تشخیص طبیعی «قصد انجام کار» و «انجام‌شدن کار»
// -----------------------------
// بدون نیاز به «اضافه کن» یا «انجام شد»:
//   «نان بخر» / «حمام برم» / «باید لباس بخرم» / «خرید بکنم»  → کار جدید
//   «نان خریدم» / «خرید کردم» / «بازار رفتم»                  → کار انجام‌شده
// تشخیص بر پایه‌ی فهرست فعل‌های پرکاربرد (و «کردن» با هر اسمی) است.
// فعل‌های ناشناخته به مدل زبانی سپرده می‌شوند.
//
// برای فعل جدید، یک خانواده به VERB_FAMILIES اضافه کن:
//   past: گذشته‌ی اول‌شخص   want: امر / التزامی (بخر، بخرم، ...)
//   nouns: اسم‌های هم‌خانواده (خرید)   context: جاهایی که با آن فعل می‌آیند (بازار)

const VERB_FAMILIES = [
  {
    id: "buy",
    nouns: ["خرید", "خریدن"],
    context: ["بازار", "فروشگاه", "سوپر", "سوپرمارکت", "مغازه", "پاساژ"],
    past: ["خریدم", "خریدیم"],
    want: [
      "بخر", "بخرم", "بخریم", "بخرید",
      "خرید کن", "خرید بکن", "خرید کنید", "خرید بکنید"
    ]
  },
  {
    id: "go",
    nouns: ["رفتن"],
    past: ["رفتم", "رفتیم"],
    want: ["برم", "بروم", "بریم", "برویم"]
  },
  {
    id: "get",
    nouns: ["گرفتن"],
    past: ["گرفتم", "گرفتیم"],
    want: ["بگیر", "بگیرم", "بگیریم"]
  },
  {
    id: "bring",
    nouns: ["آوردن"],
    past: ["آوردم", "آوردیم", "اوردم", "اوردیم"],
    want: ["بیارم", "بیاورم", "بیاریم", "بیاوریم"]
  },
  {
    id: "take",
    nouns: ["بردن"],
    past: ["بردم", "بردیم"],
    want: ["ببر", "ببرم", "ببریم"]
  },
  {
    id: "hit",
    nouns: [],
    past: ["زدم", "زدیم"],
    want: ["بزن", "بزنم", "بزنیم"]
  },
  {
    id: "wash",
    nouns: ["شستن", "شستشو"],
    past: ["شستم", "شستیم"],
    want: ["بشور", "بشورم", "بشوریم", "بشویم"]
  },
  {
    id: "cook",
    nouns: ["پختن"],
    past: ["پختم", "پختیم"],
    want: ["بپز", "بپزم", "بپزیم"]
  },
  {
    id: "eat",
    nouns: ["خوردن"],
    past: ["خوردم", "خوردیم"],
    want: ["بخور", "بخورم", "بخوریم"]
  },
  {
    id: "read",
    nouns: ["خوندن", "خواندن", "مطالعه"],
    past: ["خوندم", "خواندم", "خوندیم", "خواندیم"],
    want: ["بخون", "بخوان", "بخونم", "بخوانم", "بخونیم", "بخوانیم"]
  },
  {
    id: "write",
    nouns: ["نوشتن"],
    past: ["نوشتم", "نوشتیم"],
    want: ["بنویس", "بنویسم", "بنویسیم"]
  },
  {
    id: "send",
    nouns: ["ارسال", "فرستادن"],
    past: ["فرستادم", "فرستادیم"],
    want: ["بفرست", "بفرستم", "بفرستیم"]
  },
  {
    id: "give",
    nouns: [],
    past: ["دادم", "دادیم"],
    want: ["بدم", "بدهم", "بدیم", "بدهیم"]
  },
  {
    id: "see",
    nouns: [],
    past: ["دیدم", "دیدیم"],
    want: []
  },
  {
    id: "deliver",
    nouns: ["تحویل"],
    past: ["رسوندم", "رساندم", "رسوندیم", "رساندیم"],
    want: ["برسون", "برسان", "برسونم", "برسانم"]
  },
  {
    id: "pay",
    nouns: ["پرداخت", "پرداختن", "واریز", "تسویه"],
    past: ["پرداختم", "پرداختیم"],
    want: [
      "بپرداز", "بپردازم", "بپردازیم",
      "پرداخت کن", "پرداخت بکن", "پرداخت کنید"
    ]
  },
  {
    id: "make",
    nouns: ["ساختن"],
    past: ["ساختم", "ساختیم"],
    want: ["بسازم", "بسازیم"]
  },
  {
    id: "put",
    nouns: [],
    past: ["گذاشتم", "گذاشتیم"],
    want: ["بذارم", "بزارم", "بگذارم", "بذاریم", "بزاریم", "بگذاریم"]
  },
  {
    id: "pickup",
    nouns: [],
    past: ["برداشتم", "برداشتیم"],
    want: ["بردار", "بردارم", "برداریم"]
  },
  {
    id: "sleep",
    nouns: ["خواب"],
    past: ["خوابیدم", "خوابیدیم"],
    want: ["بخوابم", "بخوابیم"]
  },
  {
    id: "come",
    nouns: ["آمدن"],
    past: ["اومدم", "آمدم", "اومدیم", "آمدیم"],
    want: ["بیام", "بیایم"]
  },
  {
    // «کردن» با هر اسمی: «تمیز کنم»، «ورزش کردم»، «خرید بکنم» ...
    id: "do",
    light: true,
    nouns: [],
    past: ["کردم", "کردیم"],
    want: ["کنم", "بکنم", "کنیم", "بکنیم"]
  }
];

// مصدرها («نان خریدن»، «حمام رفتن»، «تمیز کردن») هم مثل امر، قصد انجام کار حساب می‌شوند
const INFINITIVES = {
  buy: ["خریدن"], go: ["رفتن"], get: ["گرفتن"], bring: ["آوردن"],
  take: ["بردن"], hit: ["زدن"], wash: ["شستن"], cook: ["پختن"],
  eat: ["خوردن"], read: ["خوندن", "خواندن"], write: ["نوشتن"],
  send: ["فرستادن"], give: ["دادن"], see: ["دیدن"],
  deliver: ["رسوندن", "رساندن"], make: ["ساختن"], put: ["گذاشتن"],
  pickup: ["برداشتن"], sleep: ["خوابیدن"], come: ["اومدن", "آمدن"],
  do: ["کردن"]
};

const FORM_INDEX = new Map(); // شکل فعل → { family, kind }
const NOUN_FAMILY = new Map(); // اسم هم‌خانواده → family

for (const family of VERB_FAMILIES) {
  for (const form of family.want) {
    FORM_INDEX.set(normalizeText(form), { family, kind: "want" });
  }

  for (const form of family.past) {
    const base = normalizeText(form);

    FORM_INDEX.set(base, { family, kind: "past" });

    // گذشته‌ی نقلی: «خورده‌ام»، «رفته‌ایم»
    const perfect = base.endsWith("یم")
      ? `${base.slice(0, -2)}ه ایم`
      : base.endsWith("م")
        ? `${base.slice(0, -1)}ه ام`
        : null;

    if (perfect) FORM_INDEX.set(perfect, { family, kind: "past" });
  }

  for (const form of INFINITIVES[family.id] || []) {
    FORM_INDEX.set(normalizeText(form), { family, kind: "want" });
  }

  for (const noun of family.nouns) {
    NOUN_FAMILY.set(normalizeText(noun), family);
  }
}

// کلماتی که یعنی جمله پرسش، منفی، شرطی یا گفتگوی عادی است، نه کار
const NATURAL_SKIP_WORDS = new Set([
  "چی", "چیه", "چه", "چرا", "چطور", "چطوری", "چگونه", "چکار", "کی", "کجا",
  "کدوم", "کدام", "چند", "آیا", "مگه", "اگه", "اگر", "کاش", "وقتی",
  "نه", "نیست", "میشه", "شه", "فکر", "فرض", "حدس", "خواهش", "گریه", "تشکر"
]);

// کلمات اضافه که هنگام تطبیق کار انجام‌شده نادیده گرفته می‌شوند
const NATURAL_NOISE = new Set([
  "من", "امروز", "دیروز", "الان", "الآن", "همین", "قبلا", "قبلاً", "بالاخره",
  "تازه", "دیگه", "هم", "حتما", "حتماً", "رو", "را", "که", "لطفا", "ها",
  "صبح", "ظهر", "عصر", "شب", "امشب", "ساعت", "نیم", "ربع", "تا", "عدد"
]);

const EDGE_NOISE = new Set([
  "دیگه", "حتما", "حتماً", "هم", "ها", "که", "من", "لطفا", "خب", "خوب", "پس"
]);

const WANT_PREFIX_RE =
  /(?:^|\s)(?:باید|لازمه|مجبورم|قراره|می خوام|میخوام|می خواستم|میخواستم|یادم نره|یادم باشه|فراموش نکنم)(?=\s|$)/g;

function isBlockedForNatural(original, tokens) {
  if (/[؟?]/.test(String(original))) return true;

  return tokens.some(t =>
    NATURAL_SKIP_WORDS.has(t) ||
    t.startsWith("نمی") ||
    t.startsWith("نخوا") ||
    t.startsWith("نباید")
  );
}

// برای مسیر مدل زبانی: آیا این جمله پرسش/منفی/شرطی نیست؟
function naturalTextAllowed(text) {
  const tokens = normalizeText(text)
    .replace(/[.!؟?،,؛:]+(?=\s|$)/g, " ")
    .split(" ")
    .filter(Boolean);

  return !isBlockedForNatural(text, tokens);
}

function trimEdges(text) {
  const tokens = text.split(" ").filter(Boolean);

  while (tokens.length && EDGE_NOISE.has(tokens[0])) tokens.shift();
  while (tokens.length && EDGE_NOISE.has(tokens[tokens.length - 1])) tokens.pop();

  return tokens.join(" ");
}

// فعل‌های دوکلمه‌ای مثل «خرید کن» را یک واحد حساب می‌کند
function toUnits(tokens) {
  const units = [];

  for (let i = 0; i < tokens.length; i++) {
    const pair =
      i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;

    if (pair && FORM_INDEX.has(pair)) {
      units.push({ text: pair, info: FORM_INDEX.get(pair) });
      i++;
    } else {
      units.push({ text: tokens[i], info: FORM_INDEX.get(tokens[i]) || null });
    }
  }

  return units;
}

function buildDoneIntent(verb, restTokens) {
  const light = verb.info.family.light;
  let family = light ? null : verb.info.family;

  // «نان و لباس خریدم» → دو گروه جدا
  const parts = [[]];

  for (const t of restTokens) {
    if (t === "و") parts.push([]);
    else if (!NATURAL_NOISE.has(t) && !/^\d+$/.test(t)) {
      parts[parts.length - 1].push(t);
    }
  }

  const groups = [];

  for (let tokens of parts) {
    // «خرید کردم» → اسم «خرید» به خانواده‌ی خرید برمی‌گردد
    if (light) {
      const stem = t => t.replace(/(?:شو|مو|تو|ش)$/, "");
      const i = tokens.findIndex(
        t => NOUN_FAMILY.has(t) || NOUN_FAMILY.has(stem(t))
      );

      if (i !== -1) {
        family = NOUN_FAMILY.get(tokens[i]) || NOUN_FAMILY.get(stem(tokens[i]));
        tokens = tokens.filter((_, idx) => idx !== i);
      }
    }

    if (tokens.length) groups.push(tokens);
  }

  if (!groups.length && !family) return null;

  const label =
    groups.map(g => g.join(" ")).join(" و ") || family.nouns[0] || "";

  return { action: "done_natural", family, groups, label };
}

// عبارت اسمی بدون فعل: «خرید نان»، «پرداخت قبض برق»، «تعمیر ماشین»
// فقط وقتی کار حساب می‌شود که با یک اسم‌کار شروع شود و چیزی شبیه دستور، وضعیت
// یا پرسش در آن نباشد. (دستورهای صریح مثل «کار شماره ۲ رو حذف کن» قبل از این
// مرحله تشخیص داده می‌شوند و به اینجا نمی‌رسند.)
const ACTION_NOUNS = new Set([
  "خرید", "مطالعه", "ارسال", "تحویل", "پرداخت", "شستشو", "تعمیر", "نظافت",
  "رزرو", "مراجعه", "تماس", "پیگیری", "تمدید", "واریز", "تسویه"
]);

const NOUN_TASK_BLOCK = new Set([
  // واژه‌های دستور و مدیریت کار
  "کار", "کارها", "کارهای", "کارهام", "کارام", "تسک", "شماره", "لیست", "فهرست",
  "همه", "همشون", "تمام", "تمامی", "حذف", "پاک", "لغو", "ویرایش", "تغییر",
  "عوض", "نمایش", "نشون", "نشان", "جستجو", "سرچ", "پیدا", "انجام", "تموم",
  "تکمیل", "یادآوری", "یادم", "بله", "آره", "تایید", "تأیید", "راهنما", "کمک",
  // وضعیت و توصیف، نه کار
  "شد", "شده", "نشد", "نشده", "هست", "است", "بود", "بوده", "کرد", "کردند",
  "داره", "نداره", "خوبه", "بده", "گرونه", "ارزونه"
]);

// «جلسه ساعت ۵ عصر» / «دکتر فردا ساعت ۴»: اسم + زمان، بدون فعل و بدون پرسش
function detectTimedNounTask(tokens) {
  const text = tokens.join(" ");

  if (
    tokens.some(
      t => NOUN_TASK_BLOCK.has(t) || /^.{3,}(?:دم|تم|یم|ام)$/.test(t)
    )
  ) {
    return null;
  }

  if (!parseReminderTime(text)) return null;

  const FILLER = new Set([
    "ساعت", "به", "برای", "در", "تو", "توی", "رو", "را", "و",
    "صبح", "ظهر", "عصر", "شب"
  ]);

  const rest = text
    .replace(/پس ?فردا|فردا|امروز|امشب/g, " ")
    .replace(RELATIVE_G, " ")
    .replace(CLOCK_A_G, " ")
    .replace(CLOCK_B_G, " ")
    .split(" ")
    .filter(t => t && !FILLER.has(t));

  if (!rest.length) return null;

  return { action: "add", title: text.slice(0, 200) };
}

// اسم‌هایی که خودشان کارِ روزمره‌اند: «ناهار»، «حمام»، «ورزش»
const SOLO_TASK_NOUNS = new Set([
  "ناهار", "شام", "صبحانه", "میان وعده", "عصرانه", "حمام", "دوش", "ورزش",
  "مطالعه", "خرید", "نظافت", "تمیزکاری", "پیاده روی", "دارو", "قرص"
]);

function detectNounTask(tokens) {
  return detectActionNounTask(tokens) || detectTimedNounTask(tokens);
}

function detectActionNounTask(tokens) {
  if (tokens.length < 2 || tokens.length > 5) return null;
  if (!ACTION_NOUNS.has(tokens[0])) return null;
  if (tokens.some(t => NOUN_TASK_BLOCK.has(t))) return null;
  if (/^\d+$/.test(tokens[tokens.length - 1])) return null;

  return { action: "add", title: tokens.join(" ").slice(0, 200) };
}

// فهرست چند کار کوتاه در یک پیام بلند: «نان بخر و شیر بخر و ... »
function detectNaturalList(original, n) {
  if (isBlockedForNatural(original, n.split(" ").filter(Boolean))) return null;

  const parts = splitTaskParts(n);

  if (parts.length < 2 || parts.length > 15) return null;

  const expanded = inheritTaskParts(parts);

  if (!expanded) return null;

  const titles = [];

  for (const part of expanded) {
    const found = detectNaturalIntent(part, part, 1);

    if (!found || found.action !== "add") return null;

    titles.push(found.title);
  }

  return { action: "add_many", titles };
}

function detectNaturalIntent(original, n, depth = 0) {
  const allTokens = n.split(" ").filter(Boolean);

  // پیام بلند فقط وقتی پذیرفته می‌شود که فهرستی از چند کار کوتاه باشد
  if (allTokens.length > 8) {
    return depth ? null : detectNaturalList(original, n);
  }

  if (allTokens.length < 2) return null;
  if (isBlockedForNatural(original, allTokens)) return null;

  const cleaned = trimEdges(
    n.replace(WANT_PREFIX_RE, " ").replace(/\s+/g, " ").trim()
  );

  const tokens = cleaned.split(" ").filter(Boolean);

  if (tokens.length < 2) return null;

  const units = toUnits(tokens);
  const verbs = units.filter(u => u.info);

  if (!verbs.length) return detectNounTask(tokens);

  // ترکیب گذشته و امر در یک جمله مبهم است؛ به مدل زبانی سپرده می‌شود
  if (new Set(verbs.map(v => v.info.kind)).size > 1) return null;

  // کار انجام‌شده: «نان خریدم» / «خرید کردم» / «بازار رفتم»
  if (verbs[0].info.kind === "past") {
    if (verbs.length !== 1) return null;

    return buildDoneIntent(
      verbs[0],
      units.filter(u => !u.info).map(u => u.text)
    );
  }

  // کار جدید: «نان بخر» / «حمام برم» / «خرید بکنم»
  let title = cleaned;
  const rest = units.filter(u => !u.info).map(u => u.text);

  if (!rest.length && verbs[0].text.includes(" ")) {
    title = verbs[0].text.split(" ")[0]; // «خرید کن» → «خرید»
  } else if (
    verbs[0].info.family.light &&
    rest.length === 1 &&
    NOUN_FAMILY.has(rest[0])
  ) {
    title = rest[0]; // «خرید بکنم» → «خرید»
  }

  return { action: "add", title: title.slice(0, 200) };
}

// پیدا کردن کارهای باقی‌مانده‌ای که با جمله‌ی «انجام شد» می‌خوانند
function matchNaturalDone(tasks, intent) {
  const rows = tasks.map(task => ({
    task,
    key: searchKey(task.title),
    tokenKeys: normalizeText(task.title)
      .split(" ")
      .map(searchKey)
      .filter(Boolean)
  }));

  const keysOf = family =>
    new Set(
      [...family.nouns, ...(INFINITIVES[family.id] || []), ...family.past, ...family.want]
        .filter(w => !w.includes(" "))
        .map(searchKey)
    );

  // کارهایی که کلمه‌ی خانواده در عنوانشان هست (نان بخر، خرید لباس، ...)
  const withFamily = family => {
    const keys = keysOf(family);
    return rows.filter(r => r.tokenKeys.some(k => keys.has(k)));
  };

  // کارهای کلی که عنوانشان فقط خودِ فعل/اسم است (مثل «خرید»)
  const generic = family => {
    const keys = keysOf(family);
    return rows.filter(
      r => r.tokenKeys.length && r.tokenKeys.every(k => keys.has(k))
    );
  };

  const found = [];

  if (!intent.groups.length) {
    found.push(withFamily(intent.family));
  } else {
    for (const group of intent.groups) {
      const keys = group.map(searchKey).filter(Boolean);

      if (!keys.length) {
        found.push([]);
        continue;
      }

      // «ناهارمو» هم با کار «ناهار» می‌خواند
      // «ناهارمو» / «پولمو» / «پولو» هم با کار «ناهار» / «پول» می‌خوانند
      const matches = (r, k) =>
        r.key.includes(k) ||
        (k.length > 4 && /(?:مو|شو|تو)$/.test(k) && r.key.includes(k.slice(0, -2))) ||
        (k.length > 3 && k.endsWith("و") && r.key.includes(k.slice(0, -1)));

      let hits = rows.filter(r => keys.every(k => matches(r, k)));

      // «بازار رفتم» ← کار کلی «خرید»
      if (!hits.length) {
        hits = VERB_FAMILIES
          .filter(f =>
            f === intent.family ||
            (f.context && group.every(t => f.context.includes(t)))
          )
          .flatMap(generic);
      }

      found.push(hits);
    }
  }

  const byId = new Map();

  for (const hits of found) {
    for (const r of hits) byId.set(r.task.id, r.task);
  }

  return {
    tasks: [...byId.values()],
    ambiguous: found.some(
      hits => new Set(hits.map(r => r.task.id)).size > 1
    )
  };
}

// =============================================================
// امکانات تکمیلی
//   • چند کار در یک پیام (تا ۱۰ تا): «برم دکتر و داروخانه»
//   • ساعت با نیمروز/شب: «جلسه ساعت ۵ عصر»، «ساعت ۵ و نیم»
//   • تعیین/تغییر ساعت کار: «زنگ مامان رو بذار ساعت ۸ شب»
//   • برگرداندن به انجام‌نشده: «زنگ مامان هنوز مونده»
//   • فهرست روزانه: «امروز چی دارم؟»، «فردا چی دارم؟»
//   • گفتگو: سلام، تشکر، «چند تا کار مونده؟»، «امروز چندشنبه‌ست؟»
// =============================================================

const MAX_TASKS_PER_MESSAGE = 10;
const TEHRAN_TZ = "Asia/Tehran";

// ---------- ساعت ----------

const HOUR_WORDS = {
  "یک": 1, "یه": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6,
  "شیش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12
};

const PERIOD_PATTERN = "صبح|ظهر|بعد ?از ?ظهر|عصر|شب";

const HOUR_PATTERN = [
  "\\d{1,2}",
  ...Object.keys(HOUR_WORDS).sort((a, b) => b.length - a.length)
].join("|");

// «ساعت ۵»، «ساعت ۵:۳۰»، «ساعت ۵ و نیم»، «ساعت پنج عصر»
const CLOCK_A_SRC =
  `ساعت\\s*(${HOUR_PATTERN})(?::(\\d{1,2}))?` +
  `(?:\\s*و\\s*(نیم|ربع|\\d{1,2}\\s*دقیقه))?(?:\\s*(${PERIOD_PATTERN}))?`;

// «۵ عصر»، «۸:۳۰ شب» (بدون کلمه‌ی ساعت، ولی با نیمروز)
const CLOCK_B_SRC = `(?<![\\d:])(\\d{1,2})(?::(\\d{2}))?\\s*(${PERIOD_PATTERN})`;

const CLOCK_A_RE = new RegExp(CLOCK_A_SRC);
const CLOCK_B_RE = new RegExp(CLOCK_B_SRC);
const CLOCK_A_G = new RegExp(CLOCK_A_SRC, "g");
const CLOCK_B_G = new RegExp(CLOCK_B_SRC, "g");

const RELATIVE_G =
  /(?:\d+|یک|یه|دو|سه|چهار|پنج|ده|نیم)\s*(?:دقیقه|ساعت)\s*(?:دیگه|دیگ|بعد)/g;

function findClock(text) {
  const a = text.match(CLOCK_A_RE);
  const m = a || text.match(CLOCK_B_RE);

  if (!m) return null;

  let hour = HOUR_WORDS[m[1]] ?? Number(m[1]);
  let minute = 0;
  let period = "";

  if (a) {
    if (m[2]) minute = Number(m[2]);

    if (m[3]) {
      minute =
        m[3] === "نیم" ? 30 : m[3] === "ربع" ? 15 : parseInt(m[3], 10);
    }

    period = m[4] || "";
  } else {
    if (m[2]) minute = Number(m[2]);
    period = m[3] || "";
  }

  if (!Number.isFinite(hour) || hour > 24 || minute > 59) return null;

  const p = period.replace(/\s/g, "");

  if (p === "عصر" || p === "بعدازظهر") {
    if (hour < 12) hour += 12;
  } else if (p === "شب") {
    if (hour === 12) hour = 0;
    else if (hour >= 4 && hour < 12) hour += 12;
  } else if (p === "ظهر") {
    if (hour >= 1 && hour <= 5) hour += 12;
  }

  // بدون صبح/عصر/شب: «ساعت ۴» معمولاً یعنی بعدازظهر (۱ تا ۵ → ۱۳ تا ۱۷)
  if (!p && hour >= 1 && hour <= 5) hour += 12;

  if (hour > 23) return null;

  return { hour, minute };
}

// ---------- روز و تاریخ ----------

function dayKey(date) {
  const p = tehranParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// کلید روزِ «امروز + offset» به وقت تهران
function dayKeyShift(offset) {
  const p = tehranParts(new Date());

  return new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + offset)
  ).toISOString().slice(0, 10);
}

function sqlDay(value) {
  if (!value) return null;

  const d = new Date(String(value).replace(" ", "T") + "Z");

  return Number.isNaN(d.getTime()) ? null : dayKey(d);
}

function formatDue(iso) {
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "";

  const time = d.toLocaleTimeString("fa-IR", {
    timeZone: TEHRAN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const key = dayKey(d);

  if (key === dayKeyShift(0)) return `امروز ${time}`;
  if (key === dayKeyShift(1)) return `فردا ${time}`;

  const date = d.toLocaleDateString("fa-IR", {
    timeZone: TEHRAN_TZ,
    day: "numeric",
    month: "long"
  });

  return `${date} ${time}`;
}

function dayName(offset) {
  return { "-1": "دیروز", "0": "امروز", "1": "فردا", "2": "پس‌فردا" }[
    String(offset)
  ] || "امروز";
}

function dateInfoReply(kind, offset) {
  const d = new Date(Date.now() + offset * 86400000);

  if (kind === "time") {
    const time = new Date().toLocaleTimeString("fa-IR", {
      timeZone: TEHRAN_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });

    return `🕒 الان ساعت ${time} است (به وقت تهران).`;
  }

  const weekday = d.toLocaleDateString("fa-IR", {
    timeZone: TEHRAN_TZ,
    weekday: "long"
  });

  const full = d.toLocaleDateString("fa-IR", {
    timeZone: TEHRAN_TZ,
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  const greg = d.toLocaleDateString("fa-IR-u-ca-gregory", {
    timeZone: TEHRAN_TZ,
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  if (kind === "weekday") {
    return `${dayName(offset)} ${weekday} است. 📅\n${full} (${greg})`;
  }

  return `📅 ${dayName(offset)}: ${weekday} ${full}\n(${greg})`;
}

// برای ارسال به مدل زبانی تا درباره‌ی تاریخ اشتباه نگوید
function nowDescription() {
  const date = dateInfoReply("date", 0).replace(/^📅\s*/, "");
  const time = dateInfoReply("time", 0).replace(/^🕒\s*/, "");

  return `${date} — ${time}`;
}

// ---------- چند کار در یک پیام ----------

// جداکننده‌ها: خط جدید، «؛»، «،» و «و» (به‌جز «۵ و نیم» و «۵ و ۱۰ دقیقه»)
const AND_SPLIT_RE =
  /\s+و\s+(?!نیم(?:\s|$)|ربع(?:\s|$)|\d+\s*دقیقه)/;

const FILLER_PARTS = new Set([
  "سلام", "درود", "خب", "خوب", "پس", "لطفا", "ممنون", "مرسی", "تشکر"
]);

const TIME_LEAD = new Set([
  "امروز", "فردا", "دیروز", "امشب", "صبح", "ظهر", "عصر", "شب", "بعدازظهر"
]);

// خط جدید و «؛» همیشه جداکننده‌اند؛ «،» فقط وقتی بعد از کلمه‌ی زمان یا عدد نباشد
// (تا «فردا، ساعت ۹ ...» یا «۵,۳۰» به دو کار تبدیل نشود)
function joinSeparators(text) {
  const t = String(text).replace(/[\r\n]+|[;؛]+/g, " و ");

  return t.replace(/([^\s،,]+)\s*[،,]\s*/g, (m, prev) => {
    const key = normalizeText(prev);

    if (/\d$/.test(key) || TIME_LEAD.has(key)) return `${prev} `;

    return `${prev} و `;
  });
}

function splitTaskParts(text) {
  return String(text)
    .split(AND_SPLIT_RE)
    .map(s => s.trim())
    .filter(p => p && !FILLER_PARTS.has(p));
}

// اگر بخشی فعل ندارد، فعل بخش دیگر را قرض می‌گیرد:
//   «برم دکتر و داروخانه» → «برم دکتر»، «برم داروخانه»
//   «نان و شیر بخر»       → «نان بخر»، «شیر بخر»
//   «خرید نان و پنیر»     → «خرید نان»، «خرید پنیر»
// اگر نتوان فعل را قرض داد، null برمی‌گرداند (کار تقسیم نمی‌شود).
function inheritTaskParts(parts) {
  const units = parts.map(p => toUnits(p.split(" ").filter(Boolean)));
  const hasWant = u => u.some(x => x.info && x.info.kind === "want");

  const idx = units.findIndex(hasWant);

  if (idx !== -1) {
    const u = units[idx];
    const vi = u.findIndex(x => x.info && x.info.kind === "want");
    const verb = u[vi].text;
    const atStart = vi === 0;
    const atEnd = vi === u.length - 1;

    const bare = units
      .map((x, i) => (i !== idx && !x.some(y => y.info) ? i : -1))
      .filter(i => i !== -1);

    if (!bare.length) return parts;
    if (!atStart && !atEnd) return null;

    return parts.map((p, i) => {
      if (!bare.includes(i)) return p;

      return atStart ? `${verb} ${p}` : `${p} ${verb}`;
    });
  }

  const first = parts[0].split(" ")[0];

  if (ACTION_NOUNS.has(first)) {
    return parts.map((p, i) => {
      const head = p.split(" ")[0];

      return i === 0 || ACTION_NOUNS.has(head) ? p : `${first} ${p}`;
    });
  }

  return parts;
}

function expandTasks(title) {
  const edge = /^(?:و\s+)+|(?:\s+و)+$/g;
  const text = String(title || "").replace(edge, "").trim();
  const parts = splitTaskParts(normalizeText(text).replace(edge, ""));

  if (parts.length < 2) return [text];

  return inheritTaskParts(parts) || [text];
}

// ---------- وضعیت چند کار با هم ----------

// «کار ۱ و ۲ و ۳» یا «نان و شیر» → یک یا چند مرجع
function buildStatusAction(op, title) {
  if (/^[\d\s و]+$/.test(title) && /\d/.test(title)) {
    const ids = [...new Set(
      [...title.matchAll(/\d+/g)].map(x => numberValue(x[0])).filter(Boolean)
    )];

    if (ids.length > 1) {
      return { action: "multi", op, refs: ids.map(id => ({ task_id: id })) };
    }
  }

  const parts = splitTaskParts(title);

  if (parts.length > 1) {
    return {
      action: "multi",
      op,
      refs: parts.map(p => taskRef(cleanTitle(p)))
    };
  }

  return { action: op, ...taskRef(title) };
}

// وقتی چند کار مشابه هست: برای «انجام شد» اول باقی‌مانده‌ها، برای «برگردان» اول انجام‌شده‌ها
function preferByOp(tasks, op) {
  if (op === "done" || op === "settime") {
    const pending = tasks.filter(t => !t.completed);
    return pending.length ? pending : tasks;
  }

  if (op === "undone") {
    const done = tasks.filter(t => t.completed);
    return done.length ? done : tasks;
  }

  return tasks;
}

// «زنگ مامان هنوز مونده» / «هنوز نان نخریدم» → برگرداندن به انجام‌نشده
function detectUndoneNatural(original, n) {
  if (/[؟?]/.test(String(original))) return null;

  // «تیک نان رو بردار» / «نان تیکش رو بردار»
  const tick =
    n.match(/^تیک\s+(.+?)(?:\s+رو)?\s+بردار$/) ||
    n.match(/^(.+?)(?:\s+رو)?\s+تیکش(?:\s+رو)?\s+بردار$/) ||
    n.match(/^(.+?)\s+تیک(?:\s+رو)?\s+بردار$/);

  if (tick) {
    const tickTitle = cleanTitle(tick[1]);

    if (tickTitle) return { action: "undone", ...taskRef(tickTitle) };
  }

  const tokens = n.split(" ").filter(Boolean);

  if (tokens.length < 2 || tokens.length > 8) return null;

  const hasStill = tokens.includes("هنوز") || tokens.includes("هنوزم");
  const lastIsRemain = ["مانده", "مونده", "باقیه"].includes(
    tokens[tokens.length - 1]
  );

  // «زنگ مامان هنوز مونده» / «زنگ مامان مونده»
  if (!hasStill && !lastIsRemain) return null;

  const markers = new Set([
    "مانده", "مونده", "باقیه", "نشده", "نشد", "نمونده", "ندادم"
  ]);

  const isNegPast = t =>
    t.startsWith("ن") && FORM_INDEX.get(t.slice(1))?.kind === "past";

  // «هنوز پول رو پرداخت نکردم» → جستجوی هوشمند بین کارهای انجام‌شده
  if (tokens.some(isNegPast)) {
    const negated = detectNegatedNatural(original, n);

    if (negated) return negated;
  }

  if (!tokens.some(t => markers.has(t) || isNegPast(t))) return null;

  const drop = new Set([
    "هنوز", "هنوزم", "انجام", "رو", "را", "که", "هم", "دیگه", "من", "باقی",
    ...markers
  ]);

  const title = tokens
    .filter(t => !drop.has(t) && !isNegPast(t))
    .join(" ");

  if (!title || isListOnlyTitle(title)) return null;

  return { action: "undone", ...taskRef(title) };
}

// =============================================================
// جستجوی عبارت‌گونه، برگرداندن به انجام‌نشده و جمله‌های منفی/مجهول
// =============================================================

// «کارهارو» → «کارها رو»، «کارامو» → «کارام رو»
const ATTACHED_RA_RE =
  /(^|\s)(کارها|کارای|کارا|کار|تسکها|تسک|کارهام|کارام|کارم|وظایفم|وظایف|لیست|فهرست)(?:رو|را|و)(?=\s|$)/g;

const TASK_NOUN_TOKENS = new Set([
  "کار", "کارها", "کارهای", "کارهایی", "کارای", "کارایی", "کارا", "کاری",
  "کارام", "کارهام", "تسک", "تسکها", "تسکهای", "تسکای", "وظایف", "وظیفه"
]);

const SEARCH_LEAD_START = new Set([
  "لیست", "فهرست", "همه", "تمام", "تمامی", "کل", "هر", "کدوم", "کدام", "چه",
  ...TASK_NOUN_TOKENS
]);

// شروعِ جمعِ فهرست‌گونه؛ «کار» تکی برای «کار ۱ انجام شد» کنار گذاشته می‌شود
const PLURAL_LEAD = new Set([
  "لیست", "فهرست", "همه", "تمام", "تمامی", "کل", "کدوم", "کدام", "چه",
  "کارها", "کارهای", "کارهایی", "کارای", "کارایی", "کارا", "کارام", "کارهام",
  "تسکها", "تسکهای", "تسکای", "وظایف"
]);

const SEARCH_LEAD = new Set([
  "لیست", "فهرست", "همه", "تمام", "تمامی", "کل", "هر", "هرچی", "کدوم",
  "کدام", "چه", "کار", "کارها", "کارهای", "کارهایی", "کارای", "کارایی",
  "کارا", "کاری", "کارام", "کارهام", "کارم", "تسک", "تسکها", "تسکهای",
  "تسکای", "وظایف", "وظیفه", "که", "ی", "ها", "های", "هایی", "ای", "رو",
  "را", "مربوط", "مرتبط", "به", "با", "برای", "درباره", "در", "مورد", "راجع",
  "شامل", "حاوی", "دارای", "کلمه", "عبارت", "واژه", "اسم", "عنوان", "مثل",
  "مثلا", "من", "شماره", "اون", "همون"
]);

const SEARCH_TRAIL = new Set([
  "توش", "توشه", "توشون", "داخلش", "داخلشون", "داره", "دارن", "دارند",
  "دارد", "هست", "هستن", "هستند", "هستش", "است", "باشه", "باشن", "باشند",
  "بود", "هم", "رو", "را", "که", "ها", "های", "شامل", "میشه", "میشن",
  "می", "شه", "شن", "وجود", "نشون", "بده", "بیار", "بگو", "بگیر", "من",
  "همه", "ی", "ای", "هایی", "ست", "ه", "نمایش", "اند"
]);

// کلماتی که یعنی جمله جستجو نیست (پرسش، گزاره‌ی شخصی، شرط)
const SEARCH_BLOCK = new Set([
  "دارم", "داریم", "باید", "میخوام", "خوام", "چیه", "چی", "چرا", "چطور",
  "چطوری", "کی", "کجا", "نیست", "نه", "آیا", "مگه", "اگه", "اگر", "شد",
  "نشد", "کنم", "بکنم"
]);

// «کارهایی که خرید توش هست» → «خرید»؛ کلمات اضافی دو طرف حذف می‌شوند
function cleanSearchTerm(text) {
  const tokens = String(text).split(" ").filter(Boolean);

  while (tokens.length && SEARCH_LEAD.has(tokens[0])) tokens.shift();
  while (tokens.length && SEARCH_TRAIL.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(" ");
}

// فقط واژه‌های «فهرست/کار/ها» بدون هیچ عنوان واقعی
function isListOnlyTitle(title) {
  const tokens = String(title).split(" ").filter(Boolean);

  return (
    tokens.length > 0 &&
    tokens.every(
      t =>
        LIST_WORDS.has(t) ||
        LIST_NOUNS.has(t) ||
        LIST_FILLER.has(t) ||
        TASK_NOUN_TOKENS.has(t)
    )
  );
}

// «کارای خرید» / «کارهایی که خرید توش هست» / «لیست کارهای باقی‌مانده»
// requireFilter: فقط وقتی فیلتر «انجام‌شده/باقی‌مانده» در جمله هست
//   (برای «کارهای خرید انجام نشده» که نباید به‌جای فهرست، وضعیت را عوض کند)
function detectSearchPhrase(n, requireFilter = false) {
  const all = n.split(" ").filter(Boolean);

  if (all.length < 2 || all.length > 10) return null;
  if (!SEARCH_LEAD_START.has(all[0])) return null;
  if (requireFilter && !PLURAL_LEAD.has(all[0])) return null;
  if (all.some(t => SEARCH_BLOCK.has(t) || FORM_INDEX.has(t))) return null;

  // «انجام شد» فعل گذشته است، نه فیلتر
  if (requireFilter && /(?:^|\s)انجام شد(?=\s|$)/.test(n)) return null;

  const { filter, rest } = parseFilter(n);

  if (requireFilter && !filter) return null;

  // «کارهای امروز (که مونده)» → فهرست روزانه
  let body = rest;
  const dayOff = dayOffsetOf(rest);

  if (dayOff !== null) {
    body = rest.replace(
      /(?:^|\s)(?:پس ?فردا|فردا|دیروز|امروز|امشب)(?=\s|$)/g,
      " "
    );

    return cleanSearchTerm(body.replace(/\s+/g, " ").trim())
      ? null
      : { action: "day_list", day: dayOff };
  }

  const term = cleanSearchTerm(body.replace(/\s+/g, " ").trim());

  if (!term) return filter ? { action: "list", filter } : null;

  // «کار شماره ۱ و ۲» → نمایش همان کارها
  if (/^\d+(?:\s*(?:و|،|,)?\s*\d+)*$/.test(term)) {
    if (requireFilter) return null;

    const ids = [...term.matchAll(/\d+/g)]
      .map(x => numberValue(x[0]))
      .filter(Boolean);

    return ids.length
      ? { action: "show_selected", task_ids: [...new Set(ids)] }
      : null;
  }

  if (/\d/.test(term) || term.split(" ").length > 4) return null;

  return { action: "search", title: term, filter };
}

// «برگردون» و هم‌خانواده‌ها + مقصد «به انجام نشده ها / باقی مانده ها / لیست»
const BACK_VERBS =
  "برگردون(?:ش|ید)?|برگردان(?:ش|ید)?|بازگردون(?:ش)?|بازگردان(?:ش)?|برش گردون|برش گردان|برگشت بده|برگشتش بده";

const BACK_DEST_RE =
  /(?:^|\s)(?:به|تو|توی|در|داخل)?\s*(?:لیست|فهرست)?\s*(?:کارهای|کارای|کارها|کارا|تسک ها|تسک های)?\s*(?:انجام ?نشده|باقی ?مانده|باقی ?مونده|مانده|مونده|نیمه ?کاره|معلق)(?:\s+ها)?(?=\s|$)/g;

// «زنگ مامان رو برگردون به انجام نشده ها» / «برگردون زنگ مامان رو» / «برگردان کار ...»
function detectReturnToPending(n) {
  const stripped = n
    .replace(BACK_DEST_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rest = takeVerb(stripped, BACK_VERBS);

  if (rest === null) return null;

  const title = cleanTitle(dropFillers(rest));

  if (!title || isListOnlyTitle(title)) {
    return chatReply(
      "کدوم کار رو برگردونم؟ اسم یا شماره‌اش رو هم بنویس؛ مثلاً " +
        "«زنگ مامان رو برگردون به انجام نشده‌ها» یا «کار ۲ رو برگردون»."
    );
  }

  return buildStatusAction("undone", title);
}

// فعل گذشته‌ی منفی اول‌شخص: «نخریدم»، «نکردم»، «نپرداختم»، «نکرده‌ام»
const NOT_NEGATIVE_FORMS = new Set(["نشستم", "نشستیم"]);

function negatedPastInfo(token) {
  if (!token.startsWith("ن") || NOT_NEGATIVE_FORMS.has(token)) return null;

  const s = token.slice(1);
  const candidates = [s];

  if (s.startsWith("ی")) candidates.push(s.slice(1)); // «نیاوردم» → «اوردم»
  if (s.startsWith("یا")) candidates.push(`آ${s.slice(2)}`);

  for (const c of candidates) {
    const info = FORM_INDEX.get(c);

    if (info && info.kind === "past") return info;
  }

  return null;
}

const NEG_NOISE = new Set([
  "هنوز", "هنوزم", "اصلا", "واقعا", "من", "که", "هم", "دیگه", "رو", "را",
  "امروز", "هیچ"
]);

// «پرداخت نکردم» / «پول رو نپرداختم» / «نان نخریدم» → برگرداندن به انجام‌نشده
function detectNegatedNatural(original, n) {
  if (/[؟?]/.test(String(original))) return null;

  const tokens = n.split(" ").filter(Boolean);

  if (tokens.length < 2 || tokens.length > 8) return null;
  if (isBlockedForNatural(original, tokens)) return null;

  let verbInfo = null;
  const rest = [];

  for (let i = 0; i < tokens.length; i++) {
    const single = negatedPastInfo(tokens[i]);

    if (single) {
      if (verbInfo) return null;

      verbInfo = single;
      continue;
    }

    // گذشته‌ی نقلی منفی: «نکرده‌ام» → «نکرده ام»
    if (i + 1 < tokens.length && tokens[i].startsWith("ن")) {
      const pair = `${tokens[i]} ${tokens[i + 1]}`;
      const info = FORM_INDEX.get(pair.slice(1));

      if (info && info.kind === "past") {
        if (verbInfo) return null;

        verbInfo = info;
        i++;
        continue;
      }
    }

    // ترکیب با فعل مثبت در همان جمله مبهم است؛ به مدل زبانی سپرده می‌شود
    if (FORM_INDEX.has(tokens[i])) return null;

    if (!NEG_NOISE.has(tokens[i])) rest.push(tokens[i]);
  }

  if (!verbInfo) return null;

  const intent = buildDoneIntent({ info: verbInfo }, rest);

  if (!intent) return null;

  return { ...intent, action: "undone_natural" };
}

// «پول پرداخت شد» → انجام‌شده؛ «پرداخت نشد» → انجام‌نشده
function detectPassiveStatus(original, n) {
  if (/[؟?]/.test(String(original))) return null;

  const tokens = n.split(" ").filter(Boolean);

  if (tokens.length < 2 || tokens.length > 6) return null;

  const last = tokens[tokens.length - 1];
  const negative = last === "نشد" || last === "نشده";
  const positive = last === "شد" || last === "شده";

  if (!negative && !positive) return null;
  if (isBlockedForNatural(original, tokens)) return null;

  const body = tokens.slice(0, -1);
  const nounIdx = body.findIndex(t => NOUN_FAMILY.has(t));

  if (nounIdx === -1) return null;

  const family = NOUN_FAMILY.get(body[nounIdx]);
  const rest = body.filter((_, i) => i !== nounIdx);

  const intent = buildDoneIntent({ info: { family } }, rest);

  if (!intent) return null;

  return { ...intent, action: positive ? "done_natural" : "undone_natural" };
}

// ---------- جستجوی کارها در حافظه (با خانواده‌ی فعل) ----------

function familyOfTerm(term) {
  const k = normalizeText(term);
  const family = NOUN_FAMILY.get(k) || FORM_INDEX.get(k)?.family || null;

  return family && !family.light ? family : null;
}

function familyKeySet(family) {
  return new Set(
    [
      ...family.nouns,
      ...(INFINITIVES[family.id] || []),
      ...family.past,
      ...family.want,
      ...(family.context || [])
    ]
      .filter(w => !w.includes(" "))
      .map(searchKey)
  );
}

// «خرید» → هم کارهایی که خود «خرید» در عنوانشان است، هم «نان بخر» و «لباس بخرم»
function searchTasksLocal(all, phrase) {
  const found = new Map();
  const addAll = list => list.forEach(t => found.set(t.id, t));

  const hasKey = (task, key) => key && searchKey(task.title).includes(key);

  addAll(all.filter(t => hasKey(t, searchKey(phrase))));

  const terms = phrase
    .split(/\s+و\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  // «خرید و دارو»: اگر عبارت کامل پیدا نشد، هر بخش جدا جستجو می‌شود
  if (!found.size && terms.length > 1) {
    for (const term of terms) addAll(all.filter(t => hasKey(t, searchKey(term))));
  }

  for (const term of terms) {
    const family = familyOfTerm(term);

    if (!family) continue;

    const keys = familyKeySet(family);

    addAll(
      all.filter(t =>
        normalizeText(t.title)
          .split(" ")
          .map(searchKey)
          .some(k => keys.has(k))
      )
    );
  }

  return [...found.values()].sort((a, b) => a.id - b.id);
}

// فهرست با عنوان و شمارش
function formatTaskReport(tasks, { term = "", filter = null } = {}) {
  const scope =
    filter === "pending" ? "باقی‌مانده" : filter === "done" ? "انجام‌شده" : "";

  if (!tasks.length) {
    if (term) {
      return `کاری مربوط به «${term}»${scope ? ` در کارهای ${scope}` : ""} پیدا نشد.`;
    }

    if (filter === "pending") return "هیچ کار باقی‌مانده‌ای نداری 🎉";
    if (filter === "done") return "هنوز کاری انجام‌شده ثبت نشده.";

    return "هنوز کاری ثبت نکردی. با «اضافه کن ...» شروع کن.";
  }

  const count = `(${tasks.length})`;

  const head = term
    ? `🔎 کارهای مربوط به «${term}»${scope ? ` — ${scope}` : ""} ${count}:`
    : filter === "pending"
      ? `⏳ کارهای باقی‌مانده ${count}:`
      : filter === "done"
        ? `✅ کارهای انجام‌شده ${count}:`
        : `📋 همه‌ی کارها ${count}:`;

  const lines = filter
    ? tasks.map(taskLine).join("\n")
    : formatTasks(tasks);

  return `${head}\n\n${lines}`;
}

// ---------- تعیین یا تغییر ساعت کار ----------

// «زنگ مامان رو بذار ساعت ۸ شب» / «ساعت جلسه رو عوض کن ساعت ۶»
function detectSetTime(n) {
  if (/یادم بنداز|یادآوری کن/.test(n)) return null;

  const dueAt = parseReminderTime(n);

  if (!dueAt) return null;

  // عبارت زمان را برمی‌داریم تا فعل به ابتدا یا انتهای جمله برسد
  const bare = n
    .replace(RELATIVE_G, " ")
    .replace(CLOCK_A_G, " ")
    .replace(CLOCK_B_G, " ")
    .replace(/(?:^|\s)(?:پس ?فردا|فردا|امروز|امشب)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(?:ساعت|به|برای)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let rest = takeVerb(
    bare,
    "بذارش|بگذارش|بزارش|بذارید|بذار|بگذار|بزار|تنظیمش کن|تنظیم کن"
  );

  if (rest === null) {
    // «کار ۱ رو به X تغییر بده» ویرایش عنوان است، نه ساعت
    if (/(?:^|\s)به(?:\s|$)/.test(n.replace(/به\s+(?=ساعت|\d)/g, " "))) {
      return null;
    }

    rest = takeVerb(bare, "عوضش کن|عوض کن|تغییرش بده|تغییر بده");
  }

  if (rest === null) return null;

  const title = cleanTitle(rest);

  if (!title) return null;

  return {
    action: "set_time",
    ...taskRef(title),
    dueAt: dueAt.toISOString()
  };
}

// ---------- پرسش و پاسخ، فهرست روزانه ----------

const DAY_WORDS = new Set(["امروز", "فردا", "دیروز", "پس", "امشب"]);

function dayOffsetOf(text) {
  if (/(?:^|\s)پس ?فردا(?=\s|$)/.test(text)) return 2;
  if (/(?:^|\s)فردا(?=\s|$)/.test(text)) return 1;
  if (/(?:^|\s)دیروز(?=\s|$)/.test(text)) return -1;
  if (/(?:^|\s)(?:امروز|امشب)(?=\s|$)/.test(text)) return 0;

  return null;
}

const LISTQ_WORDS = new Set([
  "چی", "چه", "چیکار", "چکار", "کار", "کارها", "کارهای", "کارای", "کارام",
  "کارهام", "کارم", "کارهایی", "کارایی", "وظایف", "وظیفه", "تسک", "برنامه", "برنامم", "لیست", "فهرست",
  "دارم", "داشتم", "داریم", "هست", "من", "ی", "ها", "های", "هایی", "رو", "را",
  "و", "چیه", "چیا", "کدوم", "کدومه", "کدوما"
]);

const REMAIN_WORDS = new Set([
  "مانده", "مونده", "باقی", "باقیه", "باقیمانده", "باقیمونده"
]);

const DATE_WORDS = new Set([
  "امروز", "فردا", "دیروز", "پس", "چند", "شنبه", "چندشنبه", "چه", "روزی",
  "روزیه", "روز", "است", "هست", "ست", "ه", "چیه", "چنده", "چندمه", "چندم",
  "تاریخ", "ماهه", "ماه", "ساعت", "الان", "الآن", "الان", "الآن", "الان"
]);

const DATE_QUESTION_WORDS = [
  "چند", "چنده", "چه", "چیه", "چندمه", "چندم", "چندشنبه", "تاریخ", "روزیه"
];

const COUNT_RE = /چند(?:\s*تا)?(?:\s*از)?\s*(?:کار|تسک)/;

function chatReply(reply) {
  return { action: "chat", reply };
}

// «چند تا کار مونده؟» / «چند تا کار انجام دادم؟» / «امروز چند تا کار دارم؟»
// (پیش از دستورهای «انجام شد» بررسی می‌شود تا «انجام دادم» در پرسش اشتباه نشود)
function detectCountQuery(n) {
  if (!COUNT_RE.test(n)) return null;

  let scope = "pending";

  if (/انجام\s*(?:شده|شد|دادم|کردم)|تموم|تمام شده|تیک/.test(n)) {
    scope = "done";
  } else if (/(?:^|\s)(?:کلا|کل|مجموع|ثبت|همه)(?=\s|$)/.test(n)) {
    scope = "all";
  }

  return { action: "count", scope, day: dayOffsetOf(n) };
}

const LIST_NOUNS = new Set([
  "کار", "کارها", "کارهای", "کارهام", "کارام", "کارم", "کارای", "کارا",
  "وظایف", "وظایفم", "وظیفه", "تسک", "تسکام", "تسکهام", "لیست", "فهرست",
  "برنامه"
]);

const LIST_FILLER = new Set([
  "من", "چیه", "چیا", "چی", "هست", "هستن", "کدومه", "کدوما", "ها", "های",
  "رو", "را", "دارم", "همه", "تمام", "ی", "کل", "هام", "ام", "م"
]);

// «کارهام» / «وظایف من چیه» / «لیست کارها» / «چی دارم»
function isListRequest(n) {
  if (n === "چی دارم" || n === "چیکار دارم") return true;

  const tokens = n.split(" ").filter(Boolean);

  return (
    tokens.some(t => LIST_NOUNS.has(t)) &&
    tokens.every(t => LIST_NOUNS.has(t) || LIST_FILLER.has(t))
  );
}

function detectInfoQuery(n) {
  const tokens = n.split(" ").filter(Boolean);

  if (!tokens.length || tokens.length > 8) return null;

  // سلام، احوال‌پرسی، تشکر، خداحافظی (فقط وقتی کل پیام همین باشد)
  if (
    /^(?:سلام|درود|هلو|های|hi|hello|سلام علیکم|صبح بخیر|ظهر بخیر|عصر بخیر|روز بخیر|وقت بخیر|سلام صبح بخیر|سلام وقت بخیر)(?:\s+(?:هرمس|رفیق|عزیزم))?$/.test(n)
  ) {
    return chatReply(
      "سلام! 👋 چطور می‌تونم کمکت کنم؟\nبرای دیدن امکانات بنویس «راهنما»."
    );
  }

  if (/^(?:سلام\s+)?(?:خوبی|حالت چطوره|چطوری|احوال شما)(?:\s+هرمس)?$/.test(n)) {
    return chatReply("ممنون، خوبم! 😊 تو چطوری؟ اگه کاری داری بگو.");
  }

  if (
    /^(?:خیلی\s+)?(?:تشکر|مرسی|ممنون|ممنونم|سپاس|متشکرم|مچکرم|دمت گرم|دستت درد نکنه|thanks|thank you)(?:\s+(?:ازت|از تو|هرمس|عزیز|زیاد|بابت همه چی))*$/.test(n)
  ) {
    return chatReply("خواهش می‌کنم! 🌸");
  }

  if (/^(?:خداحافظ|بای|فعلا|خدانگهدار|شب بخیر)$/.test(n)) {
    return chatReply("خدانگهدار! 👋");
  }

  // «امروز چندشنبه‌ست؟» / «تاریخ امروز» / «ساعت چنده؟»
  if (
    tokens.every(t => DATE_WORDS.has(t)) &&
    tokens.some(t => DATE_QUESTION_WORDS.includes(t))
  ) {
    const offset = dayOffsetOf(n) ?? 0;

    if (tokens.includes("ساعت")) return chatReply(dateInfoReply("time", 0));

    if (tokens.some(t => ["تاریخ", "چندمه", "چندم", "ماهه", "ماه"].includes(t))) {
      return chatReply(dateInfoReply("date", offset));
    }

    return chatReply(dateInfoReply("weekday", offset));
  }

  // «امروز چی دارم؟» / «فردا چی دارم؟» / «کارهای امروز»
  const offset = dayOffsetOf(n);

  if (offset !== null) {
    const others = tokens.filter(t => !DAY_WORDS.has(t));

    if (
      others.length &&
      others.every(t => LISTQ_WORDS.has(t)) &&
      others.some(t => !["و", "رو", "را", "ی", "ها", "های", "هایی"].includes(t))
    ) {
      return { action: "day_list", day: offset };
    }
  }

  // «چی مونده؟» / «کارهای باقی مانده»
  if (
    tokens.length >= 2 &&
    tokens.some(t => REMAIN_WORDS.has(t)) &&
    tokens.every(t => LISTQ_WORDS.has(t) || REMAIN_WORDS.has(t) || t === "مانده")
  ) {
    return { action: "list", filter: "pending" };
  }

  return null;
}

// ---------- فهرست روزانه ----------

// کارهای یک روز را به سه دسته تقسیم می‌کند
function bucketDay(tasks, offset) {
  const target = dayKeyShift(offset);

  const rows = tasks.map(t => ({
    t,
    created: sqlDay(t.created_at),
    due: t.due_at ? dayKey(new Date(t.due_at)) : null,
    done: t.completed ? sqlDay(t.completed_at) : null
  }));

  const inDay = rows.filter(x =>
    offset > 0
      ? x.due === target
      : x.due === target ||
        (!x.due && x.created === target) ||
        x.done === target
  );

  const byTime = (a, b) =>
    String(a.t.due_at || "9999").localeCompare(String(b.t.due_at || "9999")) ||
    a.t.id - b.t.id;

  const remaining = inDay.filter(x => !x.t.completed).sort(byTime).map(x => x.t);
  const done = inDay.filter(x => x.t.completed).sort(byTime).map(x => x.t);

  // کارهای باقی‌مانده از روزهای قبل (فقط برای امروز)
  const carry =
    offset === 0
      ? rows
          .filter(x =>
            !x.t.completed &&
            !inDay.includes(x) &&
            (x.due ? x.due < target : x.created && x.created < target)
          )
          .map(x => x.t)
      : [];

  return { remaining, done, carry };
}

function taskLine(task) {
  const due = !task.completed && task.due_at
    ? ` — ⏰ ${formatDue(task.due_at)}`
    : "";

  return `${task.id}. ${task.title}${due}`;
}

function formatDayList(tasks, offset) {
  const label = dayName(offset);
  const { remaining, done, carry } = bucketDay(tasks, offset);

  const date = new Date(Date.now() + offset * 86400000).toLocaleDateString(
    "fa-IR",
    { timeZone: TEHRAN_TZ, weekday: "long", day: "numeric", month: "long" }
  );

  const header = `📅 ${label} — ${date}`;
  const sections = [];

  if (remaining.length) {
    sections.push(`⏳ باقی‌مانده:\n${remaining.map(taskLine).join("\n")}`);
  }

  if (done.length) {
    sections.push(`✅ انجام‌شده:\n${done.map(taskLine).join("\n")}`);
  }

  if (carry.length) {
    sections.push(
      `📌 مانده از روزهای قبل:\n${carry.map(taskLine).join("\n")}`
    );
  }

  if (!sections.length) {
    return offset === 0
      ? `${header}\n\nبرای امروز کاری نداری 🎉`
      : `${header}\n\nبرای ${label} کاری ثبت نشده.`;
  }

  return `${header}\n\n${sections.join("\n\n")}`;
}

function formatCount(tasks, scope, day) {
  let pending;
  let done;

  if (day === null || day === undefined) {
    pending = tasks.filter(t => !t.completed).length;
    done = tasks.filter(t => t.completed).length;
  } else {
    const b = bucketDay(tasks, day);

    pending = b.remaining.length + b.carry.length;
    done = b.done.length;
  }

  const when = day === null || day === undefined ? "" : `${dayName(day)}: `;

  if (scope === "done") {
    return done
      ? `✅ ${when}${done} کار انجام‌شده.`
      : `${when}هنوز کاری انجام‌شده ثبت نشده.`;
  }

  if (scope === "all") {
    return `📋 ${when}در مجموع ${pending + done} کار: ${pending} باقی‌مانده و ${done} انجام‌شده.`;
  }

  return pending
    ? `⏳ ${when}${pending} کار باقی‌مانده داری.`
    : `${when}هیچ کار باقی‌مانده‌ای نداری 🎉`;
}

// ---------- افزودن کار (تکی یا چندتایی) ----------

async function addTaskWithTime(db, userId, rawTitle) {
  const uid = String(userId);
  const timed = parseTimedTask(rawTitle);

  if (timed) {
    const inserted = await db.prepare(`
      INSERT INTO tasks (user_id, title)
      VALUES (?, ?)
    `).bind(uid, timed.title).run();

    await db.prepare(`
      INSERT INTO reminders (user_id, task_id, message, due_at)
      VALUES (?, ?, ?, ?)
    `).bind(
      uid,
      inserted.meta.last_row_id,
      timed.title,
      timed.dueAt.toISOString()
    ).run();

    return { title: timed.title, dueAt: timed.dueAt };
  }

  await db.prepare(`
    INSERT INTO tasks (user_id, title)
    VALUES (?, ?)
  `).bind(uid, rawTitle).run();

  return { title: rawTitle, dueAt: null };
}

async function addTasks(db, userId, titles) {
  const clean = titles.map(t => String(t).trim()).filter(Boolean);

  if (!clean.length) return "عنوان کار مشخص نیست. لطفاً دوباره بنویس.";

  const batch = clean.slice(0, MAX_TASKS_PER_MESSAGE);
  const added = [];

  for (const title of batch) {
    added.push(await addTaskWithTime(db, userId, title));
  }

  const when = d =>
    d.toLocaleString("fa-IR", { timeZone: TEHRAN_TZ });

  if (added.length === 1) {
    const [one] = added;

    return one.dueAt
      ? `✅ کار «${one.title}» اضافه شد.\n` +
          `⏰ یادآوری آن برای ${when(one.dueAt)} تنظیم شد.`
      : `✅ کار «${one.title}» اضافه شد.`;
  }

  const lines = added.map(a =>
    a.dueAt ? `• ${a.title} — ⏰ ${formatDue(a.dueAt.toISOString())}` : `• ${a.title}`
  );

  let reply = `✅ ${added.length} کار اضافه شد:\n${lines.join("\n")}`;

  if (clean.length > MAX_TASKS_PER_MESSAGE) {
    reply +=
      `\n\n⚠️ در هر پیام فقط ${MAX_TASKS_PER_MESSAGE} کار ثبت می‌شود؛ ` +
      `${clean.length - MAX_TASKS_PER_MESSAGE} مورد آخر ثبت نشد.`;
  }

  return reply;
}

// ستون‌های کار + ساعت یادآوری (اگر داشته باشد)
const TASK_COLUMNS = `
  t.id, t.title, t.completed, t.created_at, t.completed_at,
  (SELECT MAX(r.due_at)
     FROM reminders r
    WHERE r.task_id = t.id AND r.status != 'cancelled') AS due_at
`;

function applyFilter(tasks, filter) {
  if (filter === "pending") return tasks.filter(t => !t.completed);
  if (filter === "done") return tasks.filter(t => t.completed);
  return tasks;
}

// -----------------------------
// تشخیص یادآوری
// -----------------------------

function parseReminderRequest(text) {
  const normalized = normalizeText(text);

  if (
    !normalized.includes("یادم بنداز") &&
    !normalized.includes("یادآوری کن") &&
    !normalized.includes("یادم باشه") &&
    !normalized.includes("یادم نره")
  ) {
    return null;
  }

  const dueAt = parseReminderTime(normalized);

  if (!dueAt) return null;

  let message = normalized
    .replace(/یادم بنداز/g, "")
    .replace(/یادآوری کن/g, "")
    .replace(/یادم باشه|یادم نره/g, "")
    .replace(/پس ?فردا|فردا|امروز|امشب/g, "")
    .replace(RELATIVE_G, "")
    .replace(CLOCK_A_G, "")
    .replace(CLOCK_B_G, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) message = "یادآوری";

  return { message, dueAt };
}

// -----------------------------
// تشخیص کار زمان‌دار
// -----------------------------

function parseTimedTask(text) {
  const normalized = normalizeText(text);

  if (
    normalized.includes("یادم بنداز") ||
    normalized.includes("یادآوری کن")
  ) {
    return null;
  }

  const dueAt = parseReminderTime(normalized);

  if (!dueAt) return null;

  const title = normalized
    .replace(/پس ?فردا|فردا|امروز|امشب/g, "")
    .replace(RELATIVE_G, "")
    .replace(CLOCK_A_G, "")
    .replace(CLOCK_B_G, "")
    .replace(/لطفا|لطفاً/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (title.length < 2) return null;

  return { title, dueAt };
}

// -----------------------------
// تاریخچه گفتگو
// -----------------------------

async function saveHistory(db, userId, role, content) {
  await db.prepare(`
    INSERT INTO conversation_history (user_id, role, content)
    VALUES (?, ?, ?)
  `).bind(String(userId), role, content).run();
}

async function getHistory(db, userId) {
  const result = await db.prepare(`
    SELECT role, content
    FROM conversation_history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `).bind(String(userId)).all();

  return (result.results || []).reverse();
}

// -----------------------------
// هوش مصنوعی
// -----------------------------

async function understandMessage(env, userText, history) {
  const messages = [
    {
      role: "system",
      content: `
تو دستیار مدیریت کارها هستی و باید فارسی پاسخ بدهی.
تاریخ و ساعت اکنون: ${nowDescription()}

عملیات مجاز:
add, done, undone, del, edit, search, list, chat

قوانین:
- اضافه کردن کار: add
- انجام‌شده کردن کار: done
- برگرداندن کار به انجام‌نشده: undone
- حذف یک کار: del
- ویرایش عنوان کار: edit
- جستجوی کار: search
- نمایش فهرست: list
- گفتگوی معمولی: chat
- هیچ‌وقت عملیات حذف همه کارها را اجرا نکن.
- اگر کاربر قصد یا نیاز به انجام کاری را می‌گوید (مثل «نان بخر»، «حمام برم»، «باید لباس بخرم»، «خرید بکنم»، «درس بخونم») → add و عنوان کوتاه در title.
- اگر کاربر می‌گوید کاری را انجام داده (مثل «نان خریدم»، «خرید کردم»، «بازار رفتم»، «حمام کردم») → done و فقط موضوع کار در title (مثلاً «نان»، «خرید»، «بازار»).
- اگر کاربر می‌گوید کاری را انجام نداده یا هنوز مانده (مثل «پرداخت نکردم»، «نان نخریدم»، «زنگ مامان هنوز مونده»، «زنگ مامان رو برگردون به انجام نشده‌ها») → undone و فقط موضوع کار در title.
- پرسش، احوال‌پرسی یا جمله‌ی شرطی (مثل «اگه بخرم»، «چی بخرم؟») → chat؛ نه add و نه done.
- «کارای خرید»، «کارهایی که خرید توش هست»، «کارهای خرید رو نشون بده» → search و فقط کلمه‌ی جستجو (مثلاً «خرید») در title؛ هرگز add نکن.
- «کارهای باقی‌مانده»، «لیست کارها»، «کارهای انجام‌شده» → list؛ در filter مقدار pending یا done بگذار (در غیر این صورت null).
- «کارهای خرید رو حذف کن» یعنی del یا search، نه add.
- اگر کاربر عنوان کار را گفته، کلمه «کار» را جزو title حساب نکن.
- در reply هرگز ادعا نکن کاری انجام شده؛ فقط عملیات را مشخص کن.
- اگر شماره کار مشخص است، task_id را عدد قرار بده.
- برای ویرایش، عنوان جدید را در new_title قرار بده.
- فقط JSON معتبر برگردان.

ساختار:
{
  "action": "add",
  "title": "عنوان کار",
  "task_id": null,
  "new_title": null,
  "filter": null,
  "reply": "پاسخ فارسی"
}
      `
    },
    ...history.map(item => ({
      role: item.role,
      content: item.content
    })),
    {
      role: "user",
      content: userText
    }
  ];

  let responseText = "";

  try {
    const result = await env.AI.run(MODEL, {
      messages,
      max_tokens: 400
    });

    responseText =
      typeof result === "string"
        ? result
        : String(result?.response ?? "");
  } catch (error) {
    console.error("LLM call failed:", error);

    return {
      action: "chat",
      reply: "الان نمی‌تونم پیامت رو تحلیل کنم؛ چند لحظه بعد دوباره امتحان کن."
    };
  }

  const parsed = parseModelJson(responseText);
  const valid = validateAction(parsed);

  if (valid) return valid;

  // خروجی ساخت‌یافته معتبر نبود: مسیر امن (بدون هیچ نوشتن در دیتابیس)
  const looksLikeJson = /^\s*[{\[`]/.test(responseText);

  return {
    action: "chat",
    reply:
      !looksLikeJson && responseText.trim()
        ? responseText.trim().slice(0, 1000)
        : "متوجه درخواستت نشدم. لطفاً واضح‌تر بگو."
  };
}

// استخراج اولین شیء JSON از خروجی مدل (با تحمل ```json و متن اضافه)
function parseModelJson(text) {
  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "");

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// اعتبارسنجی خروجی مدل بر اساس طرح (schema) خودمان
function validateAction(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!ALLOWED_ACTIONS.includes(raw.action)) return null;

  const text = (value, max) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

  const taskId = numberValue(raw.task_id);

  const out = {
    action: raw.action,
    title: text(raw.title, 200),
    new_title: text(raw.new_title ?? raw.newTitle, 200),
    reply: text(raw.reply, 1000),
    filter: ["pending", "done"].includes(raw.filter) ? raw.filter : null,
    task_id:
      Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null
  };

  // بررسی معنایی: عملیات روی کار باید شماره یا عنوان داشته باشد
  if (
    ["done", "undone", "del", "edit"].includes(out.action) &&
    !out.task_id &&
    !out.title
  ) {
    return null;
  }

  if (out.action === "edit" && !out.new_title) return null;

  return out;
}

// -----------------------------
// تلگرام
// -----------------------------

async function sendTelegramMessage(env, chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    }
  );

  return response.json();
}

// -----------------------------
// جستجو و نمایش کارها
// -----------------------------

// جستجوی تقریبی: فاصله، نیم‌فاصله و تفاوت‌های املایی رایج نادیده گرفته می‌شوند.
async function findTasks(db, userId, title) {
  const key = searchKey(title || "");

  if (!key) return [];

  const result = await db.prepare(`
    SELECT ${TASK_COLUMNS}
    FROM tasks t
    WHERE t.user_id = ?
    ORDER BY t.id DESC
  `).bind(String(userId)).all();

  return (result.results || [])
    .filter(task => searchKey(task.title).includes(key))
    .slice(0, 20);
}

function formatTasks(tasks) {
  if (!tasks.length) {
    return "کاری پیدا نشد.";
  }

  return tasks.map(task => {
    const status = task.completed
      ? "✅ انجام‌شده"
      : "⏳ باقی‌مانده";

    const due =
      !task.completed && task.due_at
        ? ` — ⏰ ${formatDue(task.due_at)}`
        : "";

    return `${task.id}. ${task.title} — ${status}${due}`;
  }).join("\n");
}

async function clearPending(db, userId) {
  await db.prepare(`
    DELETE FROM pending_actions
    WHERE user_id = ?
  `).bind(String(userId)).run();
}

// وقتی چند کار مشابه پیدا شد، شماره‌ی دقیق را از کاربر می‌پرسیم
async function askTaskSelection(db, userId, op, tasks, newTitle) {
  await db.prepare(`
    INSERT OR REPLACE INTO pending_actions
      (user_id, action, created_at, expires_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+5 minutes'))
  `).bind(
    String(userId),
    "select:" + JSON.stringify({
      op,
      ids: tasks.map(x => x.id),
      new_title: newTitle || null
    })
  ).run();

  const canAll = op === "done" || op === "undone";

  return (
    "چند کار مشابه پیدا کردم. لطفاً شماره دقیق را بفرست " +
    (canAll ? "(یا «همه» یا «لغو»):" : "(یا «لغو»):") +
    "\n\n" +
    formatTasks(tasks)
  );
}

// اجرای عملیات روی یک کار مشخص
async function applyTaskAction(db, userId, op, task, newTitle) {
  const uid = String(userId);

  if (op === "edit") {
    if (!newTitle) return "عنوان جدید مشخص نیست.";

    await db.prepare(`
      UPDATE tasks
      SET title = ?
      WHERE id = ? AND user_id = ?
    `).bind(newTitle, task.id, uid).run();

    return `✏️ عنوان کار شماره ${task.id} به «${newTitle}» تغییر کرد.`;
  }

  if (op === "done") {
    await db.prepare(`
      UPDATE tasks
      SET completed = 1,
          completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).bind(task.id, uid).run();

    // کار انجام شده دیگر نباید یادآوری بفرستد
    await db.prepare(`
      UPDATE reminders
      SET status = 'cancelled'
      WHERE task_id = ?
        AND user_id = ?
        AND status = 'pending'
    `).bind(task.id, uid).run();

    return `✅ کار «${task.title}» انجام‌شده ثبت شد.`;
  }

  if (op === "undone") {
    await db.prepare(`
      UPDATE tasks
      SET completed = 0,
          completed_at = NULL
      WHERE id = ? AND user_id = ?
    `).bind(task.id, uid).run();

    return `↩️ کار «${task.title}» به فهرست کارهای باقی‌مانده برگشت.`;
  }

  if (op === "settime") {
    // newTitle در این عملیات، زمان به‌صورت ISO است
    const due = new Date(newTitle);

    if (Number.isNaN(due.getTime())) return "زمان نامعتبر است.";

    await db.prepare(`
      UPDATE reminders
      SET status = 'cancelled'
      WHERE task_id = ?
        AND user_id = ?
        AND status = 'pending'
    `).bind(task.id, uid).run();

    await db.prepare(`
      INSERT INTO reminders (user_id, task_id, message, due_at)
      VALUES (?, ?, ?, ?)
    `).bind(uid, task.id, task.title, due.toISOString()).run();

    let reopened = "";

    if (task.completed) {
      await db.prepare(`
        UPDATE tasks
        SET completed = 0,
            completed_at = NULL
        WHERE id = ? AND user_id = ?
      `).bind(task.id, uid).run();

      reopened = "\n↩️ این کار به فهرست کارهای باقی‌مانده برگشت.";
    }

    return (
      `⏰ ساعت کار «${task.title}» روی ${formatDue(due.toISOString())} تنظیم شد.` +
      reopened
    );
  }

  if (op === "del") {
    await db.prepare(`
      DELETE FROM tasks
      WHERE id = ? AND user_id = ?
    `).bind(task.id, uid).run();

    await db.prepare(`
      UPDATE reminders
      SET status = 'cancelled'
      WHERE task_id = ?
        AND user_id = ?
        AND status = 'pending'
    `).bind(task.id, uid).run();

    return `🗑 کار «${task.title}» حذف شد.`;
  }

  return "عملیات نامعتبر است.";
}

// لغو یادآوری با عنوان (جستجوی تقریبی) یا زمان نسبی
async function cancelReminderByRequest(db, userId, normalizedInput) {
  const uid = String(userId);

  const pendingReminders = await db.prepare(`
    SELECT id, message, due_at
    FROM reminders
    WHERE user_id = ?
      AND status = 'pending'
  `).bind(uid).all();

  const reminders = pendingReminders.results || [];

  let candidates;

  const tm = normalizedInput.match(
    /(\d+|یک|یه|دو|سه|چهار|پنج|ده)\s*دقیقه\s*(?:دیگه|دیگ|بعد)/
  );

  if (tm) {
    const target =
      Date.now() +
      (WORD_NUMBERS[tm[1]] ?? Number(tm[1])) * 60000;

    candidates = reminders.filter(
      r => Math.abs(new Date(r.due_at).getTime() - target) < 120000
    );

    if (candidates.length > 1) {
      return "چند یادآوری در این زمان هست؛ عنوان آن را هم بگو.";
    }
  } else {
    const term = normalizedInput
      .replace(/یادم بنداز|حذف کن|پاک کن|لغو کن/g, " ")
      .split(" ")
      .filter(w => w && !["یادآوری", "رو", "را"].includes(w))
      .join(" ");

    const key = searchKey(term);

    if (!key) return "عنوان یادآوری مشخص نیست.";

    candidates = reminders.filter(
      r => searchKey(r.message).includes(key)
    );

    if (candidates.length > 1) {
      return "چند یادآوری مشابه هست؛ عنوان دقیق‌تری بگو.";
    }
  }

  if (candidates.length !== 1) {
    return "یادآوری موردنظر پیدا نشد.";
  }

  await db.prepare(`
    UPDATE reminders
    SET status = 'cancelled'
    WHERE id = ? AND user_id = ?
  `).bind(candidates[0].id, uid).run();

  return `یادآوری «${candidates[0].message}» لغو شد.`;
}

// -----------------------------
// اجرای یادآوری‌ها و پیام صبحگاهی
// -----------------------------

async function handleScheduled(controller, env) {
  const db = env.hermes_mini_db;
  const now = new Date().toISOString();

  const dueReminders = await db.prepare(`
    SELECT id, user_id, message
    FROM reminders
    WHERE status = 'pending'
      AND due_at <= ?
    ORDER BY due_at ASC
    LIMIT 50
  `).bind(now).all();

  for (const reminder of dueReminders.results || []) {
    const sent = await sendTelegramMessage(
      env,
      reminder.user_id,
      `⏰ یادآوری:\n${reminder.message}`
    );

    if (sent && sent.ok) {
      await db.prepare(`
        UPDATE reminders
        SET status = 'sent',
            sent_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(reminder.id).run();
    }
  }

  if (controller.cron !== "30 4 * * *") {
    return;
  }

  const userId = String(env.ALLOWED_TELEGRAM_USER_ID);

  const parts = tehranParts(new Date());
  const today =
    `${parts.year}-${parts.month}-${parts.day}`;

  const claimed = await db.prepare(`
    INSERT OR IGNORE INTO daily_digest_log (digest_date)
    VALUES (?)
  `).bind(today).run();

  if (!claimed.meta || claimed.meta.changes !== 1) {
    return;
  }

  const result = await db.prepare(`
    SELECT id, title, completed
    FROM tasks
    WHERE user_id = ?
      AND completed = 0
    ORDER BY id ASC
  `).bind(userId).all();

  const tasks = result.results || [];

  let message;

  if (tasks.length > 0) {
    message =
      "☀️ صبح بخیر!\n\n" +
      "کارهای باقی‌مانده:\n\n" +
      formatTasks(tasks);
  } else {
    message =
      "☀️ صبح بخیر!\n\n" +
      "امروز کاری نداری. روز خوبی داشته باشی! 🌸";
  }

  const sent = await sendTelegramMessage(env, userId, message);

  if (!sent || !sent.ok) {
    await db.prepare(`
      DELETE FROM daily_digest_log
      WHERE digest_date = ?
    `).bind(today).run();
  }
}

// -----------------------------
// Worker اصلی
// -----------------------------

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return new Response("Hermes Mini is running!");
  }

  if (
    !["/telegram", "/webhook"].includes(url.pathname) ||
    request.method !== "POST"
  ) {
    return new Response("Not Found", { status: 404 });
  }

  // بررسی امنیت Webhook
  const secret = request.headers.get(
    "X-Telegram-Bot-Api-Secret-Token"
  );

  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    secret !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let update;

  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update.message;

  if (!message || !message.text) {
    return new Response("OK");
  }

  const chatId = message.chat.id;
  const userId = message.from.id;
  const userText = message.text.trim();

  // محدودیت کاربر مجاز
  if (
    String(userId) !==
    String(env.ALLOWED_TELEGRAM_USER_ID)
  ) {
    return new Response("OK");
  }

  const db = env.hermes_mini_db;

  const normalizedInput = normalizeText(userText);

  let pendingAction = await db.prepare(`
    SELECT action, expires_at
    FROM pending_actions
    WHERE user_id = ?
  `).bind(String(userId)).first();

  // انتخاب شماره کار در صورت وجود موارد مشابه
  if (pendingAction && pendingAction.action.startsWith("select:")) {
    let pending = null;

    try {
      pending = JSON.parse(
        pendingAction.action.slice("select:".length)
      );
    } catch {
      pending = null;
    }

    const selected = normalizedInput.match(
      /^(?:کار\s*)?(?:شماره\s*)?(\d+)$/
    );

    const expired = isExpired(pendingAction.expires_at);

    if (!expired && pending && CANCEL_WORDS.includes(normalizedInput)) {
      await clearPending(db, userId);
      await sendTelegramMessage(env, chatId, "عملیات لغو شد.");
      return new Response("OK");
    }

    const selectAll =
      !expired &&
      pending &&
      ["done", "undone"].includes(pending.op) &&
      /^(?:همه|همشون|همه شون|همه اونا|هر دو|هردو)$/.test(normalizedInput);

    if (selectAll) {
      const results = [];

      for (const id of pending.ids || []) {
        const task = await db.prepare(`
          SELECT id, title
          FROM tasks
          WHERE id = ? AND user_id = ?
        `).bind(numberValue(id), String(userId)).first();

        if (task) {
          results.push(
            await applyTaskAction(db, userId, pending.op, task, "")
          );
        }
      }

      await clearPending(db, userId);

      await sendTelegramMessage(
        env,
        chatId,
        results.length
          ? results.join("\n")
          : "این کارها دیگر پیدا نشدند."
      );

      return new Response("OK");
    }

    if (!expired && pending && selected) {
      const id = numberValue(selected[1]);

      if (!id || !(pending.ids || []).includes(id)) {
        await sendTelegramMessage(
          env,
          chatId,
          "لطفاً شماره یکی از کارهای نمایش‌داده‌شده را بفرست (یا «لغو»)."
        );

        return new Response("OK");
      }

      const task = await db.prepare(`
        SELECT id, title
        FROM tasks
        WHERE id = ? AND user_id = ?
      `).bind(id, String(userId)).first();

      await clearPending(db, userId);

      if (!task) {
        await sendTelegramMessage(env, chatId, "این کار دیگر پیدا نشد.");
        return new Response("OK");
      }

      const result = await applyTaskAction(
        db,
        userId,
        pending.op,
        task,
        pending.new_title
      );

      await sendTelegramMessage(env, chatId, result);
      return new Response("OK");
    }

    // پیام جدید و نامرتبط یا منقضی‌شده: انتخاب قبلی کنار گذاشته می‌شود
    await clearPending(db, userId);
    pendingAction = null;

    if (expired && selected) {
      await sendTelegramMessage(
        env,
        chatId,
        "مهلت انتخاب تمام شد؛ دستور را دوباره بفرست."
      );

      return new Response("OK");
    }
  }

  // تأیید یا لغو حذف همه کارها
  if (pendingAction && pendingAction.action === "delete_all") {
    if (isExpired(pendingAction.expires_at)) {
      await clearPending(db, userId);

      await sendTelegramMessage(
        env,
        chatId,
        "مهلت تأیید تمام شد؛ هیچ کاری حذف نشد."
      );

      return new Response("OK");
    }

    if (["بله", "آره", "تأیید", "تایید"].includes(normalizedInput)) {
      await db.prepare(`
        UPDATE reminders
        SET status = 'cancelled'
        WHERE user_id = ?
          AND status = 'pending'
      `).bind(String(userId)).run();

      await db.prepare(`
        DELETE FROM tasks
        WHERE user_id = ?
      `).bind(String(userId)).run();

      await clearPending(db, userId);

      await sendTelegramMessage(
        env,
        chatId,
        "همه کارها حذف شدند و یادآوری‌های مربوط لغو شدند."
      );

      return new Response("OK");
    }

    if (CANCEL_WORDS.includes(normalizedInput)) {
      await clearPending(db, userId);

      await sendTelegramMessage(
        env,
        chatId,
        "عملیات لغو شد؛ هیچ کاری حذف نشد."
      );

      return new Response("OK");
    }
  }

  const directAction = detectSimpleCommand(userText);

  if (directAction?.action === "confirm_delete_all") {
    await db.prepare(`
      INSERT OR REPLACE INTO pending_actions
        (user_id, action, created_at, expires_at)
      VALUES (?, 'delete_all', CURRENT_TIMESTAMP, datetime('now', '+5 minutes'))
    `).bind(String(userId)).run();

    await sendTelegramMessage(
      env,
      chatId,
      "برای حذف همه کارها مطمئنی؟ «بله» برای تأیید و «نه» برای لغو."
    );

    return new Response("OK");
  }

  await saveHistory(db, userId, "user", userText);

  let reply = "";

  try {
    // اول یادآوری مستقل («یادم بنداز ...») را بررسی می‌کنیم
    const reminder =
      directAction?.action === "delete_reminder"
        ? null
        : parseReminderRequest(userText);

    if (reminder) {
      const reminderTask = await db.prepare(`
        INSERT INTO tasks (user_id, title)
        VALUES (?, ?)
      `).bind(
        String(userId),
        reminder.message
      ).run();

      await db.prepare(`
        INSERT INTO reminders (user_id, task_id, message, due_at)
        VALUES (?, ?, ?, ?)
      `).bind(
        String(userId),
        reminderTask.meta.last_row_id,
        reminder.message,
        reminder.dueAt.toISOString()
      ).run();

      reply =
        `⏰ یادآوری ثبت شد.\n` +
        `زمان: ${reminder.dueAt.toLocaleString("fa-IR", {
          timeZone: "Asia/Tehran"
        })}`;
    } else {
      let action = directAction;

      if (!action) {
        const history = await getHistory(db, userId);

        action = await understandMessage(env, userText, history);

        // کار جدید / انجام‌شده از روی جمله‌ی طبیعی (مثل «کتاب بخون» / «کتاب خوندم»)
        // فقط وقتی پذیرفته می‌شود که جمله پرسش، منفی یا شرطی نباشد.
        if (
          (action.action === "add" || action.action === "done") &&
          !naturalTextAllowed(userText)
        ) {
          action = {
            action: "chat",
            reply:
              "متوجه نشدم. برای ثبت کار بنویس «اضافه کن ...» یا مثلاً «نان بخر»؛ " +
              "برای انجام‌شده کردن بنویس مثلاً «نان خریدم»."
          };
        }

        // مدل زبانی هرگز نباید حذف گروهی انجام دهد؛ فقط مسیر تأییددار
        if (
          action.action === "del" &&
          !action.task_id &&
          DELETE_ALL_RE.test(
            stripTaskWord(normalizeText(action.title || ""))
          )
        ) {
          action = {
            action: "chat",
            reply:
              "برای حذف همه کارها بنویس «همه کارها رو حذف کن» تا از تو تأیید بگیرم."
          };
        }
      }

      if (action.action === "help") {
        reply = HELP_TEXT;
      }

      // لغو یادآوری
      else if (action.action === "delete_reminder") {
        reply = await cancelReminderByRequest(
          db,
          userId,
          normalizedInput
        );
      }

      // نمایش چند کار مشخص
      else if (action.action === "show_selected") {
        const found = [];

        for (const id of action.task_ids || []) {
          const task = await db.prepare(`
            SELECT id, title, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
          `).bind(
            numberValue(id),
            String(userId)
          ).first();

          if (task) found.push(task);
        }

        reply = found.length
          ? formatTasks(found)
          : "هیچ‌کدام از شماره‌های واردشده پیدا نشد.";
      }

      // نمایش همه کارها
      else if (action.action === "list") {
        const result = await db.prepare(`
          SELECT ${TASK_COLUMNS}
          FROM tasks t
          WHERE t.user_id = ?
          ORDER BY t.id ASC
        `).bind(String(userId)).all();

        reply = formatTaskReport(
          applyFilter(result.results || [], action.filter),
          { filter: action.filter }
        );
      }

      // جستجو («کارای خرید» / «کارهایی که خرید توش هست»)
      else if (action.action === "search") {
        const title = stripTaskWord(
          normalizeText(action.title || "")
        );

        const result = await db.prepare(`
          SELECT ${TASK_COLUMNS}
          FROM tasks t
          WHERE t.user_id = ?
          ORDER BY t.id ASC
        `).bind(String(userId)).all();

        const all = result.results || [];
        const hasTerm = Boolean(searchKey(title));

        reply = formatTaskReport(
          applyFilter(
            hasTerm ? searchTasksLocal(all, title) : all,
            action.filter
          ),
          { term: hasTerm ? title : "", filter: action.filter }
        );
      }

      // اضافه کردن یک یا چند کار (تا ۱۰ کار در هر پیام)
      else if (action.action === "add" || action.action === "add_many") {
        const titles =
          action.action === "add_many"
            ? action.titles
            : expandTasks(action.title);

        reply = await addTasks(db, userId, titles);
      }

      // چند کار با هم: «کار ۱ و ۲ انجام شد» / «نان و شیر انجام شد»
      else if (action.action === "multi") {
        const lines = [];

        for (const ref of (action.refs || []).slice(0, MAX_TASKS_PER_MESSAGE)) {
          let task = null;

          if (ref.task_id) {
            task = await db.prepare(`
              SELECT id, title, completed
              FROM tasks
              WHERE id = ? AND user_id = ?
            `).bind(ref.task_id, String(userId)).first();
          } else {
            const matches = preferByOp(
              await findTasks(
                db,
                userId,
                stripTaskWord(normalizeText(ref.title || ""))
              ),
              action.op
            );

            if (matches.length > 1) {
              lines.push(
                `⚠️ برای «${ref.title}» چند کار مشابه هست؛ شماره‌ی دقیقش را بنویس:\n` +
                  formatTasks(matches)
              );
              continue;
            }

            task = matches[0] || null;
          }

          if (!task) {
            lines.push(`❔ «${ref.title || ref.task_id}» پیدا نشد.`);
          } else if (action.op === "done" && task.completed) {
            lines.push(`«${task.title}» از قبل انجام‌شده بود.`);
          } else if (action.op === "undone" && !task.completed) {
            lines.push(`«${task.title}» الان هم در فهرست باقی‌مانده‌هاست.`);
          } else {
            lines.push(
              await applyTaskAction(db, userId, action.op, task, "")
            );
          }
        }

        reply = lines.join("\n") || "کار موردنظر پیدا نشد.";
      }

      // تعیین یا تغییر ساعت: «زنگ مامان رو بذار ساعت ۸ شب»
      else if (action.action === "set_time") {
        let task = null;

        if (action.task_id) {
          task = await db.prepare(`
            SELECT id, title, completed
            FROM tasks
            WHERE id = ? AND user_id = ?
          `).bind(action.task_id, String(userId)).first();

          if (!task) reply = "کار موردنظر پیدا نشد.";
        } else {
          const matches = preferByOp(
            await findTasks(
              db,
              userId,
              stripTaskWord(normalizeText(action.title || ""))
            ),
            "settime"
          );

          if (matches.length === 1) {
            task = matches[0];
          } else if (matches.length > 1) {
            reply = await askTaskSelection(
              db,
              userId,
              "settime",
              matches,
              action.dueAt
            );
          }
        }

        if (task) {
          reply = await applyTaskAction(
            db,
            userId,
            "settime",
            task,
            action.dueAt
          );
        } else if (!reply) {
          // کاری با این عنوان نبود: همان‌جا به‌عنوان کار جدید با ساعت ثبت می‌شود
          const inserted = await db.prepare(`
            INSERT INTO tasks (user_id, title)
            VALUES (?, ?)
          `).bind(String(userId), action.title).run();

          await db.prepare(`
            INSERT INTO reminders (user_id, task_id, message, due_at)
            VALUES (?, ?, ?, ?)
          `).bind(
            String(userId),
            inserted.meta.last_row_id,
            action.title,
            action.dueAt
          ).run();

          reply =
            `✅ کاری با این عنوان نداشتم؛ «${action.title}» را به‌عنوان کار جدید ثبت کردم.\n` +
            `⏰ ${formatDue(action.dueAt)}`;
        }
      }

      // فهرست روزانه: «امروز چی دارم؟» / «فردا چی دارم؟»
      else if (action.action === "day_list") {
        const result = await db.prepare(`
          SELECT ${TASK_COLUMNS}
          FROM tasks t
          WHERE t.user_id = ?
          ORDER BY t.id ASC
        `).bind(String(userId)).all();

        reply = formatDayList(result.results || [], action.day);
      }

      // شمارش: «چند تا کار مونده؟»
      else if (action.action === "count") {
        const result = await db.prepare(`
          SELECT ${TASK_COLUMNS}
          FROM tasks t
          WHERE t.user_id = ?
          ORDER BY t.id ASC
        `).bind(String(userId)).all();

        reply = formatCount(result.results || [], action.scope, action.day);
      }

      // انجام‌شدن کار با جمله‌ی طبیعی («نان خریدم» / «خرید کردم» / «بازار رفتم»)
      else if (action.action === "done_natural") {
        const result = await db.prepare(`
          SELECT id, title, completed, created_at
          FROM tasks
          WHERE user_id = ?
          ORDER BY id ASC
        `).bind(String(userId)).all();

        const rows = result.results || [];

        const { tasks: matched, ambiguous } = matchNaturalDone(
          rows.filter(t => !t.completed),
          action
        );

        if (!matched.length) {
          const already = matchNaturalDone(
            rows.filter(t => t.completed),
            action
          ).tasks;

          reply = already.length
            ? `${already.map(t => `«${t.title}»`).join("، ")} از قبل انجام‌شده بود.`
            : `«${action.label}» را بین کارهای باقی‌مانده‌ات پیدا نکردم.`;
        } else if (ambiguous) {
          reply = await askTaskSelection(db, userId, "done", matched, "");
        } else {
          const results = [];

          for (const task of matched) {
            results.push(
              await applyTaskAction(db, userId, "done", task, "")
            );
          }

          reply = results.join("\n");
        }
      }

      // برگرداندن با جمله‌ی منفی: «پرداخت نکردم» / «نان نخریدم»
      else if (action.action === "undone_natural") {
        const result = await db.prepare(`
          SELECT id, title, completed, created_at
          FROM tasks
          WHERE user_id = ?
          ORDER BY id ASC
        `).bind(String(userId)).all();

        const rows = result.results || [];

        const { tasks: matched, ambiguous } = matchNaturalDone(
          rows.filter(t => t.completed),
          action
        );

        if (!matched.length) {
          const pendingHits = matchNaturalDone(
            rows.filter(t => !t.completed),
            action
          ).tasks;

          reply = pendingHits.length
            ? `${pendingHits.map(t => `«${t.title}»`).join("، ")} الان هم در فهرست کارهای باقی‌مانده است.`
            : `«${action.label}» را بین کارهایت پیدا نکردم.`;
        } else if (ambiguous) {
          reply = await askTaskSelection(db, userId, "undone", matched, "");
        } else {
          const results = [];

          for (const task of matched) {
            results.push(
              await applyTaskAction(db, userId, "undone", task, "")
            );
          }

          reply = results.join("\n");
        }
      }

      // ویرایش، انجام‌شده، انجام‌نشده یا حذف یک کار
      else if (
        ["edit", "done", "undone", "del"].includes(action.action)
      ) {
        const op = action.action;

        const newTitle = String(
          action.new_title || action.newTitle || ""
        ).trim();

        if (op === "edit" && !newTitle) {
          reply = "عنوان جدید مشخص نیست.";
        } else {
          let task = null;
          const taskId = numberValue(action.task_id);

          if (taskId) {
            task = await db.prepare(`
              SELECT id, title, completed
              FROM tasks
              WHERE id = ? AND user_id = ?
            `).bind(taskId, String(userId)).first();
          } else if (action.title) {
            // کلمه «کار» جزو عنوان قبلی حساب نمی‌شود
            const matches = preferByOp(
              await findTasks(
                db,
                userId,
                stripTaskWord(normalizeText(action.title))
              ),
              op
            );

            if (matches.length === 1) {
              task = matches[0];
            } else if (matches.length > 1) {
              // چند کار مشابه: شماره را از کاربر می‌پرسیم
              reply = await askTaskSelection(
                db,
                userId,
                op,
                matches,
                newTitle
              );
            }
          }

          if (task && op === "done" && task.completed) {
            reply = `«${task.title}» از قبل انجام‌شده بود.`;
          } else if (task && op === "undone" && !task.completed) {
            reply = `«${task.title}» الان هم در فهرست کارهای باقی‌مانده است.`;
          } else if (task) {
            reply = await applyTaskAction(
              db,
              userId,
              op,
              task,
              newTitle
            );
          } else if (!reply) {
            reply =
              "کار موردنظر پیدا نشد. شماره یا عنوان آن را بررسی کن.";
          }
        }
      } else {
        reply = action.reply || "چطور می‌تونم کمکت کنم؟";
      }
    }
  } catch (error) {
    console.error("Message processing error:", error);

    reply =
      "متأسفانه در پردازش پیام مشکلی پیش آمد. لطفاً دوباره امتحان کن.";
  }

  await sendTelegramMessage(env, chatId, reply);
  await saveHistory(db, userId, "assistant", reply);

  return new Response("OK");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      // پاسخ 200 تا تلگرام همان پیام را دوباره نفرستد
      console.error("Unhandled error:", error);
      return new Response("OK");
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  }
};
