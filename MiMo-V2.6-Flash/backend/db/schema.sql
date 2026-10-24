-- NoldOJ database schema (SQLite / node:sqlite)
-- Applied idempotently by backend/db/database.js

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ========== Users & Auth ==========

CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  email               TEXT,
  role                TEXT NOT NULL DEFAULT 'user'
                        CHECK (role IN ('user','teacher','admin','super')),
  banned              INTEGER NOT NULL DEFAULT 0,
  ban_reason          TEXT,
  rating              INTEGER NOT NULL DEFAULT 0,
  preferred_language  TEXT,
  signature           TEXT DEFAULT '',
  bio                 TEXT DEFAULT '',
  avatar              TEXT,
  single_file_limit_mb   INTEGER,
  storage_quota_mb       INTEGER,
  force_logout_at    INTEGER NOT NULL DEFAULT 0,
  registration_ip     TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

-- ID recycling: freed user ids are returned here and reused on insert
CREATE TABLE IF NOT EXISTS user_id_pool (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  user_agent  TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS captchas (
  id          TEXT PRIMARY KEY,
  answer      TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- ========== Groups & Visibility ==========

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- visibility binding for problems/contests/exams/problem_sets:
-- NULL group_id = public; otherwise visible only to that group (+ admins)
CREATE TABLE IF NOT EXISTS visibility_bindings (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('problem','contest','exam','problem_set')),
  entity_id   INTEGER NOT NULL,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_type, entity_id)
);

-- ========== Languages ==========

CREATE TABLE IF NOT EXISTS languages (
  id             TEXT PRIMARY KEY,           -- e.g. 'cpp', 'python3'
  name           TEXT NOT NULL,
  version        TEXT DEFAULT '',
  compile_cmd    TEXT DEFAULT '',            -- placeholders: {src} {bin} {dir}
  run_cmd        TEXT NOT NULL,              -- placeholders: {src} {bin} {dir}
  source_ext     TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  is_compiled    INTEGER NOT NULL DEFAULT 0,
  time_factor   REAL NOT NULL DEFAULT 1.0,
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- ========== Problems ==========

CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6c8ebf'
);

CREATE TABLE IF NOT EXISTS problems (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  author            TEXT DEFAULT '',
  description       TEXT DEFAULT '',
  input_format      TEXT DEFAULT '',
  output_format     TEXT DEFAULT '',
  samples           TEXT DEFAULT '[]',       -- JSON array of {input, output}
  hint              TEXT DEFAULT '',
  difficulty        TEXT NOT NULL DEFAULT 'entry'
                      CHECK (difficulty IN ('entry','basic','medium','hard','advanced','expert')),
  category          TEXT DEFAULT '',
  time_limit_ms     INTEGER NOT NULL DEFAULT 2000,
  memory_limit_mb   INTEGER NOT NULL DEFAULT 256,
  output_limit_kb   INTEGER NOT NULL DEFAULT 65536,
  stack_limit_mb    INTEGER NOT NULL DEFAULT 64,
  is_public         INTEGER NOT NULL DEFAULT 1,
  scoring_script    TEXT DEFAULT '',          -- problem-level custom score script
  accept_count      INTEGER NOT NULL DEFAULT 0,
  submit_count      INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_problems_public ON problems(is_public);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);

CREATE TABLE IF NOT EXISTS test_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id     INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT '',
  full_score     REAL NOT NULL DEFAULT 100,
  aggregation    TEXT NOT NULL DEFAULT 'sum'
                   CHECK (aggregation IN ('sum','min','max','avg','count_pass')),
  depends_on     TEXT DEFAULT '[]',          -- JSON array of group ids
  scoring_script TEXT DEFAULT '',
  order_index    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_test_groups_problem ON test_groups(problem_id);

CREATE TABLE IF NOT EXISTS test_cases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES test_groups(id) ON DELETE SET NULL,
  case_index  INTEGER NOT NULL DEFAULT 0,
  input_path  TEXT NOT NULL,
  output_path TEXT NOT NULL,
  score       REAL NOT NULL DEFAULT 0,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_test_cases_problem ON test_cases(problem_id);

