# پشتیبان‌گیری و بازیابی

## D1
- **Time Travel**: بازگردانی به هر لحظه در ۳۰ روز اخیر: `npx wrangler d1 time-travel restore tondropy --timestamp=<ISO>`.
- **Export دوره‌ای**: `npx wrangler d1 export tondropy --remote --output=backup-$(date +%F).sql` — حداقل روزانه، **رمزنگاری‌شده و خارج از Cloudflare** نگه دارید (شامل داده‌های KYC رمزنگاری‌شده است).

## R2 (تصاویر KYC)
کپی دوره‌ای به یک bucket دوم/ارائه‌دهنده دیگر (rclone). رمزنگاری سمت-سرور را فعال نگه دارید.

## Secrets
`KYC_ENCRYPTION_KEY` و `KYC_HASH_KEY` را در password manager/گاوصندوق جدا ذخیره کنید. **بدون KYC_ENCRYPTION_KEY داده KYC برگشت‌ناپذیر است.** با تغییر `KYC_HASH_KEY` تشخیص کد ملی تکراری از کار می‌افتد.

## تمرین بازیابی
هر فصل: بازیابی export روی یک D1 آزمایشی، اجرای `reconcile` و بررسی اینکه خروجی خالی است.

## بعد از بازیابی Time Travel
تراکنش‌های بین نقطه بازیابی و حادثه گم می‌شوند: واریزهای on-chain را با cursor (`kv_state`) دوباره اسکن کنید (cursor را به قبل از نقطه بازگردانید؛ `tx_hash UNIQUE` از اعتبار مضاعف جلوگیری می‌کند) و برداشت‌های ارسال‌شده را با ledger مقایسه کنید.
