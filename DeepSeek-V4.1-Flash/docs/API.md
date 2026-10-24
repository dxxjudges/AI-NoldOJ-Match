# NoldOJ API

Base URL: `http://<host>:<port>`. All endpoints live under `/api`.

## Conventions

- Success: `{ "ok": true, "data": <any> }`
- Error: `{ "ok": false, "code": "<CODE>", "message": "<中文>", "detail"?: <any> }`
- Auth: send `Authorization: Bearer <accessToken>`. The refresh token is an
  httpOnly cookie (`noldoj_refresh`, `Path=/api/auth`).
- Roles (ascending): `user` < `teacher` < `admin` < `su`.
- Pagination query params: `page` (>=1), `pageSize` (1..100, default 20).
  Paginated responses: `{ "total", "page", "pageSize", "items": [...] }`.
- Request bodies are JSON (or `multipart/form-data` for uploads). Max body 20 MB.

### Error codes

`BAD_REQUEST` (400), `BAD_JSON` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `CONFLICT` (409),
`PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429), `INTERNAL` (500).

### Submission status values

`pending`, `reviewing`, `queued`, `compiling`, `running`, `accepted`,
`wrong_answer`, `time_limit`, `memory_limit`, `runtime_error`, `compile_error`,
`system_error`, `banned`.

### IDE run status values

`pending`, `reviewing`, `compiling`, `running`, `done`, `compile_error`,
`runtime_error`, `time_limit`, `memory_limit`, `system_error`.

### Exam submission status values

`in_progress`, `submitted`, `graded`.

## Endpoints

### System

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | – | `{ status, time }` |

### Auth `/api/auth`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/captcha` | – | `{ id, svg, enabled }` |
| POST | `/register` | – | body `{ username, password, captchaId?, captcha? }` |
| POST | `/login` | – | body `{ username, password, captchaId?, captcha?, force? }` → `{ accessToken, user }` |
| POST | `/refresh` | cookie | → `{ accessToken, user }` |
| POST | `/logout` | – | clears refresh cookie |
| GET | `/me` | login | current user |
| GET | `/config` | – | `{ captchaEnabled, allowRegistration, ai }` |
| POST | `/heartbeat` | optional | broadcasts online presence |

### Users `/api/users`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | admin | query `search`, `role`, paged |
| GET | `/leaderboard` | – | query `limit` (<=100) |
| GET | `/:id` | – | `:id` is an id **or** username; adds `stats`, `achievementCount` |
| POST | `/` | su | body `{ username, password?, role? }` → returns plaintext password |
| PUT | `/:id` | self/admin | `signature`, `bio`, `preferred_language`, `privacy`, `role`/`rating` (su) |
| DELETE | `/:id` | admin | |
| POST | `/:id/role` | su | `{ role }` |
| POST | `/:id/password` | su | `{ password? }` → `{ password }` |
| POST | `/:id/ban` · `/:id/unban` · `/:id/force-logout` | admin | |
| POST | `/:id/login-as` | su | impersonate → `{ accessToken, user }` |
| POST | `/:id/quota` | su | `{ quota_bytes }` |
| GET | `/:id/achievements` | – | `{ unlocked, catalog }` |
| GET | `/:id/dashboard` | – | `{ calendar, languages, difficulty }` |
| GET | `/:id/favorites` | – | list |
| POST | `/import` | su | `{ users: string[]\|{username}[], defaultPassword? }` |
| POST | `/:id/favorites/:problemId` | self | toggle on |
| POST/DELETE | `/:id/favorites/:problemId/remove` | self | toggle off |
| GET | `/:id/email-config` | su | |

### Problems `/api/problems`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | query `search`, `tag`, `difficulty`, `category`, paged |
| POST | `/` | teacher | create; `data` = problem with tags |
| GET | `/:id` | – | adds `groups`, `testcaseCount`, `favorited`, `myStatus` |
| PUT | `/:id` | author/teacher | |
| DELETE | `/:id` | author/teacher | |
| GET | `/:id/testcases` | owner/teacher | |
| POST | `/:id/testcases` | owner/teacher | |
| POST | `/:id/testcases/batch` | owner/teacher | `{ cases: [...] }` |
| PUT/DELETE | `/api/testcases/:id` | owner/teacher | |
| POST | `/:id/groups` · PUT/DELETE | `/api/problem-groups/:id` | owner/teacher | subtasks |
| POST | `/:id/generate-testdata` | teacher | AI generated, `{ normalCount, edgeCount }` |
| POST | `/:id/visibility` | teacher | `{ groupIds: [] }` |
| POST | `/:id/solutions` | teacher | create linked article |

### Submissions `/api/submissions`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | query `user`, `problem`, `status`, `contest`, paged |
| POST | `/` | login | `{ problem_id, language_id \| language, source_code?, files?, contest_id? }` → `{ id, status }` |
| GET | `/:id` | – | includes `source_code`, `compile_output`, `detail` |
| GET | `/:id/cases` | – | per-case results |
| POST | `/:id/rejudge` | teacher | |
| DELETE | `/:id` | admin | |
| GET | `/:a/diff/:b` | owner/teacher | `{ left, right, rows }` |

