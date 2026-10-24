export class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (msg = '请求参数有误', detail) => new HttpError(400, 'BAD_REQUEST', msg, detail);
export const unauthorized = (msg = '未登录或登录已失效') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = '没有权限执行该操作') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = '资源不存在') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg = '操作冲突') => new HttpError(409, 'CONFLICT', msg);
export const tooMany = (msg = '操作过于频繁，请稍后再试') => new HttpError(429, 'TOO_MANY_REQUESTS', msg);
export const serverError = (msg = '服务器内部错误') => new HttpError(500, 'INTERNAL', msg);
