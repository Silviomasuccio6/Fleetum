import { getSafeReturnTo } from '../../routes/safe-return-to';

const accessRoutes = ['/login', '/signup', '/forgot-password', '/reset-password', '/accept-invite', '/auth/social-callback', '/onboarding/azienda', '/activate', '/upgrade', '/billing/recovery'];
/** Keep a same-origin business destination without returning into an access loop. */
export function getAccessReturnTo(value?: string | null) {
  const safe = getSafeReturnTo(value);
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(safe, window.location.origin).pathname).replace(/\/+$/, '').toLowerCase(); }
  catch { return '/dashboard'; }
  return accessRoutes.some(route => pathname === route || pathname.startsWith(route + '/')) ? '/dashboard' : safe;
}
export function getAccessDestination(search: string) {
  const params = new URLSearchParams(search);
  return getAccessReturnTo(params.get('returnTo') ?? params.get('next'));
}
export function getAccessLoginPath(search: string) {
  const next = getAccessDestination(search);
  return next === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
export function getActivationPath(search: string, profileCompleted = false) {
  const next = getAccessDestination(search);
  return '/activate?welcome=billing' + (profileCompleted ? '&profile=completed' : '') + (next === '/dashboard' ? '' : `&returnTo=${encodeURIComponent(next)}`);
}
export function getCompanyOnboardingPath(returnTo: string) {
  const next = getAccessReturnTo(returnTo);
  return '/onboarding/azienda?from=social' + (next === '/dashboard' ? '' : `&returnTo=${encodeURIComponent(next)}`);
}
/** Recover the business hint nested by signup without trusting callback identity. */
export function getSocialAccessDestination(value?: string | null) {
  const safe = getSafeReturnTo(value);
  const target = new URL(safe, window.location.origin);
  if (['/onboarding/azienda','/activate','/upgrade','/billing/recovery'].includes(target.pathname.replace(/\/+$/, '').toLowerCase())) return getAccessDestination(target.search);
  return getAccessReturnTo(safe);
}
export const passwordRequirements = 'Almeno 8 caratteri, una maiuscola, un numero e un simbolo.';
export function validateAccessPassword(password: string, confirmation: string) {
  const errors: Record<string,string> = {};
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) errors.password = passwordRequirements;
  if (confirmation !== password) errors.confirmPassword = 'Le due password non coincidono.';
  return errors;
}
export function clearConsumedAccessToken(search: string) {
  const params = new URLSearchParams(search);
  params.delete('token');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
}
