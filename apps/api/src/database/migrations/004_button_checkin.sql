-- Check-in / check-out with a button on the phone, without scanning the QR (company setting, off by default).
-- GPS geofence (nearest branch) and phone binding still apply. Records get source 'button'.
ALTER TABLE attendance_rules ADD COLUMN allow_button_checkin boolean NOT NULL DEFAULT false;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_source_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_source_check
  CHECK (source IN ('qr', 'button', 'manual', 'correction', 'zkteco', 'face', 'import'));
