const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const ALLOWED_ACTIONS = [
  "add",
  "done",
  "undone",
  "del",
  "edit",
  "search",
  "list",
  "show_selected",
  "delete_reminder",
  "chat"
];

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

  const timeMatch = normalized.match(
    /ساعت\s*(\d{1,2})(?::(\d{1,2}))?/
  );

  if (!timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);

  if (hour > 23 || minute > 59) return null;

  const p = tehranParts(now);

  let year = Number(p.year);
  let month = Number(p.month);
  let day = Number(p.day);

  const tomorrow = normalized.includes("فردا");
  const today = normalized.includes("امروز");

  if (tomorrow) {
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    year = nextDay.getUTCFullYear();
    month = nextDay.getUTCMonth() + 1;
    day = nextDay.getUTCDate();
  }

  let due = tehranDateToUTC(year, month, day, hour, minute);

  if (!tomorrow && !today && due <= now) {
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
// نکته: کار جدید فقط با «اضافه کن ...» یا «ثبت کن ...» ساخته می‌شود.
// هیچ جمله‌ی دیگری (مثل «کارهای خرید رو حذف کن») به‌عنوان کار جدید ثبت نمی‌شود.

// یکسان‌سازی شکل‌های مختلف نوشتن یک دستور (فاصله، «ها»، نقطه‌های آخر جمله و ...)
function canonicalizeCommand(n) {
  return n
    .replace(/^[\s.…!؟?،,؛:\-–—]+|[\s.…!؟?،,؛:\-–—]+$/g, "")
    .replace(/^(?:لطفا|لطفاً|ببین|میشه|می شه|میتونی|می تونی)\s+/, "")
    .replace(/\s+(?:لطفا|لطفاً|ممنون|مرسی)$/, "")
    .replace(/(^|\s)کار\s+(ها|هام|هایم|های|هاش|هایی)(?=\s|$)/g, "$1کار$2")
    .replace(/(^|\s)تسک\s+(ها|های)(?=\s|$)/g, "$1کار$2")
    .replace(/(^|\s)تسک(?=\s|$)/g, "$1کار")
    .replace(/انجام\s*نشده(?:\s*ها(?:ی)?(?=\s|$))?/g, "انجام نشده")
    .replace(/انجام\s*شده(?:\s*ها(?:ی)?(?=\s|$))?/g, "انجام شده")
    .replace(/باقی\s*مانده(?:\s*ها(?:ی)?(?=\s|$))?/g, "باقی مانده")
    // «۴۳رو» = «۴۳ رو»  و  «کار۴۳» = «کار ۴۳»
    .replace(/(\d)(رو|را)(?=\s|$)/g, "$1 $2")
    .replace(/(^|\s)(کار|تسک|شماره)(\d)/g, "$1$2 $3")
    // فعل‌هایی که چسبیده یا جدا نوشته می‌شوند: «پیداکن» = «پیدا کن»
    .replace(
      /(پیدا|جستجو|سرچ|حذف|پاک|اضافه|ثبت|عوض|تغییر|ویرایش|تبدیل|لغو|نشده|شده|حذفش|پاکش)\s*(کن|بکن)(?=\s|$)/g,
      "$1 $2"
    )
    .replace(/(نشون|نشان|نمایش|برگردون|برگردان|تغییر)\s*(بده|بدی)(?=\s|$)/g, "$1 $2")
    .replace(/(انجام)\s*(شد|دادم)(?=\s|$)/g, "$1 $2")
    .replace(/(تموم|تمام)\s*(شد|شده)(?=\s|$)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSimpleCommand(text) {
  const n = canonicalizeCommand(normalizeText(text));
  let m;

  // اضافه کردن صریح کار
  m = n.match(
    /^(?:(?:یه |یک )?کار(?: جدید)?\s+)?(?:اضافه کن|اضافه بکن|ثبت کن)[\s:،-]+(.+)$/
  );

  if (m) {
    return {
      action: "add",
      title: stripTaskWord(m[1].trim())
    };
  }

  // «کار خرید نان رو اضافه کن» / «خرید نان رو ثبت کن»
  m = n.match(
    /^(.+?)(?:\s+(?:رو|را))?\s+(?:اضافه کن|اضافه بکن|ثبت کن|اضافه شه|بساز)$/
  );

  if (m) {
    return {
      action: "add",
      title: stripTaskWord(m[1].trim())
    };
  }

  // نمایش چند کار مشخص با شماره
  if (
    /(پیدا کن|جستجو کن|نمایش بده|نشون بده|نشان بده)/.test(n) &&
    /شماره/.test(n)
  ) {
    const ids = [...n.matchAll(/\d+/g)]
      .map(x => numberValue(x[0]))
      .filter(Boolean);

    if (ids.length) {
      return {
        action: "show_selected",
        task_ids: [...new Set(ids)]
      };
    }
  }

  // لغو یادآوری
  if (/(یادآوری|یادم بنداز).*(حذف کن|پاک کن|لغو کن)/.test(n)) {
    return { action: "delete_reminder", title: n };
  }

  // حذف همه کارها (با تأیید)
  if (
    /^(?:حذف همه کارها|پاک کردن همه کارها|همه کار(?:ها|ام|هام)(?: رو| را)? (?:حذف کن|پاک کن))$/.test(n)
  ) {
    return { action: "confirm_delete_all" };
  }

  // ویرایش با شماره: «کار شماره 3 رو به ... تغییر بده»
  m = n.match(
    /^(?:کار\s*)?(?:شماره\s*)?(\d+)\s*(?:رو|را)?\s*به\s+(.+?)\s+(?:تغییر بده|عوض کن|ویرایش کن|تبدیل کن)$/
  );

  if (m) {
    return {
      action: "edit",
      task_id: numberValue(m[1]),
      new_title: m[2].trim()
    };
  }

  // ویرایش با عنوان: «کار خرید نان رو به ... تغییر بده»
  m = n.match(
    /^(.+?)\s+(?:رو|را)\s+به\s+(.+?)\s+(?:تغییر بده|عوض کن|ویرایش کن|تبدیل کن)$/
  );

  if (m) {
    return {
      action: "edit",
      ...taskRef(m[1]),
      new_title: m[2].trim()
    };
  }

  // حذف با شماره یا عنوان: «کار 3 رو حذف کن» / «کارهای خرید رو حذف کن»
  m = n.match(
    /^(.+?)(?:\s+(?:رو|را))?\s+(?:حذف کن|پاک کن|حذفش کن|پاکش کن)$/
  );

  if (m) {
    return {
      action: "del",
      ...taskRef(m[1])
    };
  }

  // برگرداندن به انجام‌نشده
  m = n.match(
    /^(.+?)(?:\s+(?:رو|را))?\s+(?:(?:به\s+)?(?:(?:لیست|فهرست)\s+)?(?:انجام نشده|باقی مانده)(?:\s+(?:کن|برگردون|برگردان|برگرد|ببر|منتقل کن))?|انجام نشد|برگردون|برگردان)$/
  );

  if (m) {
    return {
      action: "undone",
      ...taskRef(m[1])
    };
  }

  // انجام‌شده
  m = n.match(
    /^(.+?)(?:\s+(?:رو|را))?\s+(?:انجام شد|انجام شده کن|انجام شده|انجام دادم|تموم شد|تمام شد|تموم شده)$/
  );

  if (m) {
    return {
      action: "done",
      ...taskRef(m[1])
    };
  }

  // فهرست
  if (
    /کارام چیه|کارهایم|فهرست کار|لیست کار|کارهای من|همه کارهام/.test(n) ||
    /^(?:همه )?کارها(?: رو| را)? (?:نشون بده|نمایش بده|نشان بده)$/.test(n)
  ) {
    return { action: "list" };
  }

  // جستجو
  m = n.match(
    /^کار(?:ها|های)?\s+(?:دارای\s+)?(.+?)\s+(?:رو\s+|را\s+)?(?:جستجو کن|پیدا کن|نشون بده|نشان بده|نمایش بده)$/
  );

  if (m) {
    return {
      action: "search",
      title: stripTaskWord(m[1])
    };
  }

  m = n.match(/^(?:جستجو کن|پیدا کن|سرچ کن)\s+(.+)$/);

  if (m) {
    return {
      action: "search",
      title: stripTaskWord(m[1])
    };
  }

  // «کارهای خرید رو پیدا کن» با هر شکل نوشتن / «خرید رو جستجو کن»
  m = n.match(/^(.+?)(?:\s+(?:رو|را))?\s+(?:جستجو کن|پیدا کن|سرچ کن)$/);

  if (m) {
    return {
      action: "search",
      title: stripTaskWord(m[1])
    };
  }

  // هر چیز دیگر → هرگز به‌عنوان کار جدید ثبت نمی‌شود
  return null;
}

// -----------------------------
// تشخیص یادآوری
// -----------------------------

// حذف زمان، کلمات اضافه و تبدیل فعل به شکل مصدر؛ مثلاً
// «یک دقیقه دیگه بگو نماز بخونم» → «نماز خواندن»
const REMINDER_TRIGGERS =
  /(?:یادم بنداز|یادم باشه|یادآوری کن|یادآوری کن|به من بگو|بهم بگو|بگو)/g;

const VERB_TO_INFINITIVE = [
  [/\s*(?:بخونم|بخوانم)$/, " خواندن"],
  [/\s*بخورم$/, " خوردن"],
  [/\s*بخرم$/, " خریدن"],
  [/\s*بزنم$/, " زدن"],
  [/\s*بگیرم$/, " گرفتن"],
  [/\s*بدم$/, " دادن"],
  [/\s*بنویسم$/, " نوشتن"],
  [/\s*بفرستم$/, " فرستادن"],
  [/\s*ببینم$/, " دیدن"],
  [/\s*بخوابم$/, " خوابیدن"],
  [/\s*بردارم$/, " برداشتن"],
  [/\s*بیارم$/, " آوردن"],
  [/\s*بسازم$/, " ساختن"],
  [/\s*بکنم$/, " کردن"],
  [/\s+کنم$/, " کردن"],
  [/\s+بکشم$/, " کشیدن"]
];

function cleanReminderTitle(normalized) {
  let t = normalized
    .replace(REMINDER_TRIGGERS, " ")
    .replace(/فردا|امروز/g, " ")
    .replace(/ساعت\s*\d{1,2}(?::\d{1,2})?/g, " ")
    .replace(
      /(?:\d+|یک|یه|دو|سه|چهار|پنج|ده|نیم)\s*(?:دقیقه|ساعت)\s*(?:دیگه|دیگ|بعد)/g,
      " "
    )
    .replace(/لطفا|لطفاً/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:که|تا|باید)\s+/, "")
    .replace(/\s+(?:که|رو|را)$/, "")
    .trim();

  for (const [pattern, replacement] of VERB_TO_INFINITIVE) {
    if (pattern.test(t) && t.replace(pattern, "").trim()) {
      t = t.replace(pattern, replacement).trim();
      break;
    }
  }

  return t;
}

function hasReminderTrigger(normalized) {
  return (
    normalized.includes("یادم بنداز") ||
    normalized.includes("یادآوری کن") ||
    /(?:^|\s)(?:به من بگو|بهم بگو|بگو)(?:\s|$)/.test(normalized)
  );
}

function parseReminderRequest(text) {
  const normalized = normalizeText(text);

  if (!hasReminderTrigger(normalized)) {
    return null;
  }

  const dueAt = parseReminderTime(normalized);

  if (!dueAt) return null;

  const message = cleanReminderTitle(normalized) || "یادآوری";

  return { message, dueAt };
}

// -----------------------------
// تشخیص کار زمان‌دار
// -----------------------------

function parseTimedTask(text) {
  const normalized = normalizeText(text);

  if (hasReminderTrigger(normalized)) {
    return null;
  }

  const dueAt = parseReminderTime(normalized);

  if (!dueAt) return null;

  const title = cleanReminderTitle(normalized);

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
- فقط در صورت درخواست صریح کاربر add بده.
- برای ویرایش، عنوان جدید را در new_title قرار بده.
- اگر شماره کار مشخص است، task_id را عدد قرار بده.
- فقط JSON معتبر برگردان.
- هیچ شماره یا عنوانی اختراع نکن.

ساختار:
{
  "action": "chat",
  "title": "",
  "task_id": null,
  "new_title": "",
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

  try {
    const result = await env.AI.run(MODEL, {
      messages,
      max_tokens: 400
    });

    let responseText =
      typeof result === "string"
        ? result
        : result?.response;

    if (typeof responseText !== "string") {
      throw new Error("Invalid AI response");
    }

    const cleaned = responseText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    const allowedActions = [
      "add", "done", "undone", "del",
      "edit", "search", "list", "chat"
    ];

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !allowedActions.includes(parsed.action) ||
      typeof parsed.title !== "string" ||
      typeof parsed.reply !== "string"
    ) {
      throw new Error("Invalid AI JSON fields");
    }

    if (
      parsed.new_title !== null &&
      parsed.new_title !== undefined &&
      typeof parsed.new_title !== "string"
    ) {
      throw new Error("Invalid new_title");
    }

    if (
      parsed.task_id !== null &&
      parsed.task_id !== undefined &&
      (!Number.isInteger(Number(parsed.task_id)) ||
       Number(parsed.task_id) <= 0)
    ) {
      throw new Error("Invalid task_id");
    }

    parsed.task_id =
      parsed.task_id == null ? null : Number(parsed.task_id);

    parsed.new_title = parsed.new_title || "";

    if (
  ["add", "search"].includes(parsed.action) &&
  !parsed.title.trim()
) {
  throw new Error("Missing task title");
}

if (
  ["del", "edit"].includes(parsed.action) &&
  !parsed.task_id &&
  !parsed.title.trim()
) {
  throw new Error("Missing task identifier");
}سس

    if (
      parsed.action === "edit" &&
      !parsed.new_title.trim()
    ) {
      throw new Error("Missing new title");
    }

    if (
      ["done", "undone"].includes(parsed.action) &&
      !parsed.task_id &&
      !parsed.title.trim()
    ) {
      throw new Error("Missing task identifier");
    }

    return parsed;

  } catch (error) {
    console.error("AI validation error:", error);

    return {
      action: "chat",
      title: "",
      task_id: null,
      new_title: "",
      reply: "متوجه درخواستت نشدم. لطفاً درخواستت رو واضح‌تر بیان کن."
    };
  }
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
    SELECT id, title, completed, created_at
    FROM tasks
    WHERE user_id = ?
    ORDER BY id DESC
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

    return `${task.id}. ${task.title} — ${status}`;
  }).join("\n");
}

