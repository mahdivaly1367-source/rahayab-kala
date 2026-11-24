رفع مشکل گیرکردن پیام «در حال دریافت تصویر»

علت اصلی در رابط کاربری این بود که تصویر با loading="lazy" ساخته می‌شد اما هم‌زمان hidden بود (display:none). در بعضی نسخه‌های Chromium این ترکیب باعث می‌شود بارگذاری تنبل شروع نشود و رویداد load نیز رخ ندهد.

این اصلاح:
- تصویر را از ابتدا با جعبهٔ قابل‌اندازه‌گیری در صفحه نگه می‌دارد و فقط با opacity مخفی می‌کند.
- پس از موفقیت، تصویر را نمایش می‌دهد.
- اگر مسیر واسط محلی خطا بدهد، یک‌بار بارگذاری مستقیم از میزبان مجاز تصویر را امتحان می‌کند.
- اگر هر دو روش شکست بخورند، به‌جای چرخیدن دائمی پیام خطا نشان داده می‌شود.

روش نصب:
1. فایل ZIP اصلاح تصاویر را در Downloads ذخیره کنید.
2. PowerShell را باز کنید و دستور زیر را اجرا کنید:

$project = "$HOME\Downloads\rahayab-kala-live-search\rahayab-kala-live-search"
$patch = "$HOME\Downloads\rahayab-kala-image-loading-fix.zip"
if (!(Test-Path "$project\server.js")) { throw "Project folder not found: $project" }
if (!(Test-Path $patch)) { throw "Patch ZIP not found: $patch" }
Expand-Archive -LiteralPath $patch -DestinationPath $project -Force
Start-Process "http://127.0.0.1:4173"

3. در مرورگر Ctrl+F5 بزنید تا صفحه با فایل جدید دوباره بارگذاری شود.

این وصله فقط رابط بارگذاری تصویر را تغییر می‌دهد؛ به API رسمی یا منبع جدید داده متصل نمی‌شود. اگر بعد از این اصلاح متن «تصویر بارگذاری نشد» ظاهر شد، یعنی درخواست تصویر خطا می‌دهد و باید وضعیت اتصال به میزبان تصویر/گزارش سرور بررسی شود.
