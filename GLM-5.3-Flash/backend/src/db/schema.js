// NoldOJ full database schema (SQLite).
// Plain INTEGER PRIMARY KEY where ID recycling is required.
module.exports = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',             -- user / teacher / admin / super
  rating INTEGER NOT NULL DEFAULT 1500,
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT DEFAULT '',
  force_logout_at INTEGER NOT NULL DEFAULT 0,    -- timestamp; access tokens issued before expire
  signature TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  preferred_lang TEXT DEFAULT '',
  privacy_achievements INTEGER NOT NULL DEFAULT 0,
  privacy_dashboard INTEGER NOT NULL DEFAULT 0,
  privacy_favorites INTEGER NOT NULL DEFAULT 0,
  quota_gb REAL NOT NULL DEFAULT 2,
  max_file_mb REAL NOT NULL DEFAULT 10,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description_md TEXT DEFAULT '',
  input_md TEXT DEFAULT '',
  output_md TEXT DEFAULT '',
  hint_md TEXT DEFAULT '',
  author_id INTEGER,
  is_public INTEGER NOT NULL DEFAULT 1,
  difficulty INTEGER NOT NULL DEFAULT 0,        -- 0 Entry .. 5 Expert
  compare_mode TEXT NOT NULL DEFAULT 'loose',   -- strict / loose / float / spj
  float_tolerance REAL NOT NULL DEFAULT 0.000001,
  time_limit_ms INTEGER NOT NULL DEFAULT 1000,
  memory_limit_mb INTEGER NOT NULL DEFAULT 256,
  judge_mode TEXT NOT NULL DEFAULT 'default',   -- default(score per testcase/group) / custom(score_script)
  score_script TEXT DEFAULT '',
  accepted_count INTEGER NOT NULL DEFAULT 0,
  submit_count INTEGER NOT NULL DEFAULT 0,
  copy_md TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#5b9bff'
);
CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (problem_id, tag_id)
);
CREATE TABLE IF NOT EXISTS problem_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  input TEXT DEFAULT '',
  output TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS testcase_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 10,
  agg TEXT NOT NULL DEFAULT 'min',              -- sum / min / max
  depends TEXT DEFAULT '[]',                    -- JSON array of group ids
  score_script TEXT DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS testcases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  group_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  input_path TEXT NOT NULL,
  output_path TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 10,
  time_limit_ms INTEGER,
  memory_limit_mb INTEGER,
  float_tolerance REAL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS languages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  compile_cmd TEXT DEFAULT '',
  run_cmd TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  contest_id INTEGER,
  virtual_id INTEGER,
  language_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  code_files TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL NOT NULL DEFAULT 0,
  case_total INTEGER NOT NULL DEFAULT 0,
  case_passed INTEGER NOT NULL DEFAULT 0,
  time_ms INTEGER NOT NULL DEFAULT 0,
  memory_kb INTEGER NOT NULL DEFAULT 0,
  error_msg TEXT DEFAULT '',
  compile_output TEXT DEFAULT '',
  is_ide INTEGER NOT NULL DEFAULT 0,
  judged_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submission_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  testcase_id INTEGER,
  group_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL NOT NULL DEFAULT 0,
  time_ms INTEGER NOT NULL DEFAULT 0,
  memory_kb INTEGER NOT NULL DEFAULT 0,
  msg TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS submission_locks (
  user_id INTEGER PRIMARY KEY,
  locked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contests (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description_md TEXT DEFAULT '',
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  freeze_minutes INTEGER NOT NULL DEFAULT 0,
  solution_article_id INTEGER,
  solution_published INTEGER NOT NULL DEFAULT 0,
  scoreboard_public INTEGER NOT NULL DEFAULT 1,
  is_exam_like INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  alias TEXT DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, problem_id)
);
CREATE TABLE IF NOT EXISTS contest_participants (
  contest_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (contest_id, user_id)
);
CREATE TABLE IF NOT EXISTS contest_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  invited_by INTEGER,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS virtual_participations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  UNIQUE (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content_md TEXT DEFAULT '',
  author_id INTEGER,
  published INTEGER NOT NULL DEFAULT 0,
  is_solution INTEGER NOT NULL DEFAULT 0,
  problem_id INTEGER,
  contest_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content_md TEXT DEFAULT '',
  contest_id INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mime TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discussions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  official INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS discussion_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL,
  parent_id INTEGER,
  user_id INTEGER NOT NULL,
  content_md TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, problem_id)
);
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  UNIQUE (user_id, code)
);
CREATE TABLE IF NOT EXISTS rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  submission_id INTEGER,
  delta REAL NOT NULL,
  before REAL NOT NULL,
  after REAL NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS group_visibility (
  group_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,   -- problem / contest / exam / problemset
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (group_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS problem_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description_md TEXT DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS problem_set_items (
  set_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, problem_id)
);
CREATE TABLE IF NOT EXISTS problem_set_progress (
  set_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  problem_id INTEGER NOT NULL,
  solved_at INTEGER NOT NULL,
  PRIMARY KEY (set_id, user_id, problem_id)
);

CREATE TABLE IF NOT EXISTS plagiarism_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  contest_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plagiarism_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  user_id_a INTEGER NOT NULL,
  user_id_b INTEGER NOT NULL,
  submission_id_a INTEGER NOT NULL,
  submission_id_b INTEGER NOT NULL,
  similarity REAL NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'suspect'   -- suspect (>=70) / high (>=85)
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description_md TEXT DEFAULT '',
  start_at INTEGER,
  end_at INTEGER,
  time_limit_min INTEGER NOT NULL DEFAULT 60,
  pass_score REAL NOT NULL DEFAULT 60,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exam_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,             -- choice / judge / blank / essay
  content_md TEXT DEFAULT '',
  options_json TEXT DEFAULT '[]',
  answer TEXT DEFAULT '',
  score REAL NOT NULL DEFAULT 10,
  objective INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exam_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  answers_json TEXT DEFAULT '{}',
  score REAL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / graded
  started_at INTEGER NOT NULL,
  submitted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_cases_sub ON submission_cases(submission_id);
`;
