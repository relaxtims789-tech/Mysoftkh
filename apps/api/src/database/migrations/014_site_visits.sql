-- Website visitor counter (seen only by the super admin). One row per page view on the public website.
-- No IP address or personal data: "visitor" is a keyed hash of a random id the browser keeps in local storage.
CREATE TABLE site_visits (
  id          bigserial PRIMARY KEY,
  visited_at  timestamptz NOT NULL DEFAULT now(),
  day         date NOT NULL,          -- Phnom Penh date
  visitor     text NOT NULL,
  path        text NOT NULL,
  referrer    text,                   -- referring site (host only), NULL when typed in / bookmarked
  lang        text,
  device      text NOT NULL DEFAULT 'desktop' CHECK (device IN ('mobile', 'tablet', 'desktop')),
  host        text
);
CREATE INDEX site_visits_day ON site_visits (day);
CREATE INDEX site_visits_time ON site_visits (visited_at);
CREATE INDEX site_visits_visitor ON site_visits (visitor, path, visited_at);
