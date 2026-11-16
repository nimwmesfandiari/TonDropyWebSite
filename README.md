# TonDropy — صرافی TON / USDT / تومان

صرافی مبتنی بر تلگرام برای خرید و فروش TON و USDT با تومان. کل پروژه روی **Cloudflare Workers** اجرا می‌شود: فرانت‌اند به‌صورت static assets و API در همان Worker.

| بخش | فناوری |
|---|---|
| API | Cloudflare Worker (ES modules، بدون وابستگی runtime) |
| دیتابیس | Cloudflare D1 (SQLite) با ledger دوطرفه |
| کش/نرخ‌ها/Rate limit | Workers KV |
| فایل‌های KYC | R2 (خصوصی) + رمزنگاری AES-GCM برای فیلدهای متنی |
| ورود | Telegram Mini App / Login Widget (امضای HMAC) |
| فرانت | HTML + ES modules + CSS خالص، RTL فارسی |

## شروع سریع (محلی)

```bash
npm install
cp .dev.vars.example .dev.vars          # مقادیر را پر کنید
npx wrangler d1 create tondropy         # id را در wrangler.toml بگذارید
npx wrangler kv namespace create KV     # id را در wrangler.toml بگذارید
npm run db:migrate:local
npm run dev                             # http://localhost:8787
npm test                                # ۲۴ تست
npm run check                           # بررسی سینتکس همه فایل‌ها
```

در `ENVIRONMENT=development` صفحه ورود یک ورود آزمایشی دارد. برای نرخ تومان، یک‌بار به‌عنوان ادمین `PUT /api/v1/admin/rates` (یا کادر «نرخ USDT» در صفحه مدیریت) را بزنید.

## ساختار

```
backend/src      index.js، router، routes/*، services/*، jobs/*، lib/*
backend/migrations   اسکیمای D1
backend/test     تست‌ها (واحد + جریان کامل روی SQL واقعی)
frontend         index.html، pages/*، assets/{css,js}
docs             معماری، API، امنیت، استقرار، چک‌لیست
scripts          check-syntax، تولید secretها
```

## ⚠️ قبل از انتشار عمومی

این کد یک **زیرساخت کامل و تست‌شده** است، اما استقرار روی پول واقعی نیازمند کارهای غیرنرم‌افزاری و تایید نهایی است:
مجوز/الزامات قانونی فعالیت صرافی، تست کامل واریز on-chain روی testnet، ارزیابی امنیتی مستقل و تامین نقدینگی. فهرست کامل در [`docs/checklist.md`](docs/checklist.md).
