// Frontend runtime constants. The API is served by the same Worker under /api/v1.

export const API_BASE = "/api/v1";
export const APP_NAME = "تن‌دراپی";
export const SESSION_KEY = "td_session";
export const PRICE_REFRESH_MS = 10_000;

export const ASSET_LABEL = { TON: "TON", USDT: "USDT", IRT: "تومان" };
export const PAIR_LABEL = {
  "TON/IRT": "TON به تومان",
  "USDT/IRT": "USDT به تومان",
  "TON/USDT": "TON به USDT",
};

export const NAV = [
  { href: "/pages/dashboard.html", key: "dashboard", label: "داشبورد" },
  { href: "/pages/market.html", key: "market", label: "بازار" },
  { href: "/pages/buy.html", key: "buy", label: "خرید" },
  { href: "/pages/sell.html", key: "sell", label: "فروش" },
  { href: "/pages/converter.html", key: "converter", label: "مبدل" },
  { href: "/pages/wallet.html", key: "wallet", label: "کیف پول" },
  { href: "/pages/orders.html", key: "orders", label: "سفارش‌ها" },
  { href: "/pages/profile.html", key: "profile", label: "پروفایل" },
];

export const STATUS_LABEL = {
  pending: ["در انتظار", "warning"],
  approved: ["تایید شده", "info"],
  credited: ["واریز شد", "success"],
  completed: ["انجام شد", "success"],
  filled: ["انجام شد", "success"],
  rejected: ["رد شد", "danger"],
  failed: ["ناموفق", "danger"],
};

export const ERROR_FA = {
  unauthorized: "نشست شما منقضی شده است. دوباره وارد شوید.",
  account_frozen: "حساب شما مسدود شده است. با پشتیبانی تماس بگیرید.",
  kyc_required: "برای این کار باید احراز هویت کنید.",
  insufficient_funds: "موجودی کافی نیست.",
  quote_expired: "قیمت منقضی شد. دوباره قیمت بگیرید.",
  quote_used: "این قیمت قبلا استفاده شده است.",
  below_minimum: "مبلغ کمتر از حداقل مجاز است.",
  above_maximum: "مبلغ بیشتر از سقف مجاز شماست.",
  price_unavailable: "قیمت در حال حاضر در دسترس نیست. کمی بعد تلاش کنید.",
  rate_limited: "درخواست‌ها زیاد است. کمی صبر کنید.",
  daily_limit: "سقف برداشت روزانه شما پر شده است.",
  invalid_destination: "آدرس یا شبا نامعتبر است.",
  invalid_amount: "مبلغ نامعتبر است.",
  too_many_decimals: "تعداد اعشار بیش از حد مجاز است.",
  too_many_pending: "تعداد درخواست‌های در انتظار زیاد است.",
  already_pending: "مدارک شما در حال بررسی است.",
  already_verified: "حساب شما قبلا تایید شده است.",
  national_id_in_use: "این کد ملی روی حساب دیگری ثبت شده است.",
  invalid_national_id: "کد ملی نامعتبر است.",
  invalid_birth_date: "تاریخ تولد نامعتبر است (حداقل ۱۸ سال).",
  invalid_file_type: "فقط تصویر JPEG، PNG یا WebP مجاز است.",
  file_too_large: "حجم فایل بیشتر از ۵ مگابایت است.",
  not_cancellable: "این درخواست دیگر قابل لغو نیست.",
};
