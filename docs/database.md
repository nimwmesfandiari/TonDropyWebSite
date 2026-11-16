# دیتابیس (D1)

اسکیما: `backend/migrations/0001_init.sql`. اجرا: `npm run db:migrate:local|remote`.

| جدول | نقش |
|---|---|
| `users` | کاربر تلگرام؛ `kyc_level` 0–2؛ `deposit_tag` (memo واریز)؛ کاربر ۱ = خانه |
| `balances` | `available` و `locked` به‌ازای (کاربر، دارایی)؛ CHECK ≥ 0 برای کاربران |
| `ledger_entries` | ژورنال append-only؛ مجموع آن باید برابر `balances` باشد |
| `quotes` / `orders` | قیمت قفل‌شده و سفارش اجراشده (`orders.quote_id UNIQUE`) |
| `deposits` | `chain` (tx_hash یکتا) یا `fiat_receipt` (تایید دستی) |
| `withdrawals` | pending → approved → completed، یا rejected |
| `kyc_submissions` | فیلدهای متنی رمزنگاری‌شده + blind index کد ملی؛ کلید فایل‌ها در R2 |
| `referral_rewards`, `notifications`, `audit_log`, `kv_state` | پشتیبان |

## تضمین‌های اتمیک (ایندکس‌های unique جزئی)

- `ux_ledger_deposit_credit` — هر واریز حداکثر یک‌بار اعتبار می‌شود.
- `ux_ledger_withdraw_lock` — هر برداشت حداکثر یک‌بار قفل می‌شود.
- `ux_ledger_withdraw_final` — هر برداشت حداکثر یک‌بار آزاد/تسویه می‌شود (لغو و رد و انجام هم‌زمان ممکن نیست).

## واحدها

TON = nanoTON (۱e9)، USDT = ۱e6، تومان = عدد صحیح. قیمت‌ها `price_e8` (×۱e8). سقف هر مبلغ `MAX_MINOR = 4e15` تا Number دقیق بماند.

## تغییر اسکیما

فقط با migration جدید (`0002_*.sql`)؛ هرگز migration اعمال‌شده را ویرایش نکنید.
