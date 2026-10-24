import { HttpError } from '../utils/errors.js';

function compile(path) {
  const keys = [];
  const pattern = path
    .replace(/\/+$/, '')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    })
    .replace(/\//g, '\\/');
  return { regex: new RegExp(`^${pattern || '/'}/?$`), keys };
}

export function createRouter() {
  const routes = [];
  const middlewares = [];

  function add(method, path, ...handlers) {
    if (!handlers.length) throw new Error(`route ${method} ${path} has no handler`);
    const handler = handlers[handlers.length - 1];
    const routeMw = handlers.slice(0, -1);
    const { regex, keys } = compile(path);
    routes.push({ method: method.toUpperCase(), regex, keys, handler, middleware: routeMw });
    return router;
  }

  const router = {
    use(fn) { middlewares.push(fn); return router; },
    get: (p, ...h) => add('GET', p, ...h),
    post: (p, ...h) => add('POST', p, ...h),
    put: (p, ...h) => add('PUT', p, ...h),
    patch: (p, ...h) => add('PATCH', p, ...h),
    delete: (p, ...h) => add('DELETE', p, ...h),
    options: (p, ...h) => add('OPTIONS', p, ...h),

    match(method, pathname) {
      let methodMismatch = false;
      for (const route of routes) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        if (route.method !== method.toUpperCase()) { methodMismatch = true; continue; }
        const params = {};
        route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
      return methodMismatch ? { methodMismatch: true } : null;
    },

    async dispatch(ctx) {
      const matched = router.match(ctx.method, ctx.pathname);
      if (!matched) return false;
      if (matched.methodMismatch) {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '方法不被允许');
      }
      ctx.params = matched.params;
      const chain = [...middlewares, ...(matched.route.middleware || []), matched.route.handler];
      let index = -1;
      const next = async () => {
        index += 1;
        if (index >= chain.length) return undefined;
        const fn = chain[index];
        return fn(ctx, next);
      };
      const result = await next();
      if (result !== undefined && !ctx.res.writableEnded) {
        ctx.send(result);
      }
      return true;
    },

    get routes() { return routes; },
  };

  return router;
}

export function wrap(handler) {
  return async (ctx, next) => handler(ctx, next);
}

export default { createRouter };
