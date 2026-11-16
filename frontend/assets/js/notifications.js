import { api } from "./api.js";
import { h, $, clear, fmtDate, emptyState, showError } from "./app.js";

/** Updates the unread counter on the bell icon. Silent on failure. */
export async function loadBadge() {
  try {
    const { unread } = await api("/notifications?limit=1");
    const dot = $("#bell-dot");
    if (!dot) return;
    dot.textContent = unread > 99 ? "99+" : String(unread);
    dot.classList.toggle("hidden", unread === 0);
  } catch {
    /* ignore */
  }
}

export async function renderNotifications(container) {
  clear(container);
  const { notifications, unread } = await api("/notifications?limit=30");
  const head = h(
    "div",
    { class: "row between" },
    h("h3", null, "اعلان‌ها"),
    unread
      ? h(
          "button",
          {
            class: "btn sm secondary",
            type: "button",
            onclick: async () => {
              try {
                await api("/notifications/read", { method: "POST", body: {} });
                await renderNotifications(container);
                loadBadge();
              } catch (e) {
                showError(e);
              }
            },
          },
          "علامت‌گذاری همه به‌عنوان خوانده‌شده",
        )
      : null,
  );
  container.append(head);
  if (!notifications.length) {
    container.append(emptyState("اعلانی وجود ندارد."));
    return;
  }
  for (const n of notifications) {
    container.append(
      h(
        "div",
        { class: "asset-row" },
        h("div", null, h("strong", null, n.title, n.read ? "" : " •"), h("div", { class: "muted small" }, n.body)),
        h("span", { class: "muted small" }, fmtDate(n.createdAt)),
      ),
    );
  }
}
