# NoldOJ Online Judge System - Requirements Document

## 1. Project Overview

NoldOJ is an Online Judge system designed specifically for the Windows platform, supporting multi-language code evaluation, secure sandbox execution, custom scoring scripts, contest management, article system, Rating mechanism, AI code security review, dark mode, SVG captcha, fuzzy search, announcement system, problem tags and difficulty, code diff comparison, multi-file submission, WebSocket real-time push, leaderboard freeze, problem set training plans, discussion/solution area, virtual contests, code plagiarism detection, and more.

## 2. Security Warning and Disclaimer

This project implements sandbox isolation based on native Windows technology, aiming to provide a lightweight local judging environment. However, the Windows desktop system is not designed for absolute isolation. Do not run this project exposed to the public network on your personal main machine that stores core confidential or sensitive data. It is recommended to deploy in a virtual machine or dedicated test machine.

## 3. Functional Requirements

### 3.1 Core Judging Engine

- **Multi-language Support**: Supports C, C++, Python 3, Java, JavaScript and other programming languages, which can be dynamically added or disabled through the admin panel.
- **Secure Sandbox**: Process isolation mechanism based on native Windows Job Object, ensuring code execution runs in an isolated environment.
  - **Process Isolation**: Binding through suspended creation with Job Object to prevent race condition escape.
  - **Process Tree Cleanup**: Force termination of the entire process tree when the parent process ends, preventing orphan process residue.
  - **No Escape**: Disable the ability of processes to break away from the sandbox; child processes cannot escape.
  - **Privilege Delegation**: Strip high-risk system privileges such as SeDebugPrivilege, SeImpersonatePrivilege.
  - **Resource Limits**: Limits on memory ceiling, CPU time, and process count.
  - **Data Isolation**: Each judging session uses an independent temporary directory, automatically cleaned after judging; database enables WAL mode to prevent locking.
  - **Three-Layer Security Architecture (Low Integrity Level + Job Object + Restricted Token/AppContainer)**: Low integrity level forces work directory marked as low integrity, preventing writes to high integrity objects; Job Object provides fallback CPU/memory/process limits; restricted token strips high-risk privileges, disables privileged groups such as Administrators; when running as admin/service, additionally attempts AppContainer file system and network isolation, with automatic safe fallback to restricted token on API crash.
- **Memory Detection**: Peak memory usage recorded for each test case and IDE run.
- **Multiple Comparison Modes**: Strict text comparison, loose text comparison, floating point tolerance comparison, Special Judge.
- **Custom Scoring Scripts**: Supports variables, arithmetic operations, bitwise operations, logical operations, conditional branches (parentheses supported), min/max/abs functions.
- **Subtask System**: Test case grouping, inter-group dependencies, custom aggregation strategies (sum/min/max etc.).
- **Compilation Error Detection**: Early termination of judging on compilation failure, returning detailed compilation output.
- **Code Length Limit**: Source code maximum 128KB.

### 3.2 AI Code Security Review

- **AI Integration**: Automatically invokes local AI services (such as Ollama) to review submitted code.
- **Configurable Toggle**: Enable/disable AI review via configuration files, customize AI service address, model and API Key.
- **Asynchronous Review**: Review runs in the background without blocking submission response; compilation and execution only proceed after review passes.
- **Malicious Code Detection**: Detects file attacks, network attacks, privilege escalation, mining programs, sensitive information theft etc.
- **Automatic Ban**: Upon detecting malicious code, immediately ban the user and kick from login; authentication Token invalidated immediately.
- **Prompt Injection Protection**: Multiple injection pattern detection, code truncation desensitization, AI response manipulation detection.

### 3.3 AI Hint

- **Post-Failure Guidance**: Students who fail a problem 2 times can receive directional algorithm hints (no complete code provided, within 300 Chinese characters).
- **Cooldown Mechanism**: 60-second cooldown per user per problem to prevent abuse.
- **Smart Prompts**: AI acts as a "gentle algorithm coach", providing targeted directional suggestions based on user submission history.

### 3.4 AI Test Data Generation

- **One-Click Generation**: Teachers can automatically generate test cases (normal cases + edge cases) for specified problems via the admin panel.
- **Controllable Parameters**: Can specify number of normal cases (1-10) and edge cases (0-10).
- **Disk Write**: Generated test cases automatically written to testdata directory and stored in database.

### 3.5 Dark Mode

