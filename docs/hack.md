# مدل تهدید و سناریوهای حمله

| سناریو | دفاع فعلی | ریسک باقی‌مانده |
|---|---|---|
| جعل ورود تلگرام | HMAC + سن + constant-time | نشت bot token = جعل کامل ⇒ بلافاصله `/revoke` در BotFather |
| ارسال هم‌زمان یک quote (double-spend) | `orders.quote_id UNIQUE` + rollback batch | — |
| برداشت بیش از موجودی (race) | CHECK ≥ 0 داخل batch | — |
| تایید دو‌باره واریز | ایندکس unique ledger + شرط `status='pending'` | — |
| replay واریز on-chain | `deposits.tx_hash UNIQUE` | — |
| واریز بدون memo / memo اشتباه | ثبت `deposit.unmatched` در audit، اعتبار داده نمی‌شود | نیاز به بازیابی دستی |
| ادمین سوءاستفاده‌گر | four-eyes، audit، **ارسال واقعی خارج از سیستم** | ادمین دوم/تایید دوگانه واقعی توصیه می‌شود |
| دستکاری قیمت (feed آلوده) | رد جهش >۲۵٪، توقف در کهنگی | منبع واحد (CoinGecko)؛ منبع دوم اضافه کنید |
| آپلود فایل مخرب (SVG/HTML) | فقط JPEG/PNG/WebP با magic bytes | — |
| XSS ⇒ سرقت توکن | بدون innerHTML | CSP اضافه شود |
| برداشت به آدرس مهاجم پس از ربایش حساب | تایید دستی، سقف روزانه | ربایش حساب تلگرام؛ تاخیر/ایمیل تایید برای آدرس جدید را بررسی کنید |
| اختلاف حسابداری | reconcile هر ۱۰ دقیقه + هشدار | — |
| DoS | rate limit KV + Cloudflare | قوانین WAF لازم |

## تمرین‌های پیشنهادی (red-team)
۱) ۱۰۰ درخواست هم‌زمان `POST /orders` با یک quote. ۲) برداشت هم‌زمان cancel/approve/reject. ۳) آپلود `.html` با پسوند jpg. ۴) JWT با `alg:none`. ۵) توکن کاربر مسدود‌شده.
(موارد ۳ تا ۵ و بخشی از ۱–۲ در تست‌ها پوشش داده شده‌اند.)
