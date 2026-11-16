# تلگرام

## راه‌اندازی ربات
1. در @BotFather ربات بسازید ⇒ `TELEGRAM_BOT_TOKEN` (secret) و `TELEGRAM_BOT_USERNAME` (در `wrangler.toml`).
2. دامنه Login Widget: `/setdomain` برای دامنه سایت.
3. Mini App: `/newapp` یا دکمه منو با آدرس `APP_URL`.
4. Webhook (secret_token باید با `TELEGRAM_WEBHOOK_SECRET` یکی باشد):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://YOUR_DOMAIN/api/v1/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## رفتار
- `/start ref_ABCD2345` کد دعوت را ۷ روز در KV نگه می‌دارد تا در **اولین ورود** به حساب اعمال شود، و دکمه «ورود به صرافی» (Web App) می‌فرستد.
- اعلان‌ها (معامله، واریز، برداشت، KYC) با `sendMessage` و بهترین تلاش ارسال می‌شوند؛ شکست آن‌ها هیچ عملیات مالی را مختل نمی‌کند.
- هشدارهای عملیاتی (خطای watcher، مغایرت حسابداری) به `ADMIN_TELEGRAM_IDS` می‌روند.

## توجه
کاربر باید ربات را `/start` کرده باشد تا پیام خصوصی بگیرد.