CREATE TABLE IF NOT EXISTS problem_id_pool (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);

-- ========== Submissions ==========

CREATE TABLE IF NOT EXISTS submissions (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id      INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  contest_id      INTEGER,
  virtual         INTEGER NOT NULL DEFAULT 0,
  language        TEXT NOT NULL,
  code            TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','ai_reviewing','queued','compiling','judging','accepted',
                                      'wrong_answer','time_limit','memory_limit','runtime_error',
                                      'compile_error','output_limit','internal_error','system_error')),
  score           REAL NOT NULL DEFAULT 0,
  time_ms         INTEGER,
  memory_kb       INTEGER,
  compile_output  TEXT DEFAULT '',
  detail          TEXT DEFAULT '{}',         -- JSON per-testcase detail
  rated           INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  judged_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_sub_contest ON submissions(contest_id);

CREATE TABLE IF NOT EXISTS submission_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  content       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_id_pool (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS ide_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  code        TEXT NOT NULL,
  stdin       TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  exit_code   INTEGER,
  stdout      TEXT DEFAULT '',
  stderr      TEXT DEFAULT '',
  time_ms     INTEGER,
  memory_kb   INTEGER,
  created_at  INTEGER NOT NULL
);

-- ========== Contests ==========

CREATE TABLE IF NOT EXISTS contests (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT DEFAULT '',
  start_at          INTEGER NOT NULL,
  end_at            INTEGER NOT NULL,
  rating_enabled    INTEGER NOT NULL DEFAULT 1,
  freeze_minutes    INTEGER NOT NULL DEFAULT 0,
  frozen            INTEGER NOT NULL DEFAULT 0,
  solutions_auto    INTEGER NOT NULL DEFAULT 1,
  solutions_published INTEGER NOT NULL DEFAULT 0,
  is_public         INTEGER NOT NULL DEFAULT 1,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  alias       TEXT DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, problem_id)
);