### IDE `/api/ide`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/run` | login | `{ language_id \| language, source_code, stdin?, time_limit_ms?, memory_limit_kb? }` |
| GET | `/run/:id` | login | `{ status, stdout, stderr, exit_code, time_ms, memory_kb }` |

### Contests `/api/contests`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | paged, `search` |
| POST | `/` | teacher | |
| GET | `/:id` | – | adds `problems`, `joined`, `virtual`, `announcements` |
| PUT/DELETE | `/:id` | creator/admin | |
| POST | `/:id/problems` · DELETE `/:id/problems/:problemId` | teacher | |
| POST | `/:id/participants` · DELETE `/:id/participants/:userId` | teacher | |
| GET | `/:id/leaderboard` | – | `{ frozen, hidden, problems, entries }` |
| POST | `/:id/unfreeze` | admin | |
| POST | `/:id/virtual` | login | start virtual participation |
| POST | `/api/virtual/:id/start` | owner | |
| GET | `/api/virtual/:id/leaderboard` | owner/admin | |

### Articles `/api/articles`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | paged, `search`, `problem` |
| POST | `/` | teacher | |
| GET | `/:id` | – | |
| PUT/DELETE | `/:id` | author/admin | |

### Announcements `/api/announcements`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | query `contest`, `global`; returns array |
| GET | `/:id` | – | |
| POST | `/` | teacher | |
| PUT/DELETE | `/:id` | author/admin | |

### Problemsets `/api/problemsets`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | paged |
| POST | `/` | teacher | |
| GET | `/:id` | – | adds `problems`, `progress` |
| PUT/DELETE | `/:id` | creator/admin | |
| POST | `/:id/problems` · DELETE `/:id/problems/:problemId` | teacher | |
| GET | `/:id/progress` | login | |

### Discussions `/api`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/problems/:id/discussions` | – | nested tree |
| POST | `/api/discussions` | login | `{ problem_id, content, parent_id? }` |
| PUT/DELETE | `/api/discussions/:id` | author/admin | |
| POST | `/api/discussions/:id/pin` · `/lock` · `/official` | teacher | toggles |

### Exams `/api`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/exams` | – | paged |
| POST | `/api/exams` | teacher | |
| GET | `/api/exams/:id` | – | adds `questions`, `attempts` |
| PUT/DELETE | `/api/exams/:id` | creator/admin | |
| POST | `/api/exams/:id/questions` · `/import` | teacher | |
| PUT/DELETE | `/api/exam-questions/:id` | teacher | |
| POST | `/api/exams/:id/start` | login | new attempt |
| POST | `/api/exam-submissions/:id/submit` | owner | `{ answers }` → `{ score, needsManual, details }` |
| GET | `/api/exam-submissions/:id` | owner/teacher | |
| GET | `/api/exams/:id/submissions` | teacher | |
| POST | `/api/exam-submissions/:id/grade` | teacher | `{ grades, useAi? }` |

### Files `/api/files`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/` | login | multipart, <=10 MB |
| GET | `/` | login | paged; `all` (admin+) lists every user |
| DELETE | `/:id` | owner/admin | |
| PUT | `/quota/:userId` | su | |

### Groups `/api/groups`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/` | admin | with `member_count` |
| GET | `/mine` | optional | |
| POST | `/` | admin | |
| PUT/DELETE | `/:id` | admin | system groups are protected |
| GET | `/:id/members` · POST `/:id/members` · DELETE `/:id/members/:userId` | admin | |
| POST | `/:id/visibility` · GET `/:id/visibility` | admin | `entity_type` ∈ problem/contest/exam/problemset/article |

### Plagiarism `/api/plagiarism`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| POST | `/api/problems/:id/plagiarism` | teacher | |
| POST | `/api/contests/:id/plagiarism` | teacher | |
| GET | `/api/plagiarism` | teacher | report list |
| GET | `/api/plagiarism/:id` | teacher | `{ report, pairs }` |
| GET | `/api/plagiarism/pairs/:pairId` | teacher | side-by-side code |

### AI `/api/ai`

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/status` | – | feature toggles |
| POST | `/hint` | login | `{ problem_id }` |
| POST | `/review` | teacher | `{ code, language? }` |
| GET | `/testdata-config` | teacher | |

### Stats / Search

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/stats/overview` | – | counters |
| GET | `/api/stats/wordcloud` | – | tags + problems |
| GET | `/api/stats/recent` | – | latest submissions |
| GET | `/api/stats/languages` | – | language usage |
| GET | `/api/search` | – | query `q`, `type`, `limit` |

## WebSocket

Connect to `/ws`. The client sends `{ "type": "auth", "token" }` to authenticate
and `{ "type": "ping" }` as a heartbeat. Server broadcasts include:
`online`, `user_update`, `user_banned`, `force_logout`, `submission_new`,
`submission_status`, `judge_progress`, `rating_update`, `ide_status`,
`contest_unfreeze`, `plagiarism_progress`, `plagiarism_done`.
