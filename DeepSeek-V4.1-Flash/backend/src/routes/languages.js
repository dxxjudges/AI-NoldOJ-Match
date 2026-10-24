import { all, get, run } from '../db.js';
import { requireRole, isAtLeast } from '../http/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { requireFields, toInt } from './helpers.js';
import { ok } from '../http/context.js';

export default function registerLanguages(router) {
  router.get('/api/languages', (ctx) => {
    const showAll = isAtLeast(ctx.user, 'su');
    const rows = showAll
      ? all('SELECT * FROM languages ORDER BY sort, id')
      : all('SELECT * FROM languages WHERE enabled = 1 ORDER BY sort, id');
    return ok(rows);
  });

  router.post('/api/languages', requireRole('su'), (ctx) => {
    requireFields(ctx.body, ['name', 'key', 'run_cmd']);
    const { name, key, ext = 'txt', compile_cmd = '', run_cmd, enabled = true, sort = 0 } = ctx.body;
    if (get('SELECT id FROM languages WHERE key = ?', key)) throw badRequest('语言标识已存在');
    const info = run(
      'INSERT INTO languages (name, key, ext, compile_cmd, run_cmd, enabled, sort) VALUES (?,?,?,?,?,?,?)',
      name, key, ext, compile_cmd, run_cmd, enabled ? 1 : 0, sort,
    );
    return ok(get('SELECT * FROM languages WHERE id = ?', Number(info.lastInsertRowid)));
  });

  router.put('/api/languages/:id', requireRole('su'), (ctx) => {
    const lang = get('SELECT * FROM languages WHERE id = ?', toInt(ctx.params.id, '语言ID'));
    if (!lang) throw notFound('语言不存在');
    const { name, ext, compile_cmd, run_cmd, enabled, sort } = ctx.body;
    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (ext !== undefined) { fields.push('ext = ?'); params.push(ext); }
    if (compile_cmd !== undefined) { fields.push('compile_cmd = ?'); params.push(compile_cmd); }
    if (run_cmd !== undefined) { fields.push('run_cmd = ?'); params.push(run_cmd); }
    if (enabled !== undefined) { fields.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (sort !== undefined) { fields.push('sort = ?'); params.push(toInt(sort, '排序')); }
    if (!fields.length) throw badRequest('没有可更新的字段');
    params.push(lang.id);
    run(`UPDATE languages SET ${fields.join(', ')} WHERE id = ?`, ...params);
    return ok(get('SELECT * FROM languages WHERE id = ?', lang.id));
  });

  router.delete('/api/languages/:id', requireRole('su'), (ctx) => {
    const lang = get('SELECT * FROM languages WHERE id = ?', toInt(ctx.params.id, '语言ID'));
    if (!lang) throw notFound('语言不存在');
    if (lang.is_builtin) throw badRequest('内置语言不可删除，可将其禁用');
    run('DELETE FROM languages WHERE id = ?', lang.id);
    return ok({ deleted: lang.id });
  });
}
