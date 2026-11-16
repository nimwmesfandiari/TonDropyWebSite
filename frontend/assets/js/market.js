import { api } from "./api.js";
import { PAIR_LABEL, PRICE_REFRESH_MS } from "./config.js";
import { h, clear, fmt, emptyState } from "./app.js";

const QUOTE_OF = { "TON/IRT": "IRT", "USDT/IRT": "IRT", "TON/USDT": "USDT" };

export const quoteAssetOf = (pair) => QUOTE_OF[pair];

export async function fetchPrices() {
  return api("/market/prices", { auth: false });
}

/** Renders a price table and refreshes it. Returns a stop() function. */
export function mountPriceTable(container) {
  let last = {};
  let timer;
  let stopped = false;

  async function tick() {
    try {
      const { prices } = await fetchPrices();
      clear(container);
      if (!prices.length) {
        container.append(emptyState("قیمتی در دسترس نیست."));
        return;
      }
      const rows = prices.map((p) => {
        const q = QUOTE_OF[p.pair];
        const prev = last[p.pair];
        const cls = p.available && prev && prev !== p.buy ? (Number(p.buy) > Number(prev) ? "flash-up" : "flash-down") : "";
        const change = p.change24h;
        return h(
          "tr",
          { class: cls },
          h("td", null, PAIR_LABEL[p.pair] || p.pair),
          h("td", { class: "num" }, p.available ? fmt(p.buy, q) : "—"),
          h("td", { class: "num" }, p.available ? fmt(p.sell, q) : "—"),
          h(
            "td",
            { class: `num ${change > 0 ? "up" : change < 0 ? "down" : ""}`, dir: "ltr" },
            change === null || change === undefined ? "—" : `${change > 0 ? "+" : ""}${change}%`,
          ),
        );
      });
      last = Object.fromEntries(prices.filter((p) => p.available).map((p) => [p.pair, p.buy]));
      container.append(
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("thead", null, h("tr", null, h("th", null, "جفت‌ارز"), h("th", null, "خرید از ما"), h("th", null, "فروش به ما"), h("th", null, "تغییر ۲۴ ساعته"))),
            h("tbody", null, rows),
          ),
        ),
      );
    } catch {
      /* keep the previous table on a transient error */
    } finally {
      if (!stopped) timer = setTimeout(tick, PRICE_REFRESH_MS);
    }
  }
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
