'use strict';

/** OpenAPI 3.0 specification (static summary of the API surface). */

function spec() {
  const tag = (name, desc) => ({ name, description: desc });
  const err = { description: '错误' };
  const json = (schema) => ({
    content: { 'application/json': { schema } },
  });
  const body = (schema) => ({
    required: true,
    content: { 'application/json': { schema } },
  });
  const ok = (schema) => ({ 200: { description: '成功', ...json(schema) } });

  return {
    openapi: '3.0.3',
    info: {
      title: 'NoldOJ API',
      version: '2.1.0',
      description: 'Windows 原生在线评测系统 REST API。认证使用 Bearer Access Token（`Authorization: Bearer <token>`），Refresh Token 存于 HttpOnly Cookie（path=/api/auth）。',
    },
    servers: [{ url: '/', description: '当前服务器' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, username: { type: 'string' },
            role: { type: 'string', enum: ['user', 'teacher', 'admin', 'super'] },
            rating: { type: 'integer' }, preferred_language: { type: 'string', nullable: true },
          },
        },
        Problem: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, title: { type: 'string' },
            difficulty: { type: 'string', enum: ['entry', 'basic', 'medium', 'hard', 'advanced', 'expert'] },
            time_limit_ms: { type: 'integer' }, memory_limit_mb: { type: 'integer' },
            is_public: { type: 'integer', enum: [0, 1] },
            samples: { type: 'array', items: { type: 'object', properties: { input: { type: 'string' }, output: { type: 'string' } } } },
          },
        },
        Submission: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, problem_id: { type: 'integer' }, language: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'ai_reviewing', 'queued', 'compiling', 'judging', 'accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error', 'compile_error', 'output_limit', 'internal_error', 'system_error'] },
            score: { type: 'number' }, time_ms: { type: 'integer', nullable: true }, memory_kb: { type: 'integer', nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      tag('auth', '认证'),
      tag('captcha', '验证码'),
      tag('problems', '题目'),
      tag('submissions', '提交'),
      tag('ide', '在线编程'),
      tag('users', '用户'),
      tag('contests', '比赛'),
      tag('articles', '文章'),
      tag('announcements', '公告'),
      tag('discussions', '讨论'),
      tag('problem-sets', '题单'),
      tag('exams', '考试'),
      tag('files', '文件托管'),
      tag('admin', '管理'),
      tag('search', '搜索'),
      tag('plagiarism', '查重'),
      tag('virtual', '虚拟参赛'),
      tag('ai', 'AI 能力'),
    ],
    paths: {
      '/api/health': { get: { tags: ['search'], summary: '健康检查', security: [], responses: ok({ type: 'object' }) } },
      '/api/captcha': { get: { tags: ['captcha'], summary: '获取 SVG 验证码', security: [], responses: ok({ type: 'object', properties: { id: { type: 'string' }, svg: { type: 'string' }, enabled: { type: 'boolean' } } }) } },
      '/api/auth/register': { post: { tags: ['auth'], summary: '注册', security: [], body: body({ type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' }, captchaId: { type: 'string' }, captcha: { type: 'string' } } }), responses: { 201: { description: '成功' }, ...err } } },
      '/api/auth/login': { post: { tags: ['auth'], summary: '登录', security: [], body: body({ type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' }, captchaId: { type: 'string' }, captcha: { type: 'string' } } }), responses: { 200: { description: '返回 token 与用户' }, ...err } } },
      '/api/auth/refresh': { post: { tags: ['auth'], summary: '刷新 Access Token', security: [], responses: ok({ type: 'object' }) } },
      '/api/auth/logout': { post: { tags: ['auth'], summary: '登出（吊销 Refresh Token）', security: [], responses: ok({ type: 'object' }) } },
      '/api/auth/me': { get: { tags: ['auth'], summary: '当前用户', responses: ok({ type: 'object' }) } },
      '/api/auth/password': { post: { tags: ['auth'], summary: '修改密码', body: body({ type: 'object', properties: { oldPassword: { type: 'string' }, newPassword: { type: 'string' } } }), responses: ok({ type: 'object' }) } },
      '/api/problems': {
        get: { tags: ['problems'], summary: '题目列表（支持 keyword/tag/difficulty 过滤）', security: [], responses: ok({ type: 'object' }) },
        post: { tags: ['problems'], summary: '创建题目（teacher+）', body: body({ $ref: '#/components/schemas/Problem' }), responses: { 201: { description: '成功' }, ...err } },
      },
      '/api/problems/{id}': {
        get: { tags: ['problems'], summary: '题目详情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], security: [], responses: ok({ type: 'object' }) },
        put: { tags: ['problems'], summary: '更新题目（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) },
        delete: { tags: ['problems'], summary: '删除题目并回收编号（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) },
      },
      '/api/problems/{id}/cases': {
        post: { tags: ['problems'], summary: '添加测试点（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], body: body({ type: 'object', properties: { input: { type: 'string' }, output: { type: 'string' }, is_sample: { type: 'boolean' }, group_id: { type: 'integer' } } }), responses: { 201: { description: '成功' } } },
      },
      '/api/submissions': {
        get: { tags: ['submissions'], summary: '提交列表', security: [], responses: ok({ type: 'object' }) },
        post: { tags: ['submissions'], summary: '提交代码（需登录，有提交锁与限流）', body: body({ type: 'object', required: ['problemId', 'language', 'code'], properties: { problemId: { type: 'integer' }, language: { type: 'string' }, code: { type: 'string', maxLength: 131072 }, files: { type: 'array' }, contestId: { type: 'integer' } } }), responses: { 201: { description: '成功' }, ...err } },
      },
      '/api/submissions/{id}': { get: { tags: ['submissions'], summary: '提交详情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], security: [], responses: ok({ type: 'object' }) } },
      '/api/submissions/{id}/rejudge': { post: { tags: ['submissions'], summary: '重新评测（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/submissions/compare/{a}/{b}': { get: { tags: ['submissions'], summary: '对比同一用户同一题两次提交', parameters: [{ name: 'a', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'b', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/ide/run': { post: { tags: ['ide'], summary: 'IDE 运行代码', body: body({ type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' }, stdin: { type: 'string' } } }), responses: { 201: { description: '成功' } } } },
      '/api/ide/run/{id}': { get: { tags: ['ide'], summary: 'IDE 运行结果', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/users/ranking': { get: { tags: ['users'], summary: 'Rating 排行榜', security: [], responses: ok({ type: 'object' }) } },
      '/api/users/{username}': { get: { tags: ['users'], summary: '用户主页（含成就/面板/收藏，受隐私开关控制）', parameters: [{ name: 'username', in: 'path', required: true, schema: { type: 'string' } }], security: [], responses: ok({ type: 'object' }) } },
      '/api/users/me': { put: { tags: ['users'], summary: '更新个人资料与隐私开关', responses: ok({ type: 'object' }) } },
      '/api/contests': { get: { tags: ['contests'], summary: '比赛列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['contests'], summary: '创建比赛（teacher+）', responses: { 201: { description: '成功' } } } },
      '/api/contests/{id}/board': { get: { tags: ['contests'], summary: '比赛排行榜（支持封榜）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], security: [], responses: ok({ type: 'object' }) } },
      '/api/contests/{id}/publish-solutions': { post: { tags: ['contests'], summary: '发布关联题解（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/contests/{id}/solutions': { get: { tags: ['contests'], summary: '比赛题解列表', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], security: [], responses: ok({ type: 'object' }) } },
      '/api/articles': { get: { tags: ['articles'], summary: '文章列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['articles'], summary: '创建文章（teacher+）', responses: { 201: { description: '成功' } } } },
      '/api/announcements': { get: { tags: ['announcements'], summary: '公告列表（置顶优先）', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['announcements'], summary: '发布公告（teacher+）', responses: { 201: { description: '成功' } } } },
      '/api/discussions': { get: { tags: ['discussions'], summary: '题目讨论列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['discussions'], summary: '发表讨论/回复（两级）', responses: { 201: { description: '成功' } } } },
      '/api/problem-sets': { get: { tags: ['problem-sets'], summary: '题单列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['problem-sets'], summary: '创建题单（teacher+）', responses: { 201: { description: '成功' } } } },
      '/api/exams': { get: { tags: ['exams'], summary: '考试列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['exams'], summary: '创建考试（teacher+）', responses: { 201: { description: '成功' } } } },
      '/api/exams/{id}/start': { post: { tags: ['exams'], summary: '开始考试答卷', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 201: { description: '成功' } } } },
      '/api/exams/attempts/{aid}/submit': { post: { tags: ['exams'], summary: '提交答卷（客观题自动评分）', parameters: [{ name: 'aid', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/exams/{id}/import': { post: { tags: ['exams'], summary: 'Excel/JSON 批量导入试题（teacher+）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], body: body({ type: 'object', properties: { questions: { type: 'array' } } }), responses: { 201: { description: '成功' } } } },
      '/api/files/upload': { post: { tags: ['files'], summary: '上传文件（multipart, 字段名 file）', responses: { 201: { description: '返回 url' } } } },
      '/api/files/mine': { get: { tags: ['files'], summary: '我的文件与配额', responses: ok({ type: 'object' }) } },
      '/api/admin/users': { get: { tags: ['admin'], summary: '用户列表（admin+）', responses: ok({ type: 'object' }) }, post: { tags: ['admin'], summary: '创建用户（super）', responses: { 201: { description: '成功' } } } },
      '/api/admin/users/{id}/login-as': { post: { tags: ['admin'], summary: '无密码切换身份（super）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/admin/groups/{id}/import': { post: { tags: ['admin'], summary: '用户组 Excel 行数据批量导入（super，自定义组）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], body: body({ type: 'object', properties: { defaultPassword: { type: 'string' }, rows: { type: 'array', items: { type: 'object' } } } }), responses: ok({ type: 'object' }) } },
      '/api/admin/languages': { get: { tags: ['admin'], summary: '语言列表', security: [], responses: ok({ type: 'object' }) }, post: { tags: ['admin'], summary: '添加语言（super）', responses: { 201: { description: '成功' } } } },
      '/api/admin/settings': { get: { tags: ['admin'], summary: '运行设置（super）', responses: ok({ type: 'object' }) }, put: { tags: ['admin'], summary: '更新并持久化设置（super）', responses: ok({ type: 'object' }) } },
      '/api/search': { get: { tags: ['search'], summary: '模糊搜索（忽略空格）', security: [], responses: ok({ type: 'object' }) } },
      '/api/plagiarism/problem/{pid}': { post: { tags: ['plagiarism'], summary: '对题目发起查重（teacher+）', parameters: [{ name: 'pid', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 201: { description: '成功' } } } },
      '/api/plagiarism/contest/{cid}': { post: { tags: ['plagiarism'], summary: '比赛一键查重（teacher+）', parameters: [{ name: 'cid', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 201: { description: '成功' } } } },
      '/api/plagiarism/job/{id}': { get: { tags: ['plagiarism'], summary: '查重进度与结果', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok({ type: 'object' }) } },
      '/api/virtual/{contestId}/start': { post: { tags: ['virtual'], summary: '发起虚拟参赛（仅限已结束比赛，每人一次）', parameters: [{ name: 'contestId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 201: { description: '成功' } } } },
      '/api/ai/hint': { post: { tags: ['ai'], summary: '获取算法思路提示（失败≥2次，60s 冷却）', body: body({ type: 'object', properties: { problemId: { type: 'integer' } } }), responses: ok({ type: 'object' }) } },
      '/api/ai/testdata': { post: { tags: ['ai'], summary: 'AI 生成测试数据（teacher+）', body: body({ type: 'object', properties: { problemId: { type: 'integer' }, normalCount: { type: 'integer' }, edgeCount: { type: 'integer' } } }), responses: ok({ type: 'object' }) } },
      '/ws': { get: { tags: ['search'], summary: 'WebSocket 实时推送（query 参数 token）', security: [], responses: { 200: { description: 'WebSocket 升级' } } } },
    },
  };
}

module.exports = { spec };
