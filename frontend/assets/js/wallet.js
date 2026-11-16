import { api } from "./api.js";
import { ASSET_LABEL } from "./config.js";
import { h, clear, fmt, fmtWithUnit, fmtDate, statusBadge, emptyState, copyLine, withBusy, toast } from "./app.js";

export async function renderBalances(container) {
  clear(container);
  const { balances } = await api("/wallet");
  for (const b of balances) {
    container.append(
      h(
        "div",
        { class: "asset-row" },
        h("div", { class: "row" }, h("div", { class: `asset-icon ${b.asset}` }, b.asset[0]), h("strong", null, ASSET_LABEL[b.asset])),
        h(
          "div",
          { class: "num", style: "text-align:end" },
          h("div", null, fmt(b.available, b.asset)),
          Number(b.locked) > 0 ? h("div", { class: "muted small" }, `قفل‌شده: ${fmt(b.locked, b.asset)}`) : null,
        ),
      ),
    );
  }
  return balances;
}

export async function renderDepositInfo(container) {
  clear(container);
  const info = await api("/wallet/deposit-info");
  container.append(
    h("div", { class: "alert warning" }, info.warning),
    h("h3", null, "واریز TON"),
    h("div", { class: "field" }, h("label", null, "آدرس"), copyLine(info.TON.address)),
    h("div", { class: "field" }, h("label", null, "کامنت (Memo) — اجباری"), copyLine(info.TON.memo)),
    h("h3", null, "واریز USDT (شبکه TON)"),
    h("p", { class: "muted small" }, "آدرس و کامنت مشابه TON است. فقط USDT روی شبکه TON ارسال کنید."),
    h("h3", null, "واریز تومان (کارت به کارت)"),
    info.IRT.card
      ? h(
          "div",
          null,
          h("div", { class: "field" }, h("label", null, "شماره کارت"), copyLine(info.IRT.card)),
          info.IRT.holder ? h("p", { class: "muted small" }, `به نام: ${info.IRT.holder}`) : null,
          info.IRT.iban ? h("div", { class: "field" }, h("label", null, "شبا"), copyLine(info.IRT.iban)) : null,
        )
      : h("p", { class: "muted small" }, "اطلاعات حساب هنوز تنظیم نشده است."),
  );
}

export function mountFiatDepositForm(container, onDone) {
  const amount = h("input", { class: "input ltr", inputmode: "numeric", placeholder: "مبلغ به تومان", dir: "ltr" });
  const ref = h("input", { class: "input ltr", placeholder: "شماره پیگیری / ۴ رقم آخر کارت", dir: "ltr", maxlength: "40" });
  const btn = h("button", { class: "btn block", type: "button" }, "ثبت واریز");
  btn.addEventListener("click", () =>
    withBusy(btn, async () => {
      await api("/wallet/deposits/fiat", { method: "POST", body: { amount: amount.value.replace(/[,\s]/g, ""), reference: ref.value.trim() } });
      toast("واریز ثبت شد و پس از بررسی اعمال می‌شود", "success");
      amount.value = "";
      ref.value = "";
      if (onDone) onDone();
    }),
  );
  container.append(
    h("div", { class: "field" }, h("label", null, "مبلغ واریزی (تومان)"), amount),
    h("div", { class: "field" }, h("label", null, "شماره پیگیری"), ref),
    btn,
  );
}

export function mountWithdrawForm(container, onDone) {
  const asset = h("select", { class: "select" }, ["TON", "USDT", "IRT"].map((a) => h("option", { value: a }, ASSET_LABEL[a])));
  const amount = h("input", { class: "input ltr", inputmode: "decimal", placeholder: "0.0", dir: "ltr" });
  const dest = h("input", { class: "input ltr", placeholder: "آدرس TON یا شبا (IR…)", dir: "ltr", autocomplete: "off" });
  const memo = h("input", { class: "input ltr", placeholder: "Memo (اختیاری)", dir: "ltr", maxlength: "120" });
  const memoField = h("div", { class: "field" }, h("label", null, "Memo"), memo);
  const sync = () => memoField.classList.toggle("hidden", asset.value === "IRT");
  asset.addEventListener("change", sync);
  sync();
  const btn = h("button", { class: "btn block", type: "button" }, "ثبت درخواست برداشت");
  btn.addEventListener("click", () =>
    withBusy(btn, async () => {
      await api("/wallet/withdrawals", {
        method: "POST",
        body: { asset: asset.value, amount: amount.value.trim().replace(",", "."), destination: dest.value.trim(), memo: memo.value.trim() || undefined },
      });
      toast("درخواست برداشت ثبت شد", "success");
      amount.value = "";
      dest.value = "";
      memo.value = "";
      if (onDone) onDone();
    }),
  );
  container.append(
    h("div", { class: "field" }, h("label", null, "دارایی"), asset),
    h("div", { class: "field" }, h("label", null, "مقدار"), amount),
    h("div", { class: "field" }, h("label", null, "مقصد"), dest),
    memoField,
    h("div", { class: "alert info small" }, "برداشت‌ها پس از بررسی دستی انجام می‌شوند. قبل از تایید، آدرس را با دقت بررسی کنید؛ تراکنش قابل بازگشت نیست."),
    btn,
  );
}

export async function renderHistory(container, onChange) {
  clear(container);
  const { deposits, withdrawals } = await api("/wallet/history");
  if (!deposits.length && !withdrawals.length) {
    container.append(emptyState("تراکنشی وجود ندارد."));
    return;
  }
  const rows = [
    ...deposits.map((d) => ({ t: d.createdAt, kind: "واریز", asset: d.asset, amount: d.amount, status: d.status, id: null })),
    ...withdrawals.map((w) => ({ t: w.createdAt, kind: "برداشت", asset: w.asset, amount: w.amount, status: w.status, id: w.status === "pending" ? w.id : null })),
  ].sort((a, b) => b.t - a.t);
  container.append(
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("thead", null, h("tr", null, ["زمان", "نوع", "مقدار", "وضعیت", ""].map((x) => h("th", null, x)))),
        h(
          "tbody",
          null,
          rows.map((r) =>
            h(
              "tr",
              null,
              h("td", null, fmtDate(r.t)),
              h("td", null, r.kind),
              h("td", { class: "num" }, fmtWithUnit(r.amount, r.asset)),
              h("td", null, statusBadge(r.status)),
              h(
                "td",
                null,
                r.id
                  ? h(
                      "button",
                      {
                        class: "btn sm secondary",
                        type: "button",
                        onclick: async (e) => {
                          await withBusy(e.currentTarget, async () => {
                            await api(`/wallet/withdrawals/${r.id}/cancel`, { method: "POST" });
                            toast("درخواست لغو شد", "success");
                            if (onChange) onChange();
                          });
                        },
                      },
                      "لغو",
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