async function clearPending(db, userId) {
  await db.prepare(`
    DELETE FROM pending_actions
    WHERE user_id = ?
  `).bind(String(userId)).run();
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

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS daily_digest_log (
      digest_date TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

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

export default {
  async fetch(request, env, ctx) {
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
      return new Response("Unauthorized", { status: 403 });
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

    await db.prepare(`
  CREATE TABLE IF NOT EXISTS pending_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`).run();

    if (userText === "/start") {
      await sendTelegramMessage(
        env,
        chatId,
        `سلام! من هرمس هستم. 🤖

می‌تونم این کارها رو انجام بدم:

• اضافه کردن کار (فقط با «اضافه کن ...» یا «ثبت کن ...»)
• نمایش فهرست کارها
• جستجوی کارها
• انجام‌شده کردن کار
• برگرداندن کار به انجام‌نشده
• حذف یک کار
• ویرایش کار با عنوان یا شماره
• نمایش چند کار مشخص با شماره

نمونه‌ها:
اضافه کن خرید نان
ثبت کن فردا ساعت ۹ درس بخون
کار شماره ۱ رو به خرید کتاب تغییر بده
کار شماره ۱ و ۲ رو نشون بده
خرید نان انجام شد
کارهای خرید رو جستجو کن
کارهای خرید رو حذف کن

اگر چند کار مشابه باشه، شماره‌ی دقیق رو ازت می‌پرسم.

یادآوری:
یک دقیقه دیگه یادم بنداز قرصمو بخورم
فردا ساعت ۹ یادم بنداز درس بخونم

هر روز ساعت ۸ صبح هم کارهای باقی‌مانده رو برات می‌فرستم.`
      );

      return new Response("OK");
    }

    const normalizedInput = normalizeText(userText);
    const greetingText = normalizedInput
  .replace(/[!؟?.,،؛:]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

if (
  /^(سلام|درود|hi|hello|hey)(?:\s+(?:مهندس|استاد|دکتر|آقا|خانم|عزیز))?$/i.test(greetingText)
) {
  await sendTelegramMessage(
    env,
    chatId,
    "سلام! 👋 کاری هست که به لیست کارهات اضافه کنم؟"
  );

  return new Response("OK");
}

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
  DELETE FROM pending_actions
  WHERE user_id = ?
`).bind(String(userId)).run();

await db.prepare(`
  INSERT INTO pending_actions
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

          // هوش مصنوعی اجازه ندارد کار جدید بسازد؛
          // فقط «اضافه کن ...» یا «ثبت کن ...» صریح کاربر معتبر است.
          if (action.action === "add") {
            action = {
              action: "chat",
              reply:
                "برای ثبت کار جدید، صریح بنویس: «اضافه کن ...» یا «ثبت کن ...»."
            };
          }
        }

        // لغو یادآوری
        if (action.action === "delete_reminder") {
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
            SELECT id, title, completed, created_at
            FROM tasks
            WHERE user_id = ?
            ORDER BY id ASC
          `).bind(String(userId)).all();

          reply = formatTasks(result.results || []);
        }

        // جستجو
        else if (action.action === "search") {
          const title = stripTaskWord(
            normalizeText(action.title || "")
          );

          if (!searchKey(title)) {
            const result = await db.prepare(`
              SELECT id, title, completed, created_at
              FROM tasks
              WHERE user_id = ?
              ORDER BY id ASC
            `).bind(String(userId)).all();

            reply = formatTasks(result.results || []);
          } else {
            reply = formatTasks(
              await findTasks(db, userId, title)
            );
          }
        }

        // اضافه کردن کار (فقط با دستور صریح «اضافه کن» / «ثبت کن»)
        else if (action.action === "add") {
          const title = String(action.title || "").trim();

          if (!title) {
            reply = "عنوان کار مشخص نیست. لطفاً دوباره بنویس.";
          } else {
            const timedTask = parseTimedTask(title);

            if (timedTask) {
              const inserted = await db.prepare(`
                INSERT INTO tasks (user_id, title)
                VALUES (?, ?)
              `).bind(
                String(userId),
                timedTask.title
              ).run();

              await db.prepare(`
                INSERT INTO reminders (user_id, task_id, message, due_at)
                VALUES (?, ?, ?, ?)
              `).bind(
                String(userId),
                inserted.meta.last_row_id,
                timedTask.title,
                timedTask.dueAt.toISOString()
              ).run();

              reply =
                `✅ کار «${timedTask.title}» اضافه شد.\n` +
                `⏰ یادآوری آن برای ${timedTask.dueAt.toLocaleString("fa-IR", {
                  timeZone: "Asia/Tehran"
                })} تنظیم شد.`;
            } else {
              await db.prepare(`
                INSERT INTO tasks (user_id, title)
                VALUES (?, ?)
              `).bind(
                String(userId),
                title
              ).run();

              reply = `✅ کار «${title}» اضافه شد.`;
            }
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
              const matches = await findTasks(
                db,
                userId,
                stripTaskWord(normalizeText(action.title))
              );

              if (matches.length === 1) {
                task = matches[0];
              } else if (matches.length > 1) {
                // چند کار مشابه: شماره را از کاربر می‌پرسیم
                await db.prepare(`
  DELETE FROM pending_actions
  WHERE user_id = ?
`).bind(String(userId)).run();

await db.prepare(`
  INSERT INTO pending_actions
    (user_id, action, created_at, expires_at)
  VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+5 minutes'))
`).bind(
  String(userId),
  "select:" + JSON.stringify({
    op,
    ids: matches.map(x => x.id),
    new_title: newTitle || null
  })
).run();

                reply =
                  "چند کار مشابه پیدا کردم. لطفاً شماره دقیق را بفرست " +
                  "(یا «لغو»):\n\n" +
                  formatTasks(matches);
              }
            }

            if (task) {
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
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  }
};
