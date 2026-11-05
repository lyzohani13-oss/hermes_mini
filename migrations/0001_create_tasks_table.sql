-- Migration number: 0001 	 2026-10-28T12:30:31.595Z
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id
ON tasks(user_id);