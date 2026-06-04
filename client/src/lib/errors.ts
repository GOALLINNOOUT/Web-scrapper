export type AppErrorKind = 'offline' | 'timeout' | 'server' | 'rate_limit' | 'validation' | 'auth' | 'not_found' | 'unknown';

export class AppError extends Error {
  kind: AppErrorKind;
  status?: number;
  action: string;

  constructor(message: string, options: { kind?: AppErrorKind; status?: number; action?: string } = {}) {
    super(message);
    this.name = 'AppError';
    this.kind = options.kind || 'unknown';
    this.status = options.status;
    this.action = options.action || 'Try again. If this keeps happening, refresh the page.';
  }
}

export function friendlyError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    if (!navigator.onLine) {
      return new AppError('You are offline.', {
        kind: 'offline',
        action: 'Turn on Wi-Fi or mobile data, then try again.'
      });
    }
    if (/failed to fetch|network/i.test(error.message)) {
      return new AppError('Could not reach the server.', {
        kind: 'server',
        action: 'Make sure the app is connected, then try again.'
      });
    }
    return new AppError(readableMessage(error.message) || 'Something went wrong.', {
      kind: 'unknown',
      action: 'Try again. If this keeps happening, refresh the page.'
    });
  }
  return new AppError('Something went wrong.', {
    kind: 'unknown',
    action: 'Try again. If this keeps happening, refresh the page.'
  });
}

export function toastTitleForError(error: AppError) {
  if (error.kind === 'offline') return 'You are offline';
  if (error.kind === 'timeout') return 'Request timed out';
  if (error.kind === 'rate_limit') return 'Too many requests';
  if (error.kind === 'server') return 'Server unavailable';
  if (error.kind === 'validation') return 'Check the input';
  if (error.kind === 'not_found') return 'Not found';
  if (error.kind === 'auth') return 'Session problem';
  return 'Something went wrong';
}

export function appErrorFromResponse(status: number, message: string) {
  const readable = readableMessage(message);
  if (status === 400 || status === 422) return new AppError(readable, { status, kind: 'validation', action: 'Check the details you entered, then try again.' });
  if (status === 401 || status === 403) return new AppError('This action is not available right now.', { status, kind: 'auth', action: 'Refresh the page. If it is still blocked, check your workspace access.' });
  if (status === 404) return new AppError('We could not find that item.', { status, kind: 'not_found', action: 'Go back to the list, refresh it, then try again.' });
  if (status === 408 || status === 504) return new AppError('The request took too long.', { status, kind: 'timeout', action: 'Check your connection, then try again.' });
  if (status === 429) return new AppError(message, { status, kind: 'rate_limit', action: 'Wait a moment, then try again.' });
  if (status >= 500) return new AppError('The server could not finish this request.', { status, kind: 'server', action: 'Try again in a moment.' });
  return new AppError(readable, { status, kind: 'unknown', action: 'Try again. If this keeps happening, refresh the page.' });
}

function readableMessage(message: string) {
  if (!message) return 'Something went wrong.';
  if (/request failed:\s*\d+/i.test(message)) return 'The server could not complete the request.';
  if (/failed to fetch|network/i.test(message)) return 'Could not reach the server.';
  return message;
}
