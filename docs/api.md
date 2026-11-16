# مرجع API — `/api/v1`

پاسخ موفق: `{ "ok": true, "data": … }`  •  خطا: `{ "ok": false, "error": { "code", "message" } }`
احراز هویت: `Authorization: Bearer <JWT>`. مقادیر پولی رشته اعشاری هستند.

## عمومی
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/market/prices` | قیمت خرید/فروش/میانی هر جفت (`available:false` اگر منبع قیمت کهنه باشد) |
| GET | `/market/config` | کارمزد، TTL، محدودیت‌ها، نام ربات |
| POST | `/auth/telegram` | `{initData}` ورود Mini App |
| POST | `/auth/telegram-widget` | `{widget, ref?}` |
| POST | `/auth/dev-login` | فقط `ENVIRONMENT=development` |
| POST | `/telegram/webhook` | با هدر secret تلگرام |

## کاربر (نیازمند ورود)
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/auth/me` | |
| GET | `/wallet` · `/wallet/deposit-info` · `/wallet/history` | |
| POST | `/wallet/deposits/fiat` | `{amount, reference}` ثبت واریز کارت‌به‌کارت |
| POST | `/wallet/withdrawals` | `{asset, amount, destination, memo?}` (نیاز KYC ≥ ۱) |
| POST | `/wallet/withdrawals/:id/cancel` | فقط pending |
| POST | `/orders/quote` | `{pair, side, amount}` ← quote |
| POST | `/orders` | `{quoteId}` اجرای اتمیک |
| GET | `/orders` · `/orders/:id` | |
| GET/POST | `/verification` | POST چندبخشی: `fullName, nationalId, birthDate, idCard, selfie` |
| GET | `/referral` | |
| GET/POST | `/notifications` · `/notifications/read` | |

## مدیر (`role = admin`)
`GET /admin/stats` • `PUT /admin/rates` • `GET /admin/deposits|withdrawals|kyc|users|audit`
`POST /admin/deposits/:id/approve|reject` • `/admin/withdrawals/:id/approve|reject|complete`
`GET /admin/kyc/:id` · `/admin/kyc/:id/image?which=idCard|selfie` • `POST /admin/kyc/:id/approve|reject` • `POST /admin/users/:id/status`

## کدهای خطای مهم
`unauthorized 401` • `account_frozen 403` • `kyc_required 403` • `insufficient_funds 409` • `quote_expired 410` • `quote_used 409` • `price_unavailable 503` • `rate_limited 429` • `daily_limit 400` • `invalid_destination 400`