- **One-Click Toggle**: Navigation bar icon toggle, localStorage remembers theme.
- **Global Adaptation**: All page elements (cards, tables, input fields, buttons, dropdown menus) fully adapted to dark theme.
- **Automatic Initialization**: Theme read immediately on page load to prevent flickering.

### 3.6 Problem Management

- **Problem CRUD**: Teachers and above roles can create, edit, delete problems.
- **Markdown Support**: Problem descriptions, input format, output format, hints all support Markdown + KaTeX/LaTeX formulas.
- **Input/Output Samples**: Problem-level input/output sample display, code-box wrapped, one-click copy.
- **Hints/Notes**: Problem-level hint information, recommended to fill data ranges to help contestants choose algorithms.
- **Author Attribution**: Can attribute problem/article authors.
- **Test Case Management**: Supports inline addition, batch addition, file upload (.in/.out), edit, delete.
- **Test Grouping**: Create Subtasks, set full score, aggregation method, dependency relationships, scoring scripts.
- **Problem-Level Scoring Script**: Override default aggregation strategy, customize whole-problem scoring logic.
- **Problem Number Recycling**: Problem numbers can be reused by new problems after deletion.

### 3.7 Online Programming (IDE)

- **Login Required**: Unauthenticated users automatically redirected to login page.
- **Three-Stage Status**: Under Review → Compiling → Running, displayed in real-time.
- **Memory Detection**: Displays exit code, elapsed time, peak memory.
- **Queue Mode**: Same queue processing mechanism as submission judging.

### 3.8 Markdown Enhancements

- **Math Formulas**: Inline and block-level KaTeX rendering.
- **Embedded Video**: Embed Bilibili video player.
- **Embedded Website**: Embed any website iframe.
- **Embedded Audio**: Embed audio player.
- **Embedded Video**: Embed video player.
- **Office Document Preview**: Embed docx/xlsx/pptx online preview.
- **ECharts Charts**: Embed charts (pie/line/bar etc.), degrade to raw text when JSON invalid.
- **Mermaid Charts**: Render flowcharts/sequence diagrams/class diagrams etc. as SVG.

### 3.9 Users and Permissions

- **Four-Level Role System**: User → Teacher → Admin → Super Admin.
- **User Profiles**: Personal signature, bio (Markdown + KaTeX formulas).
- **Preferred Language**: Users can set default programming language, auto-selected for submissions and IDE.
- **Rating Score**: Compilation errors deduct points, new AC awards points, navigation bar auto-refreshes.
- **Rating Leaderboard**: Sorted by Rating descending, top three with gold/silver/bronze medals, rank titles (Novice → Master).
- **User ID Reuse**: User numbers automatically recycled after deletion, new users can reuse idle IDs.
- **Ban System**: Banned users kicked from login, authentication Token immediately invalidated.
- **Forced Logout**: Access Token immediately invalidated, no need to wait for expiration.
- **Passwordless Login**: Super Admin can one-click switch to any user identity.
- **Profile Preview**: Username on all pages clickable to view other users' profiles.
- **Achievement System**: Auto-unlock achievements like First Blood, Streak, Collection Expert etc., displayed on profile page, support viewing others' achievements.
- **Personal Dashboard**: Submission calendar (last 365 days), language distribution, AC difficulty distribution.
- **Problem Favorites**: One-click favorite on problem detail page, personal favorites page management, support viewing others' favorites.
- **Privacy Switches**: Three independent switches for achievements/dashboard/favorites, hidden from other regular users when enabled (admins always visible), profile page entry auto-grayed.
- **User Groups and Visibility**: Auto-join "All Users" system group and personal group on registration; neither system group can be left; groups determine who can see problems/contests/exams/problem sets.
- **Visibility Interception**: Private entities only visible to bound group members and admins; lists auto-filter without error, direct URL access returns forbidden.
- **Admin Panel Group Management**: Create group, rename/describe, delete group, add/remove members and set entity visibility limited to admin/super admin only.
- **User Group Excel Batch Import**: Admin panel can upload xlsx to batch import members; accounts not yet in file auto-registered (role fixed as regular user), default password entered and confirmed by operator during import; super admin only, custom groups only.

### 3.10 Contest System

