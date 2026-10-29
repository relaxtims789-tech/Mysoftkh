-- A long-lived, httpOnly "device cookie" per registered phone. If the browser loses the phone's key (some iPhone
-- browsers cannot keep it, or storage is cleared) but still sends this cookie, the server re-links the same phone
-- to its new key without asking an admin again.
ALTER TABLE devices ADD COLUMN device_token_hash text;
ALTER TABLE devices ADD COLUMN rekeyed_at timestamptz;
CREATE UNIQUE INDEX devices_token_uq ON devices (device_token_hash) WHERE device_token_hash IS NOT NULL;
