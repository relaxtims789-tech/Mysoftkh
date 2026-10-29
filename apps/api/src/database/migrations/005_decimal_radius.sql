-- Allowed radius may be small and have decimals: 0.50 m up to 5000 m (two decimals).
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_radius_check;
ALTER TABLE branches ALTER COLUMN radius TYPE numeric(7,2) USING radius::numeric(7,2);
ALTER TABLE branches ADD CONSTRAINT branches_radius_check CHECK (radius BETWEEN 0.5 AND 5000);

ALTER TABLE attendance_rules DROP CONSTRAINT IF EXISTS attendance_rules_geofence_radius_check;
ALTER TABLE attendance_rules ALTER COLUMN geofence_radius TYPE numeric(7,2) USING geofence_radius::numeric(7,2);
ALTER TABLE attendance_rules ADD CONSTRAINT attendance_rules_geofence_radius_check CHECK (geofence_radius BETWEEN 0.5 AND 5000);