- **Contest CRUD**: Teachers and above roles can create, edit, delete contests.
- **Problem Association**: Add problems to contests (including non-public problems), support custom aliases and sorting.
- **Invite-Based Participation**: Teachers can invite any user to join contests, support manual addition.
- **Contest Leaderboard**: Sorted by total score descending, time ascending, top three with gold/silver/bronze indicators.
- **Auto Status Detection**: Not Started / In Progress / Ended.
- **Auto Solution Publishing**: Associated solutions can be auto-published after contest ends.

### 3.11 Article System

- **Article CRUD**: Teachers and above roles can create, edit, delete articles.
- **Markdown Support**: Article content supports full Markdown + KaTeX/LaTeX formulas + embedded media.
- **Solution Linking**: Articles can be linked to problems as solutions.
- **Access Control**: Teachers and above see all articles (including unpublished), regular users only see published.

### 3.12 File Hosting

- **File Upload**: Support image, document and other file uploads (max 10MB).
- **User Quota**: Max 2GB upload space per user (adjustable by super admin).
- **Image Hosting**: Uploaded files accessible via URL, convenient for embedding resources in Markdown.
- **File Management**: Record uploader, filename, size etc., admins can delete.

### 3.13 Submission Management

- **Submission Lock**: Cannot submit again while pending submission exists, super admin and privileged users exempt.
- **Submission List**: Filter by user, problem, status.
- **Submission Details**: Display detailed error descriptions (compile error, runtime error, timeout reason etc.) + per-test-case memory.
- **Rejudge**: Teachers and above can one-click rejudge any submission.
- **Delete Submission**: Admins can delete any submission record, numbers auto-recycled.
- **Auto Rating Calculation**: User Rating auto-updated after judging completes.

### 3.14 Language Management

- **Dynamic Configuration**: Super admin can add, edit, disable, delete programming languages via admin panel.
- **Compile/Run Commands**: Support placeholder configuration.

### 3.15 Captcha System

- **SVG Graphical Captcha**: Self-drawn SVG captcha, generate 4 random characters (excluding easily confused characters), overlay interference lines and turbulence distortion to prevent OCR.
- **Click to Refresh**: Click captcha image to generate new captcha.
- **One-Time Use**: Destroy immediately after successful/failed verification to prevent replay.
- **Expiration**: 5-minute validity, auto-expire on timeout, need to re-fetch.
- **Case Insensitive**: User input auto-converted to uppercase for matching.

### 3.16 Announcement System

- **Global/Contest Announcements**: Admins can publish global announcements or bind to specific contests.
- **Pin Display**: Important announcements can be pinned, prioritized display on homepage and contest pages.
- **Markdown Support**: Announcement content supports Markdown + KaTeX formulas.
- **Dedicated Pages**: Announcement list page + announcement detail page.

### 3.17 Problem Tags and Difficulty

- **Tag System**: Pre-set common algorithm tags (simulation, greedy, DP, graph theory etc.), support custom tags.
- **Difficulty Grading**: 6 levels from Entry to Expert.
- **Multi-Dimensional Filtering**: Problem list supports combined filtering by tag, difficulty, category.
- **Colorful Tags**: Each tag can have custom color for visual distinction.

### 3.18 Code Diff Comparison

- **Submission Comparison**: View differences between two submissions by same user on same problem.
- **Line-by-Line Highlighting**: New lines green, deleted lines red, modified lines yellow.
- **Side-by-Side Display**: Left-right dual column comparison for quick change location.

### 3.19 Multi-File Submission

- **Multi-File Upload**: Support multi-source file submission (e.g. C++ multi-file projects).
- **File Management**: Add, delete, edit multiple files during submission.
- **Auto Packaging**: Server automatically organizes file structure for compilation.

### 3.20 WebSocket Real-Time Push

- **Real-Time Push**: Judging status changes pushed to frontend in real-time.
- **No Refresh Needed**: Submission status, contest leaderboard changes auto-update.
- **Connection Management**: Auto-reconnect, heartbeat keep-alive.

### 3.21 Leaderboard Freeze

- **Contest Scoreboard Freeze**: Freeze leaderboard N minutes before contest ends, hide real-time rankings.
- **Manual Unfreeze**: Admin one-click unfreeze after contest ends, display final rankings.
- **Freeze Indicator**: Display "Scoreboard Frozen" notice during freeze period.

### 3.22 Problem Set Training Plans

- **Problem Set CRUD**: Teachers and above can create problem sets, add problems and sort.
- **Progress Tracking**: Auto-record user completion progress on each problem set.
- **Public/Private**: Problem sets can be set as public or private.
- **Problem Management**: Support add, delete, sort problems.

