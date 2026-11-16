import { API_BASE, SESSION_KEY, ERROR_FA } from "./config.js";

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(ERROR_FA[code] || message || "خطای ناشناخته");
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

// The session lives in sessionStorage: it is cleared when the tab closes and is
// never sent anywhere except the same-origin API.
export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
export const getToken = () => (getSession() || {}).token || null;
export function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/index.html?next=${next}`);
}

export async function api(path, { method = "GET", body, form, auth = true, signal } = {}) {
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = form; // the browser sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload, signal });
  } catch {
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید.");
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (res.ok && json && json.ok) return json.data;

  const err = (json && json.error) || {};
  if (res.status === 401 && auth) {
    clearSession();
    redirectToLogin();
  }
  throw new ApiError(res.status, err.code || "http_error", err.message, err);
}