CREATE TABLE IF NOT EXISTS contest_invites (
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS contest_participants (
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   INTEGER NOT NULL,
  PRIMARY KEY (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS virtual_instances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (contest_id, user_id)
);

-- ========== Articles / Announcements ==========

CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  problem_id    INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  is_solution   INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 1,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name   TEXT DEFAULT '',
  view_count    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_id_pool (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  contest_id  INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ========== File Hosting ==========

CREATE TABLE IF NOT EXISTS hosted_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime        TEXT DEFAULT '',
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hosted_user ON hosted_files(user_id);

-- ========== Problem Sets ==========

CREATE TABLE IF NOT EXISTS problem_sets (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_public   INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS problem_set_items (
  set_id      INTEGER NOT NULL REFERENCES problem_sets(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, problem_id)
);

CREATE TABLE IF NOT EXISTS problem_set_progress (
  set_id      INTEGER NOT NULL REFERENCES problem_sets(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  solved      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (set_id, user_id, problem_id)
);

-- ========== Discussions ==========

CREATE TABLE IF NOT EXISTS discussions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES discussions(id) ON DELETE CASCADE,
  title       TEXT DEFAULT '',
  content     TEXT NOT NULL,
  is_official INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  locked      INTEGER NOT NULL DEFAULT 0,
  blessed     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disc_problem ON discussions(problem_id);

-- ========== Exams ==========

CREATE TABLE IF NOT EXISTS exams (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  duration_min  INTEGER NOT NULL DEFAULT 60,
  pass_score    REAL NOT NULL DEFAULT 60,
  max_attempts  INTEGER NOT NULL DEFAULT 1,
  total_score   REAL NOT NULL DEFAULT 100,
  start_at      INTEGER,
  end_at        INTEGER,
  is_public     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id       INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                  CHECK (type IN ('choice','truefalse','fill','essay')),
  content       TEXT NOT NULL,
  options       TEXT DEFAULT '[]',            -- JSON [{key,text}]
  answer        TEXT DEFAULT '',              -- objective answer / reference
  score         REAL NOT NULL DEFAULT 5,
  order_index   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  submitted_at INTEGER,
  score       REAL,
  status      TEXT NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','submitted','graded')),
  grader_id   INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id   INTEGER NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  answer       TEXT DEFAULT '',
  score        REAL,
  graded_by_ai INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attempt_id, question_id)
);

-- ========== Achievements / Rating ==========

CREATE TABLE IF NOT EXISTS achievements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT DEFAULT 'trophy'
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS privacy_settings (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hide_achievements  INTEGER NOT NULL DEFAULT 0,
  hide_dashboard     INTEGER NOT NULL DEFAULT 0,
  hide_favorites     INTEGER NOT NULL DEFAULT 0
);

-- ========== Plagiarism ==========

CREATE TABLE IF NOT EXISTS plagiarism_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER,
  contest_id  INTEGER,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','failed')),
  progress    TEXT NOT NULL DEFAULT '{}',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS plagiarism_pairs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES plagiarism_jobs(id) ON DELETE CASCADE,
  submission_a INTEGER NOT NULL,
  submission_b INTEGER NOT NULL,
  similarity   REAL NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('high','suspect'))
);

CREATE TABLE IF NOT EXISTS plagiarism_tokens (
  submission_id INTEGER PRIMARY KEY,
  tokens        TEXT NOT NULL
);

-- ========== AI Review Log ==========

CREATE TABLE IF NOT EXISTS ai_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  passed        INTEGER NOT NULL,
  risk_score    REAL DEFAULT 0,
  findings      TEXT DEFAULT '[]',
  raw           TEXT DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_hints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  hint       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_hint_cooldown ON ai_hints(user_id, problem_id, created_at);

-- ========== Audit / Ops ==========

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT DEFAULT '',
  ip         TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ========== Seed: system groups, default tags, achievements ==========

INSERT OR IGNORE INTO groups (id, name, description, is_system, created_at)
  VALUES (1, '全体用户', '系统组：注册用户自动加入', 1, 0);
INSERT OR IGNORE INTO groups (id, name, description, is_system, created_at)
  VALUES (2, '全体师生', '系统组：教师及以上自动加入', 1, 0);

INSERT OR IGNORE INTO tags (name, color) VALUES
  ('模拟', '#8e9aaf'), ('贪心', '#e07a5f'), ('动态规划', '#3d5a80'),
  ('图论', '#81b29a'), ('数论', '#f2cc8f'), ('字符串', '#c9ada7'),
  ('二分', '#9a8c98'), ('搜索', '#4a4e69'), ('数据结构', '#22223b'),
  ('数学', '#ffb4a2'), ('排序', '#b8c0ff'), ('暴力', '#ffd6ba'),
  ('构造', '#a8dadc'), ('前缀和', '#457b9d'), ('双指针', '#e63946'),
  ('栈', '#06d6a0'), ('队列', '#118ab2'), ('树', '#073b4c'),
  ('最短路', '#7209b7'), ('网络流', '#f72585'), ('计算几何', '#4cc9f0'),
  ('位运算', '#80ed99'), ('哈希', '#ffb703'), ('递归', '#fb8500');

INSERT OR IGNORE INTO achievements (code, name, description, icon) VALUES
  ('first_blood', '一血', '首个通过某道题目', 'drop'),
  ('streak_5', '五连击', '连续通过 5 道题', 'fire'),
  ('streak_10', '十连击', '连续通过 10 道题', 'bolt'),
  ('ac_10', '初出茅庐', '通过 10 道题', 'seedling'),
  ('ac_50', '身经百战', '通过 50 道题', 'medal'),
  ('ac_100', '百题斩', '通过 100 道题', 'crown'),
  ('night_owl', '夜猫子', '在凌晨 2-4 点通过题目', 'moon'),
  ('collector', '收藏达人', '收藏 20 道题目', 'star');