### 3.23 Discussion/Solution Area

- **Problem Discussion Tab**: New discussion area on problem detail page, support posting and replying.
- **Nested Replies**: Support two-level nested replies.
- **Official Solutions**: Teachers can mark official solutions, gold border pinned at top.
- **Pin/Lock**: Teachers can pin discussions, lock discussions (read-only during contests).
- **Markdown Rendering**: Markdown rendering + XSS protection.
- **Access Control**: Users post/edit/delete their own, teachers pin/bless/official mark, admins delete any/lock.

### 3.24 Virtual Contests

- **Virtual Participation**: Initiate virtual participation for ended contests, private independent instance.
- **Independent Timer**: Starts from clicking "Start", duration = original contest duration, cannot pause.
- **Independent Leaderboard**: Only own submissions and rankings, does not affect original contest data.
- **Uniqueness**: Same user can only virtually participate in same contest once.
- **Server-Side Timing**: Timer continues if browser closed mid-way, based on server time.

### 3.25 Code Plagiarism Detection

- **Similarity Algorithm**: Extract code token sequence (remove comments and whitespace, preserve variable names), calculate similarity.
- **Three-Tier Judgment**: >=85% highly similar (red), >=70% suspected similar (orange), below threshold not recorded.
- **Asynchronous Execution**: Plagiarism checks run asynchronously in background, non-blocking, support progress query.
- **Comparison Scope**: Only compare latest submissions of different users on same problem, skip short code.
- **Side-by-Side Comparison**: Detail page displays two codes side by side, highlight matching tokens.
- **Contest One-Click Check**: After contest ends, one-click initiate plagiarism check for all problems.

### 3.26 Search Function

- **Fuzzy Search**: Problems, contests, articles all support title/description fuzzy search.
- **Ignore Spaces**: Search ignores spaces when matching.
- **Real-Time Filtering**: Search as you type, no need to wait for submission.

### 3.27 Exam System

- **Question Types**: Support multiple choice, true/false, fill-in-the-blank (objective/subjective), and essay question types.
- **Exam CRUD**: Teachers can create/edit/delete exams, configure time limit, passing score, max attempts etc.
- **Smart Grading**: Objective questions auto-graded, subjective questions support AI grading and teacher manual grading.
- **Exam Submission**: Students can answer and submit, support time limits and multiple attempts.
- **Question Display**: Markdown + KaTeX formula support.
- **Exam Editor**: Real-time Markdown preview for question display.
- **Excel Import**: Exam questions support Excel import.

## 4. Non-Functional Requirements

### 4.1 Security Requirements

- **Dual Token Authentication**: Short-lived Access Token + long-lived Refresh Token (HttpOnly Cookie).
- **Forced Logout Immediate Invalidation**: Via timestamp comparison mechanism, Access Token immediately invalidated.
- **Ban Full Interception**: Banned user's Access Token and Refresh Token both rejected.
- **Graphical Captcha**: Login and registration require SVG graphical captcha verification to prevent automated attacks.
- **Registration Rate Limiting**: Single IP limited to 1 registration per hour.
- **Rate Limiting**: Submission and IDE run interfaces both have fixed window rate limiting.
- **Input Validation**: SQL injection protection, source code size limit (128KB), language availability check.
- **Sandbox Isolation**: User code executes in independent temporary directory, auto-cleaned after completion.

### 4.2 Performance Requirements

- Real-time judging status push, no page refresh needed.
- Plagiarism checks execute asynchronously, non-blocking to user response.
- AI review executes asynchronously, non-blocking to submission response.
- Navigation bar Rating auto-refreshes.

### 4.3 Usability Requirements

- Full Chinese interface.
- Dark mode globally adapted.
- Auto-reconnect and heartbeat keep-alive.

## 5. Environment Requirements

| Dependency | Version Requirement | Purpose |
|------|---------|------|
| Node.js | >= 24.x | Run backend service, built-in SQLite engine |
| Mingw64 | Any version | C/C++ compilation |
| Python 3 | Any version | Python code execution (optional) |
| JDK | Any version | Java compilation and execution (optional) |
| Operating System | Windows 10 or above | Primary supported platform |
| Ollama | Any version | AI code security review (optional) |

## 6. Roles and Permissions

