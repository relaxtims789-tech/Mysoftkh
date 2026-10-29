-- Sign in with a phone number as well as email / employee ID.
-- phone      = as typed (shown in the admin)
-- phone_norm = digits with the country code, e.g. 012 345 678 -> 85512345678 (what log-in compares)
ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD COLUMN phone_norm text;
CREATE INDEX users_phone_norm_idx ON users (phone_norm) WHERE phone_norm IS NOT NULL;

-- Employees' log-ins take the phone number from their employee record (Cambodian numbers: 0xx -> 855xx).
UPDATE users u
   SET phone = e.phone,
       phone_norm = CASE
         WHEN d LIKE '00%' THEN substr(d, 3)
         WHEN d LIKE '0%' THEN '855' || substr(d, 2)
         ELSE d
       END
  FROM employees e,
       LATERAL (SELECT regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') AS d) x
 WHERE u.employee_id = e.id AND length(x.d) BETWEEN 8 AND 15;
