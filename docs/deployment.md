# استقرار

## پیش‌نیاز
حساب Cloudflare، دامنه روی Cloudflare، Node ≥ 20، `npm install`، `npx wrangler login`.

## مراحل
1. **منابع**
   ```bash
   npx wrangler d1 create tondropy            # database_id ⇒ wrangler.toml
   npx wrangler kv namespace create KV        # id ⇒ wrangler.toml
   npx wrangler r2 bucket create tondropy-kyc # خصوصی بماند (public access خاموش)
   ```
2. **متغیرها** در `wrangler.toml → [vars]`: `APP_URL`, `TELEGRAM_BOT_USERNAME`, `ADMIN_TELEGRAM_IDS`, `TON_DEPOSIT_ADDRESS`, `USDT_JETTON_MASTER`, اطلاعات کارت/شبا، `FEE_BPS`, `SPREAD_BPS`.
3. **Secrets**: `npm run secrets:set` مقادیر تصادفی و دستورها را چاپ می‌کند. **کلید KYC را پشتیبان بگیرید.**
4. **مایگریشن**: `npm run db:migrate:remote`
5. **استقرار**: `npm run deploy`، سپس دامنه سفارشی در Workers ⇒ Settings ⇒ Domains.
6. **تلگرام**: webhook و دامنه widget (`telegram.md`).
7. **نرخ تومان**: با حساب ادمین `PUT /admin/rates` (بدون آن، جفت‌های تومانی متوقف‌اند).
8. **تست دود** روی testnet (`TON_NETWORK=testnet`)، سپس `docs/checklist.md`.

## محیط‌ها
یک Worker جدا برای staging بسازید (`[env.staging]` یا فایل toml دوم) با D1/KV/R2 و بات تلگرام جدا. **هرگز staging و production منابع مشترک نداشته باشند.**

## بازگشت
`npx wrangler rollback` برای کد. مایگریشن‌ها رو‌به‌جلو هستند؛ قبل از هر مایگریشن Time Travel/export دیتابیس را بگیرید (`backup.md`).
