# امنیت

## کنترل‌های پیاده‌شده در کد
- امضای تلگرام (HMAC) با مقایسه constant-time و محدودیت سن؛ JWT فقط HS256.
- ledger اتمیک + CHECK + ایندکس‌های unique (بدون race در واریز/برداشت/quote).
- حساب مسدود با هر درخواست بررسی می‌شود.
- **Four-eyes**: ادمین نمی‌تواند برداشت یا KYC خودش را پردازش کند.
- همه اقدامات ادمین و مشاهده KYC در `audit_log` ثبت می‌شود.
- KYC: فیلدهای متنی AES-256-GCM، کد ملی blind-index (HMAC)، تصاویر در R2 خصوصی، نوع فایل از **magic bytes** (نه Content-Type)، سقف ۵MB، پاسخ ادمین با `nosniff` و `no-store`.
- ورودی: اعتبارسنجی آدرس TON (CRC16)، شبا (mod-97)، کد ملی، مقادیر با regex و حدود؛ بدنه JSON حداکثر ۶۴KB.
- هدرها: `X-Content-Type-Options`, `Cache-Control: no-store`, `Referrer-Policy`, `CORP`.
- فرانت: بدون `innerHTML`؛ ریدایرکت `next` فقط مسیر داخلی.
- `dev-login` در production وجود ندارد (۴۰۴).
- Rate limit (KV): ورود، quote، سفارش، برداشت، KYC، IP — **best effort** (KV سازگاری نهایی دارد).

## باید خودتان اضافه کنید
1. **CSP** روی assets (فایل `_headers` در `frontend/`): `default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; frame-src https://oauth.telegram.org; img-src 'self' blob: data:` — `unsafe-inline` به‌خاطر اسکریپت‌های inline صفحات است؛ برای سخت‌تر کردن، آن‌ها را به فایل جدا ببرید.
2. WAF و rate limit واقعی Cloudflare روی `/api/*` (قوانین Rate Limiting).
3. نگهداری کلید ارسال TON در **کیف سرد/چندامضایی** خارج از Worker.
4. چرخش secretها و تست بازیابی KYC key.
5. ارزیابی امنیتی/pentest مستقل قبل از پول واقعی.

## گزارش آسیب‌پذیری
یک ایمیل/کانال خصوصی تعیین و در README اعلام کنید.
