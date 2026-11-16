# Hookها: Cron، Webhook و CI

## Cron Triggers (`wrangler.toml`)
| زمان‌بندی | کار |
|---|---|
| `* * * * *` | `refreshPrices` (TON/USD) + `watchDeposits` (اگر `DEPOSIT_WATCHER_ENABLED=true`) |
| `*/10 * * * *` | `cleanup` (quoteهای قدیمی)، `reconcile` (تطبیق حساب‌ها)، `stuckWithdrawals` (هشدار برداشت‌های بیش از ۶ ساعت) |

> هر زمان‌بندی جداگانه فراخوانی می‌شود و کد با `event.cron` بین آن‌ها فرق می‌گذارد؛ در دقیقه‌های مضرب ۱۰ هر دو اجرا می‌شوند.

## Webhook
`POST /api/v1/telegram/webhook` — هدر `X-Telegram-Bot-Api-Secret-Token` اجباری.

## CI (پیشنهادی: `.github/workflows/ci.yml`)
```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm test
      - run: npm run check
```
این فایل در مخزن گذاشته شده است.

## Git hook محلی (اختیاری)
`.git/hooks/pre-commit`: `npm test && npm run check`
