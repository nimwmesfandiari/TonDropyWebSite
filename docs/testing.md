# تست

```bash
npm test          # node:test، ۲۴ تست
npm run check     # سینتکس همه JS و اسکریپت‌های inline صفحات
```

## لایه‌ها
| فایل | پوشش |
|---|---|
| `money.test.js` | تجزیه/قالب پول، گرد کردن به نفع خانه، spread، نرخ متقاطع، سقف عدد |
| `crypto.test.js` | JWT (دستکاری، انقضا، `alg:none`)، AES-GCM، blind index، امضای initData/Widget |
| `validate.test.js` | آدرس TON، شبا، کد ملی، تاریخ/سن، magic bytes |
| `flow.test.js` | **Worker واقعی + مایگریشن SQL واقعی** (`helpers/d1.js` روی `node:sqlite`): KYC → واریز → خرید/فروش → برداشت (لغو/تایید/تکمیل) → reconcile؛ replay quote، overdraft، واریز دوباره، رفرال، مسدودسازی، آپلود مخرب، کد ملی تکراری |

## محدودیت‌های شناخته‌شده
- شبیه‌ساز D1 تک‌thread است؛ **هم‌زمانی واقعی** (race روی D1) را ثابت نمی‌کند. تضمین‌ها به قیود SQL تکیه دارند، اما قبل از انتشار تست بار روی staging بزنید.
- `jobs/deposits.js` فقط با ساختار مستند Toncenter نوشته شده و **با تراکنش واقعی testnet تست نشده**.
- فرانت‌اند تست خودکار UI ندارد (فقط بررسی سینتکس/ایمپورت). تست دستی یا Playwright اضافه کنید.

## افزودن تست
هر endpoint مالی جدید باید حداقل یک تست «جریان» و یک تست شکست (overdraft/replay) داشته باشد و در پایان `reconcile(env)` خالی باشد.
