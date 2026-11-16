import { api } from "./api.js";
import { PAIR_LABEL, ASSET_LABEL } from "./config.js";
import { h, clear, fmt, fmtWithUnit, fmtDate, statusBadge, emptyState, withBusy, toast, showError } from "./app.js";

const PAIRS_BY_BASE = {
  TON: ["TON/IRT", "TON/USDT"],
  USDT: ["USDT/IRT"],
};

/** Buy / sell form with a locked-price quote and a confirm step. */
export function mountTradeForm(container, side, onDone) {
  const verb = side === "buy" ? "خرید" : "فروش";
  let quote = null;
  let countdown;

  const pairSel = h(
    "select",
    { class: "select", id: "pair" },
    Object.keys(PAIR_LABEL).map((p) => h("option", { value: p }, PAIR_LABEL[p])),
  );
  const amount = h("input", { class: "input ltr", id: "amount", inputmode: "decimal", autocomplete: "off", placeholder: "0.0", dir: "ltr" });
  const out = h("div", { class: "stack" });
  const quoteBtn = h("button", { class: "btn block", type: "button" }, "دریافت قیمت");

  const baseOf = () => pairSel.value.split("/")[0];
  const label = h("label", { for: "amount" }, "");
  const syncLabel = () => (label.textContent = `مقدار ${ASSET_LABEL[baseOf()]} برای ${verb}`);
  pairSel.addEventListener("change", () => {
    syncLabel();
    resetQuote();
  });
  amount.addEventListener("input", resetQuote);
  syncLabel();

  function resetQuote() {
    quote = null;
    clearInterval(countdown);
    clear(out);
  }

  function renderQuote(q) {
    clear(out);
    const secs = h("strong", null, "");
    const confirm = h("button", { class: `btn block ${side === "buy" ? "success" : "danger"}`, type: "button" }, `تایید و ${verb}`);
    const tick = () => {
      const left = q.expiresAt - Math.floor(Date.now() / 1000);
      secs.textContent = left > 0 ? `${left} ثانیه` : "منقضی شد";
      confirm.disabled = left <= 0;
      if (left <= 0) clearInterval(countdown);
    };
    clearInterval(countdown);
    countdown = setInterval(tick, 500);
    tick();

    const total = side === "buy" ? "مبلغ قابل پرداخت" : "مبلغ دریافتی";
    out.append(
      h(
        "div",
        { class: "quote-box" },
        h(
          "dl",
          null,
          h("dt", null, "قیمت"), h("dd", { class: "num" }, `${fmt(q.price, q.quoteAsset)} ${ASSET_LABEL[q.quoteAsset]}`),
          h("dt", null, "مقدار"), h("dd", { class: "num" }, fmtWithUnit(q.baseAmount, q.baseAsset)),
          h("dt", null, "کارمزد"), h("dd", { class: "num" }, fmtWithUnit(q.fee, q.quoteAsset)),
          h("dt", null, total), h("dd", { class: "num" }, fmtWithUnit(q.total, q.quoteAsset)),
          h("dt", null, "اعتبار قیمت"), h("dd", null, secs),
        ),
      ),
      confirm,
    );
    confirm.addEventListener("click", () =>
      withBusy(confirm, async () => {
        const { order } = await api("/orders", { method: "POST", body: { quoteId: q.id } });
        toast(`${verb} با موفقیت انجام شد`, "success");
        resetQuote();
        amount.value = "";
        if (onDone) onDone(order);
      }).then(() => {
        /* errors are toasted by withBusy; an expired quote just needs a new one */
      }),
    );
  }

  quoteBtn.addEventListener("click", () =>
    withBusy(quoteBtn, async () => {
      const { quote: q } = await api("/orders/quote", {
        method: "POST",
        body: { pair: pairSel.value, side, amount: amount.value.trim().replace(",", ".") },
      });
      quote = q;
      renderQuote(q);
    }),
  );

  container.append(
    h("div", { class: "field" }, h("label", { for: "pair" }, "جفت‌ارز"), pairSel),
    h("div", { class: "field" }, label, amount, h("span", { class: "hint" }, "قیمت برای ۳۰ ثانیه قفل می‌شود.")),
    quoteBtn,
    out,
  );
  return () => clearInterval(countdown);
}

export async function renderOrders(container, { limit = 50 } = {}) {
  clear(container);
  const { orders } = await api(`/orders?limit=${limit}`);
  if (!orders.length) {
    container.append(emptyState("هنوز معامله‌ای انجام نداده‌اید."));
    return;
  }
  container.append(
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("thead", null, h("tr", null, ["زمان", "نوع", "جفت‌ارز", "مقدار", "مبلغ", "کارمزد", "وضعیت"].map((t) => h("th", null, t)))),
        h(
          "tbody",
          null,
          orders.map((o) =>
            h(
              "tr",
              null,
              h("td", null, fmtDate(o.createdAt)),
              h("td", null, h("span", { class: `badge ${o.side === "buy" ? "success" : "danger"}` }, o.side === "buy" ? "خرید" : "فروش")),
              h("td", null, PAIR_LABEL[o.pair] || o.pair),
              h("td", { class: "num" }, fmtWithUnit(o.baseAmount, o.baseAsset)),
              h("td", { class: "num" }, fmtWithUnit(o.quoteAmount, o.quoteAsset)),
              h("td", { class: "num" }, fmtWithUnit(o.fee, o.quoteAsset)),
              h("td", null, statusBadge(o.status)),
            ),
          ),
        ),
      ),
    ),
  );
}

export { PAIRS_BY_BASE, showError };
