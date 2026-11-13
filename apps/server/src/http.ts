export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, 'forbidden', msg);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, 'bad_request', msg, extra);
