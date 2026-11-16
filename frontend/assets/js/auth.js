import { api, getToken, setSession, clearSession, redirectToLogin } from "./api.js";

/** Returns the current user, or redirects to the login page. */
export async function requireLogin() {
  if (!getToken()) {
    redirectToLogin();
    return null;
  }
  const { user } = await api("/auth/me"); // 401 clears the session and redirects
  return user;
}

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  // Only same-origin absolute paths; blocks open redirects such as //evil.com.
  return next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : "/pages/dashboard.html";
}

function finish(data) {
  setSession({ token: data.token });
  location.replace(safeNext());
}

export async function loginWithTelegramWebApp() {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg || !tg.initData) return false;
  tg.ready();
  finish(await api("/auth/telegram", { method: "POST", body: { initData: tg.initData }, auth: false }));
  return true;
}

export function mountTelegramWidget(container, botUsername) {
  const ref = new URLSearchParams(location.search).get("ref") || undefined;
  window.onTelegramAuth = async (widget) => {
    try {
      finish(await api("/auth/telegram-widget", { method: "POST", body: { widget, ref }, auth: false }));
    } catch (e) {
      container.dispatchEvent(new CustomEvent("login-error", { detail: e }));
    }
  };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://telegram.org/js/telegram-widget.js?22";
  s.setAttribute("data-telegram-login", botUsername);
  s.setAttribute("data-size", "large");
  s.setAttribute("data-radius", "10");
  s.setAttribute("data-request-access", "write");
  s.setAttribute("data-onauth", "onTelegramAuth(user)");
  container.append(s);
}

/** Local development only; the server rejects it outside ENVIRONMENT=development. */
export async function devLogin(telegramId, username) {
  finish(await api("/auth/dev-login", { method: "POST", body: { telegramId: Number(telegramId), username }, auth: false }));
}

export function logout() {
  clearSession();
  location.replace("/index.html");
}