| Role | Description | Permission Scope |
|------|------|------|
| User | Regular registered user | Solve problems, submit code, use IDE (login required), view submission records, join contests, view others' profiles, post/reply in discussions, virtual contest participation, view problem sets |
| Teacher | Problem manager | Create/edit problems, manage test cases, create contests, invite users, rejudge submissions, publish articles, file upload/image hosting, manage announcements, pin/bless/lock discussions, initiate code plagiarism check, create problem sets |
| Admin | User manager | Manage users with lower or equal权限 (ban/unban/force logout), delete submissions, delete any discussion |
| Super Admin | Highest privilege | All permissions + modify roles, reset passwords, passwordless login, manage languages, set Rating, self-delete, set image hosting quota |

## 7. Configuration Requirements

The system supports flexible configuration through configuration files and environment variables, mainly including:

- **AI Capabilities Configuration**: Control AI code security review, AI hint, AI test data generation toggles and service addresses.
- **Email Sending Configuration**: Control email function toggle, sender address etc.
- **CORS Configuration**: Control API cross-origin access policy.
- **Captcha Configuration**: Captcha toggle control.
- **Core Configuration**: Server port, JWT secret, database path, sandbox working directory, rate limiting etc.

## 8. Deployment Requirements

- Provide one-click startup script.
- Auto-migrate directory structure on first startup.
- Auto-initialize database.
- Auto-generate JWT secret.
- Support update and uninstall.

## 9. Frequently Asked Questions

**Q: Code submission keeps showing "Under Judging"?**
A: Check startup logs for errors. Compiler may not be installed or path not configured.

**Q: Memory shows 0KB?**
A: In sandbox mode, memory measured by Job Object; fallback mode polls memory on Windows, kills on overflow. If showing 0KB, usually due to non-Windows fallback or process exiting too early. Ensure sandbox runner file exists.

**Q: How to add a new language?**
A: Login as super admin, go to "Language" management page, fill in compile/run commands.

**Q: How to write custom scoring scripts?**
A: Use variable assignment, if/fi conditional judgment (parentheses supported), min()/max()/abs() functions. See API documentation scoring script section.

**Q: How to use formulas in problem descriptions?**
A: Inline formulas use E=mc² format, block formulas use summation formula format.

**Q: How to embed videos/websites?**
A: Bilibili uses specific format, any website uses specific format, audio uses specific format, video uses specific format, Office documents use specific format (requires public https), ECharts charts use specific format, Mermaid flowcharts use specific format wrapping multi-line text.

**Q: How to configure AI security review?**
A: Edit configuration file. Set security review switch to enabled, configure AI service address via config item (default local Ollama address), set model name (default qwen3:1.7b), set API Key (optional, for services requiring authentication).

**Q: How does the captcha work?**
A: System self-drawn SVG captcha: on startup uses font library to convert glyphs to path outlines (answer string not written to DOM, naturally immune to DOM reading), generates 4 random characters (excluding easily confused O/0/I/1, random number uses cryptographic secure random number generator), overlay interference lines and turbulence distortion to prevent OCR. Users need to input captcha during login/registration, destroyed immediately after verification (one-time use), valid for 5 minutes. Click captcha image to refresh. Captcha toggle controlled via configuration file.

**Q: How to modify a user's image hosting quota?**
A: Login as super admin, go to user management page, find target user, click edit button to modify single file size limit and total storage space. Can only manage accounts with permission level below or equal to own.

**Q: How to search for problems/contests/articles?**
A: Enter keywords in the search box at top of list page. Search supports fuzzy matching and ignores spaces, e.g. searching a+b can match A + B Problem.

**Q: How to use the discussion area?**
A: Switch to "Discussion" tab on problem detail page to view and post. Logged-in users can post, reply (nested replies up to 2 levels), edit/delete own posts. Teachers can pin, mark official solutions, lock discussions. Admins can delete any posts. Discussion content supports Markdown rendering and XSS protection.

**Q: What are virtual contests?**
A: For ended contests, you can initiate "Virtual Participation" to get a private instance. Timer starts from clicking "Start", duration equals original contest duration, cannot pause during. Closing browser does not stop timer (based on server time). Your submissions count toward virtual leaderboard but do not affect original contest data. Same contest can only be virtually participated once per user.

**Q: How to use code plagiarism detection?**
A: Login to admin panel as teacher or above, click "Plagiarism Check" button on problem management to initiate check for that problem. Check runs asynchronously in background, report page shows progress in real-time. Results sorted by similarity: >=85% highly similar (red), >=70% suspected similar (orange). Click "View Details" to compare two codes side by side, matching tokens highlighted in gold. After contest ends, click "One-Click Check" on contest management to initiate check for all problems.

