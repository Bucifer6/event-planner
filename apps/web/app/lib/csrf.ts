import { AppError } from '@eventdesk/shared';

// SEC6: state-changing route handlers verify the Origin header matches the host.
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // non-browser clients (curl) carry no Origin; SameSite=Lax covers browsers
  const host = new URL(request.url).host;
  if (new URL(origin).host !== host) {
    throw new AppError('FORBIDDEN', 'Cross-origin request rejected.');
  }
}
