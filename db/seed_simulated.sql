-- Updated Seed: Aurelis Cloud Ops (IT + GDPR) primary workspace + Meridian Bank & Nordic Health examples
INSERT INTO tenants (id, name, sector_tag, default_region, retention_days)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Aurelis Cloud Ops', 'it', 'ap-south-1', 7),
  ('22222222-2222-4222-8222-222222222222', 'Meridian Bank Ltd', 'banking', 'ap-south-1', 30),
  ('33333333-3333-4333-8333-333333333333', 'Nordic Health Systems', 'healthcare', 'eu-central-1', 14)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sites (id, tenant_id, name, region, timezone, sector_tag, status, last_seen_utc)
VALUES
  ('aaaa1111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Bengaluru Office', 'ap-south-1', 'Asia/Kolkata', 'it', 'connected', NOW() AT TIME ZONE 'UTC'),
  ('aaaa2222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Mumbai Data Center', 'ap-south-1', 'Asia/Kolkata', 'it', 'connected', NOW() AT TIME ZONE 'UTC'),
  ('aaaa3333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Frankfurt Cloud Hub', 'eu-central-1', 'Europe/Berlin', 'it', 'degraded', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (id) DO NOTHING;
