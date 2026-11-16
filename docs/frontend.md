# فرانت‌اند

HTML + ES modules بدون build. فارسی و RTL، تم روشن/تیره خودکار با `prefers-color-scheme`.

- **`assets/js/app.js`**: `h()` سازنده DOM امن (متن همیشه text node؛ هرگز `innerHTML`)، `boot()` (guard لاگین + هدر + init)، toast، فرمت اعداد/تاریخ (Asia/Tehran).
- **`api.js`**: `fetch` به `/api/v1`، توکن در `sessionStorage`، تبدیل کد خطا به پیام فارسی (`config.js → ERROR_FA`). ۴۰۱ ⇒ پاک کردن نشست و ریدایرکت به ورود.
- **`auth.js`**: ورود Mini App، Login Widget، ریدایرکت `next` فقط به مسیرهای هم‌مبدأ.
- **`market.js` / `orders.js` / `wallet.js` / `referral.js` / `notifications.js`**: کامپوننت‌های هر صفحه.
- **فونت**: `Vazirmatn.woff2` را در `assets/fonts/` قرار دهید (در مخزن نیست؛ بدون آن فونت سیستم استفاده می‌شود).

## قراردادها

- مقادیر پولی از API به‌صورت **رشته اعشاری** می‌آیند؛ در UI فقط نمایش داده می‌شوند (مبدل صفحه converter تقریبی و فقط نمایشی است).
- هر صفحه یک `data-page` دارد که آیتم فعال منو را تعیین می‌کند.
- نتیجه نهایی همیشه از سرور است؛ فرانت هیچ تصمیم مالی نمی‌گیرد.
