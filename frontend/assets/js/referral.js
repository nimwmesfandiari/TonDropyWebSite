import { api } from "./api.js";
import { h, clear, copyLine, fmtWithUnit, fmtDate, emptyState } from "./app.js";

export async function renderReferral(container) {
  clear(container);
  const r = await api("/referral");
  container.append(
    h("h3", null, "دعوت دوستان"),
    h("p", { class: "muted small" }, "با هر معامله دوستانی که با لینک شما ثبت‌نام کنند، بخشی از کارمزد را به‌عنوان پاداش دریافت می‌کنید."),
    h("div", { class: "field" }, h("label", null, "کد دعوت"), copyLine(r.code)),
    r.link ? h("div", { class: "field" }, h("label", null, "لینک دعوت"), copyLine(r.link)) : null,
    h("div", { class: "row between" }, h("span", null, "تعداد دعوت‌شده‌ها"), h("strong", null, String(r.invited))),
    h(
      "div",
      { class: "row between" },
      h("span", null, "پاداش دریافتی"),
      h("strong", null, r.rewards.length ? r.rewards.map((x) => fmtWithUnit(x.total, x.asset)).join(" + ") : "۰"),
    ),
  );
  if (r.recent.length) {
    container.append(
      h("h3", { style: null }, "آخرین دعوت‌ها"),
      ...r.recent.map((u) =>
        h("div", { class: "asset-row" }, h("span", null, u.name), h("span", { class: "muted small" }, fmtDate(u.joinedAt))),
      ),
    );
  } else {
    container.append(emptyState("هنوز کسی با لینک شما ثبت‌نام نکرده است."));
  }
}
