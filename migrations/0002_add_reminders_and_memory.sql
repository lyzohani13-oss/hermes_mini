-- Migration number: 0002

-- جدول یادآوری‌ها
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    task_id INTEGER,
    message TEXT NOT NULL,
    due_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
ON reminders(status, due_at);

CREATE INDEX IF NOT EXISTS idx_reminders_user
ON reminders(user_id);

-- جدول تاریخچه مکالمات
CREATE TABLE IF NOT EXISTS conversation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_user
ON conversation_history(user_id, id);

-- تنظیمات کاربر
CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    daily_summary_enabled INTEGER NOT NULL DEFAULT 1,
    timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- عملیات در انتظار تأیید
CREATE TABLE IF NOT EXISTS pending_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_user
ON pending_actions(user_id);