-- Telegram QR code shown in "Talk to us" on the website (uploaded by the super admin; the built-in MySoft QR when empty).
ALTER TABLE platform_settings ADD COLUMN sales_telegram_qr text;
-- MySoft's own Telegram, so the website contact works out of the box (change it in Plans & settings).
UPDATE platform_settings SET sales_telegram = '@mysoftkh' WHERE sales_telegram IS NULL OR sales_telegram = '';
