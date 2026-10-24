# NoldOJ

A Windows-native Online Judge system: multi-language judging, a Job Object sandbox,
AI code review / hints, contests with freeze + virtual participation, exams,
articles, ratings, achievements, plagiarism detection and more.

> **Security note.** The Windows desktop is not built for absolute isolation. Do not
> expose this project to the public internet on a machine holding sensitive data.
> Deploy in a VM or a dedicated test machine.

## Requirements

| Dependency | Version | Purpose |
| --- | --- | --- |
| Node.js | >= 24 | Backend service + built-in SQLite (`node:sqlite`) |
| MinGW64 | any | C/C++ compilation |
| Python 3 | any (optional) | Python execution |
| JDK | any (optional) | Java compilation/execution |
| Windows | 10+ | Primary platform |
| Ollama | any (optional) | AI review / hints / test data |

## Quick start

```powershell
# from the repository root
.\start.bat            # or: powershell -ExecutionPolicy Bypass -File .\start.ps1
```

First run migrates the directory tree, generates `config/config.json` with a fresh
JWT secret, initializes `data/NoldOJ.db` and starts the server on
<http://localhost:8080>.

The default super admin is created on first boot:

```
username: su
password: (printed in the startup log, or set via config core.initialSuperAdminPassword)
```

## Project layout

```
backend/          Node.js API server (zero runtime dependencies)
  server.js       entry point
  scripts/        init / migrate helpers
  src/
    config.js     config + env loading
    db.js         SQLite schema, migrations, helpers
    http/         router, middleware, request/response helpers
    routes/       API route modules (one per domain)
    services/     judge, sandbox, compiler, comparator, scorer, ai, captcha, ws, ...
    utils/        jwt, password, rate limiting, ids, ...
frontend/         static vanilla-JS SPA (no build step)
config/           config.example.json + generated config.json
data/             SQLite database (generated)
testdata/         per-problem test case data
uploads/          file / image hosting
sandbox-work/     ephemeral judging directories (auto-cleaned)
```

## Configuration

Everything is driven by `config/config.json`. Key sections:

- `core` – port, JWT secret, db path, sandbox dir, token TTLs, code size limit
- `rateLimit` – fixed-window limits for submit / ide / login
- `captcha` – enable/disable the SVG captcha
- `cors` – API cross-origin policy
- `ai.security` / `ai.hint` / `ai.testdata` – AI toggles + service addresses
- `email` – outgoing mail for notifications
- `plagiarism` – similarity thresholds

Any value can be overridden with an environment variable using the
`NOLDOJ__SECTION__KEY` pattern, e.g. `NOLDOJ__CORE__PORT=9000`.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with `--watch` |
| `npm run init` | Create directories + initialize the database |
| `npm run migrate` | Backup + integrity check + schema migration |
| `npm test` | Run the API + unit test suite (`node --test`) |
| `npm run lint` | ESLint |

## Content embeds (Markdown)

Problem statements, articles, announcements and discussions are Markdown and are
rendered client-side. Supported extras:

- Math: `$inline$`, `$$display$$`, `\\(...\\)`, `\\[...\\]` (KaTeX)
- Diagrams: fenced code blocks tagged `mermaid`
- Charts: fenced code blocks tagged `echarts` containing an ECharts option object
- Bilibili player: `@[bilibili](BV1xx411c7mD)` (optional page number as second argument)
- Website iframe: `@[website](https://example.com)`
- Office document preview: `@[office](https://example.com/file.docx)`
- Media: `@[audio](https://example.com/a.mp3)`, `@[video](https://example.com/v.mp4)`

## Roles

User → Teacher → Admin → Super Admin. See `docs/API.md` for the endpoint-level
permission matrix.

## License

MIT
