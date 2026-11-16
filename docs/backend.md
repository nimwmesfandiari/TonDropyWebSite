# بک‌اند

نقطه ورود: `backend/src/index.js`. مسیرهای `/api/v1/*` به Worker می‌رسند و بقیه به static assets.

| پوشه | محتوا |
|---|---|
| `routes/` | `auth`, `market`, `wallet`, `orders`, `verification`, `referral`, `notifications`, `telegram`, `admin` — هر کدام `register(router)` |
| `services/` | `users.js` (ایجاد کاربر/ادمین/رفرال)، `telegram.js` (Bot API) |
| `jobs/` | `prices.js`، `deposits.js`، `housekeeping.js` (cleanup، reconcile، هشدار برداشت معطل) |
| `lib/` | `money`، `ledger`، `crypto` (JWT/HMAC)، `fieldcrypto` (AES-GCM)، `pricing`، `telegram-auth`، `validate`، `ton`، `iban`، `ratelimit`، `http`، `errors` |
| `config.js` | سقف‌ها و محدودیت‌ها (واحد کامل، نه واحد کوچک) |

## قرارداد route

```js
r.post('/path', async (c) => ok(data), { auth: true | 'admin' });
// c = { request, env, ectx, url, params, user }
```

خطاها با `HttpError` پرتاب و به JSON `{ ok:false, error:{code,message} }` تبدیل می‌شوند؛ خطای ناشناخته 500 عمومی است و جزئیات فقط در لاگ می‌ماند.

## قواعد برای تغییر کد

- هر تغییر موجودی **فقط** با `move()` در `lib/ledger.js` و داخل `DB.batch`.
- هرگز Number برای ضرب/تقسیم پولی؛ از `lib/money.js` استفاده کنید.
- وضعیت‌ها را با `UPDATE ... WHERE status = '...'` و ایندکس‌های unique محافظت کنید، نه با خواندن-سپس-نوشتن.
