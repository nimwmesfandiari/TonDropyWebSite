// Shared UI helpers and page bootstrap. Every page script calls boot().

import { NAV, APP_NAME, STATUS_LABEL, ASSET_LABEL } from "./config.js";
import { ApiError } from "./api.js";
import { requireLogin } from "./auth.js";
import { loadBadge } from "./notifications.js";

/** Safe element builder: children are always text nodes, never parsed as HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => el.replaceChildren();

// ---- formatting ----
export function group(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a decimal string from the API. Toman gets thousands separators. */
export function fmt(value, asset) {
  if (value === null || value === undefined) return "—";
  const [whole, frac] = String(value).split(".");
  const w = group(whole);
  return frac && asset !== "IRT" ? `${w}.${frac}` : w;
}
export const fmtWithUnit = (value, asset) => `${fmt(value, asset)} ${ASSET_LABEL[asset] || asset}`;

export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" });
}

export function statusBadge(status) {
  const [label, tone] = STATUS_LABEL[status] || [status, ""];
  return h("span", { class: `badge ${tone}` }, label);
}

// ---- feedback ----
let toastHost;
export function toast(message, kind = "") {
  if (!toastHost) {
    toastHost = h("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const t = h("div", { class: `toast ${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => t.remove(), 4200);
}

export function showError(err) {
  if (err instanceof ApiError && err.status === 401) return; // already redirecting
  toast(err && err.message ? err.message : "خطای ناشناخته", "error");
}

/** Disables a button and shows a spinner while the async action runs. */
export async function withBusy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }));
  try {
    return await fn();
  } catch (e) {
    showError(e);
    return undefined;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("کپی شد", "success");
  } catch {
    toast("کپی نشد. به صورت دستی کپی کنید.", "error");
  }
}

export function copyLine(value) {
  return h(
    "div",
    { class: "copy-line" },
    h("span", { class: "value mono" }, value || "—"),
    value ? h("button", { class: "btn sm secondary", type: "button", onclick: () => copyText(value) }, "کپی") : null,
  );
}

export function emptyState(text) {
  return h("div", { class: "empty" }, text);
}

// ---- layout ----
function renderHeader(user, page) {
  const links = NAV.map((n) => h("a", { href: n.href, class: n.key === page ? "active" : "" }, n.label));
  if (user && user.role === "admin") {
    links.push(h("a", { href: "/pages/admin.html", class: page === "admin" ? "active" : "" }, "مدیریت"));
  }
  const bell = h(
    "a",
    { class: "bell", href: "/pages/profile.html#notifications", "aria-label": "اعلان‌ها" },
    "🔔",
    h("span", { class: "dot hidden", id: "bell-dot" }, "0"),
  );
  const header = h(
    "header",
    { class: "app-header" },
    h(
      "div",
      { class: "inner" },
      h("a", { class: "brand", href: "/pages/dashboard.html" }, h("span", null, APP_NAME)),
      h("nav", { class: "nav", "aria-label": "منوی اصلی" }, links),
      user ? bell : null,
    ),
  );
  document.body.prepend(header);
}

/**
 * Standard page lifecycle: auth guard, header, then the page's own init(user).
 * Options: { public: true } skips the login guard; { admin: true } requires the admin role.
 */
export async function boot(init, opts = {}) {
  const page = document.body.dataset.page || "";
  let user = null;
  try {
    if (!opts.public) {
      user = await requireLogin();
      if (!user) return;
      if (opts.admin && user.role !== "admin") {
        location.replace("/pages/dashboard.html");
        return;
      }
    }
    renderHeader(user, page);
    if (user) loadBadge();
    await init(user);
  } catch (e) {
    showError(e);
  }
}