**Q: Where is the database?**
A: Default at backend/data/NoldOJ.db, SQLite format, all data preserved across restarts.

## 10. Release Notes Summary

### v2.1.0

- New exam system: support multiple choice, true/false, fill-in-the-blank (objective/subjective), and essay question types
- Exam CRUD, smart grading (objective auto-grading, subjective support AI grading and teacher manual grading)
- Exam submission support time limits and multiple attempts
- Exam editor real-time Markdown preview for question display
- Exam questions support Excel import
- Frontend pages: exam list, answer interface, result display, teacher grading interface
- Navigation bar new "Exam" entry
- Test isolation improvement: tests requiring database use independent database, no longer read/write production database
- Startup convergence of IDE run residual intermediate states
- Startup alerts: high-risk states clearly prompted in startup logs
- Silent empty catch logging: key operation failures no longer silent
- Dead code cleanup
- Documentation and implementation sync updates
- Introduce ESLint static checking
- New CI pipeline

### v2.0.0

- **Major Refactor**: Remove Sandboxie dependency, switch to native three-layer security architecture (Low Integrity Level + Job Object + Restricted Token/AppContainer)
- New problem detail page left-right split layout
- New contest context support
- New contest submission auto-association
- New statistics/wordcloud API returning accepted_count field
- New problem page "Copy as Markdown" button
- Remove online user list feature
- Fix multiple bugs

### v1.9.0

- New privacy switches: achievements/dashboard/favorites three independent switches
- Achievements/dashboard/favorites pages support viewing others' data (following privacy switches)
- Achievements, dashboard, favorites API documentation completed

### v1.10.0

- New super admin management tool: user management toolbar "+ Create User" form (with random strong password generation)
- New Excel batch user import
- New registration toggle: admin can one-click close/open visitor self-registration
- New problem multi-sample support
- New Markdown enhancements: Office document embedding, ECharts charts, Mermaid flowchart rendering
- New AI Hint
- New AI test data generation
- New Sandboxie-Classic three-layer security isolation

### v1.8.0

- Database engine changed from sql.js to Node built-in node:sqlite (native synchronous direct write, zero dependencies)
- New database migration script (backup + integrity check + data statistics)
- Fix multiple bugs

### v1.7.0

- New announcement system
- New problem tag and difficulty system
- New code diff comparison feature
- New multi-file submission
- New WebSocket real-time push
- New contest leaderboard freeze
- New problem set training plans
- New discussion/solution area
- New virtual contests
- New code plagiarism detection
- API routes expanded to 16 modules, 100+ endpoints
- Frontend pages expanded to 30
- Unit tests expanded to 70+ cases

### v1.6.0

- New SVG graphical captcha replacing Cloudflare Turnstile
- New fuzzy search feature
- New user profile preview
- New image hosting quota management
- Configuration file systematization
- Fix multiple bugs

### v1.5.0

- New dark mode one-click toggle
- New user preferred language feature
- New Markdown embedding syntax
- New IDE three-stage status display
- New IDE queue mode
- New IDE memory detection
- New problem input/output sample display
- New AI security review prompt injection protection
- New force_logout_at mechanism
- New scoring script conditional parenthesis support, min/max/abs functions
- New navigation bar Rating auto-refresh
- New submission lock
- New registration rate limiting
- New user ID reuse
- New favicon for all pages
- New OpenAPI 3.0 specification documentation
- New 55+ unit tests

### v1.4.0

- New port reservation and auto-add system PATH environment variable
- New Rating leaderboard page
- New LM Studio Gemma code security review, malicious code auto-ban
- New code length limit (128KB)
- New banned user Token full interception
- New problem/article number auto-recycle after deletion
- New submission record deletion feature
- Rating update real-time navigation bar refresh

### v1.3.0

- New Markdown + KaTeX/LaTeX formula rendering
- New user personal signature, bio
- New Rating score system
- New article system, solution feature
- New file upload/image hosting feature (single user 2GB quota)

### v1.2.0

- New contest invite system, leaderboard, non-public problem visibility
- New homepage statistics, submission rejudge, submission deletion, submission detail error descriptions

### v1.1.0

- New custom scoring scripts, test grouping, admin panel GUI
- New su passwordless login, role adjustment
- New ban/unban/force logout optimization

## 11. License

MIT
