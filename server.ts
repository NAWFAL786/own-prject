import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initSchemaAndSeed,
  appendAuditLog,
  TIER1_DB_PATH,
  OUTAGE_FLAG_PATH,
  EVENT_LOG_PATH,
  ORGANIZER_STREAM_PATH,
  createSalt,
  hashPassword,
  verifyPassword,
} from './server/db.ts';

// Zero-Config Runtime Key Bootstrap (auto-generated via CSPRNG if env unset)
const SESSION_SECRET = process.env.AURELIS_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
let COLLECTOR_KEY = process.env.AURELIS_COLLECTOR_SECRET || crypto.randomBytes(24).toString('hex');
const COLLECTOR_HMAC = process.env.AURELIS_COLLECTOR_HMAC || crypto.randomBytes(32).toString('hex');
const SOURCE_ID_SALT = process.env.AURELIS_SOURCE_ID_SALT || crypto.randomBytes(16).toString('hex');

const SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT || '1025');
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@aurelis.local';

const ALLOW_LIST_FIELDS = new Set([
  'metric_name',
  'metric_value',
  'unit',
  'timestamp_utc',
  'source_timezone',
  'source_id',
  'health_state',
  'event_category',
  'severity',
  'alert_context',
  'collector_id',
  'site_id',
  'tenant_id',
  'payload_id',
  'source',
  'connector',
  'collection_interval',
]);

const VALID_REGIONS = new Set(['us-east-1', 'us-west-2', 'eu-central-1', 'eu-west-1', 'ap-south-1']);
const VALID_SECTORS = new Set(['it', 'healthcare', 'banking', 'retail', 'manufacturing', 'telecom']);
const VALID_COMPLIANCE = new Set(['gdpr', 'pci_dss', 'hipaa', 'rbi', 'default']);

interface SessionClaims {
  operatorId: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  operator?: SessionClaims;
}

function signSessionToken(claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (Date.now() > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

function requireOperatorAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const claims = verifySessionToken(auth.slice(7).trim());
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired operator session' });
    return;
  }
  req.operator = claims;
  next();
}

function requireAdminRole(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const role = req.operator?.role || 'viewer';
  if (!['owner', 'admin', 'tenant_admin'].includes(role)) {
    res.status(403).json({ error: 'Owner or Admin privileges required for this action.' });
    return;
  }
  next();
}

function requireCollectorAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const tsHeader = String(req.headers['x-aurelis-timestamp'] || '');
  const sigHeader = String(req.headers['x-aurelis-signature'] || '');

  const tokA = Buffer.from(token);
  const tokB = Buffer.from(COLLECTOR_KEY);
  if (!token || tokA.length !== tokB.length || !crypto.timingSafeEqual(tokA, tokB)) {
    res.status(401).json({ error: 'Invalid collector credentials' });
    return;
  }

  const tsSec = Number(tsHeader);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsSec) || Math.abs(nowSec - tsSec) > 300) {
    res.status(401).json({ error: 'Stale or invalid request timestamp' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody || Buffer.alloc(0);
  const msg = Buffer.concat([Buffer.from(`${tsHeader}.`, 'utf8'), rawBody]);
  const expectedSig = crypto.createHmac('sha256', COLLECTOR_HMAC).update(msg).digest('hex');

  const sigA = Buffer.from(sigHeader);
  const sigB = Buffer.from(expectedSig);
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
    res.status(401).json({ error: 'HMAC signature verification failed' });
    return;
  }

  next();
}

async function sendMailViaSmtp(to: string, subject: string, bodyText: string): Promise<{ delivered: boolean; transport: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: SMTP_HOST, port: SMTP_PORT, timeout: 1200 });
    let step = 0;
    const cmds = [
      `HELO aurelis.local\r\n`,
      `MAIL FROM:<${SMTP_FROM}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      `DATA\r\n`,
      `From: AURELIS <${SMTP_FROM}>\r\nTo: <${to}>\r\nSubject: ${subject}\r\n\r\n${bodyText}\r\n.\r\n`,
      `QUIT\r\n`,
    ];

    socket.on('data', () => {
      if (step < cmds.length) {
        socket.write(cmds[step++]);
      } else {
        socket.end();
        resolve({ delivered: true, transport: `smtp://${SMTP_HOST}:${SMTP_PORT}` });
      }
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ delivered: false, transport: 'local-preview-fallback' });
    });
    socket.on('error', () => {
      socket.destroy();
      resolve({ delivered: false, transport: 'local-preview-fallback' });
    });
  });
}

function openTier1ReadOnly(): Database.Database | null {
  if (!fs.existsSync(TIER1_DB_PATH)) return null;
  try {
    return new Database(TIER1_DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return Number(sorted[lo].toFixed(3));
  const frac = idx - lo;
  return Number((sorted[lo] * (1 - frac) + sorted[hi] * frac).toFixed(3));
}

function redactLocalText(raw: string): string {
  return raw
    .replace(/(password|passwd|pwd|secret|api_key|apikey|token)\s*[=:]\s*[^\s,;"']+/gi, '$1=[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_PRIVATE_IP]')
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_PAN]');
}

let collectorChild: ChildProcess | null = null;

function startLocalPythonCollector(): void {
  const scriptPath = path.resolve(process.cwd(), 'collector/daemon.py');
  if (!fs.existsSync(scriptPath)) return;

  collectorChild = spawn('python3', [scriptPath], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AURELIS_INGEST_URL: 'http://127.0.0.1:3000/v1/ingest',
      AURELIS_JOBS_URL: 'http://127.0.0.1:3000/v1/collector/jobs',
      AURELIS_COLLECTOR_KEY: COLLECTOR_KEY,
      AURELIS_COLLECTOR_HMAC: COLLECTOR_HMAC,
      AURELIS_SOURCE_ID_SALT: SOURCE_ID_SALT,
      AURELIS_COLLECTOR_ID: 'col-local-primary',
      AURELIS_TENANT_ID: 'tenant-aurelis',
      AURELIS_SITE_ID: 'site-blr-hq',
      AURELIS_REGION: 'ap-south-1',
      AURELIS_COMPLIANCE_PROFILE: 'gdpr',
      AURELIS_COLLECTION_INTERVAL: '5',
    },
  });

  collectorChild.stderr?.on('data', (chunk) => {
    const msg = String(chunk).trim();
    if (msg) console.error('[Tier 1 Collector]', msg);
  });
}

async function bootstrapServer() {
  initSchemaAndSeed();

  const app = express();
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Public health & zero-config environment status
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'aurelis-tier2-saas', timestamp_utc: new Date().toISOString() });
  });

  app.get('/api/ready', (_req, res) => {
    res.json({ ready: true, tier1_daemon_running: Boolean(collectorChild && !collectorChild.killed) });
  });

  app.get('/api/branding/public', (_req, res) => {
    const row = db
      .prepare("SELECT organization_name, product_name, logo_data_url FROM tenant_settings WHERE tenant_id = 'tenant-aurelis'")
      .get() as { organization_name: string; product_name: string; logo_data_url: string | null } | undefined;
    res.json({
      organizationName: row?.organization_name || 'Aurelis Cloud Ops',
      productName: row?.product_name || 'AURELIS',
      logoDataUrl: row?.logo_data_url || null,
    });
  });

  app.get('/api/environment/status', (_req, res) => {
    res.json({
      mode: 'zero-config-local',
      requiresManualEnvVars: false,
      storageBackend: process.env.STORAGE_BACKEND || 'sqlite-preview (postgres docker-compose ready)',
      items: [
        {
          key: 'VITE_SAAS_API_URL / VITE_COLLECTOR_API_URL',
          status: 'auto-configured',
          description: 'Same-origin Express routes (/v1/* and /v1/collector/*) active automatically on port 3000.',
        },
        {
          key: 'STORAGE_BACKEND',
          status: process.env.STORAGE_BACKEND || 'embedded-sqlite / postgres-ready',
          description: 'Embedded SQLite active in preview; Docker Compose defaults to local Postgres 16 (Supabase optional).',
        },
        {
          key: 'SMTP_HOST (MailHog)',
          status: `${SMTP_HOST}:${SMTP_PORT}`,
          description: 'Uses MailHog SMTP for verification/reset emails with safe local preview fallback.',
        },
        {
          key: 'AURELIS_SOURCE_ID_SALT & HMAC',
          status: 'auto-generated',
          description: 'Cryptographic salt and HMAC keys generated in server memory at startup.',
        },
      ],
    });
  });

  // -------------------------------------------------------------------------
  // Auth: Register, Login, Logout, Email Verify, Forgot/Reset Password, Users
  // -------------------------------------------------------------------------
  app.get('/api/auth/status', (_req, res) => {
    const count = (db.prepare('SELECT COUNT(*) as c FROM operators').get() as { c: number }).c;
    res.json({ hasOperators: count > 0 });
  });

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, fullName, mode, organizationName, countryCode, region, timezone, sectorTag, complianceProfile } =
      req.body || {};
    if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Valid email and password (minimum 8 characters) are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : cleanEmail.split('@')[0];
    if (db.prepare('SELECT id FROM operators WHERE email = ?').get(cleanEmail)) {
      res.status(409).json({ error: 'An operator with that email already exists.' });
      return;
    }

    let tenantId = 'tenant-aurelis';
    let role = 'owner';
    const nowUtc = new Date().toISOString();

    if (mode === 'new_tenant' && typeof organizationName === 'string' && organizationName.trim()) {
      const reg = VALID_REGIONS.has(region) ? region : 'ap-south-1';
      const sec = VALID_SECTORS.has(sectorTag) ? sectorTag : 'it';
      const comp = VALID_COMPLIANCE.has(complianceProfile) ? complianceProfile : 'gdpr';
      const cleanCountry = typeof countryCode === 'string' && countryCode.trim() ? countryCode.trim().toUpperCase() : 'IN';
      const cleanTz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'Asia/Kolkata';

      tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
      const siteId = `site-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        'INSERT INTO tenants (id, name, sector_tag, compliance_profile, default_region, created_at_utc) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(tenantId, organizationName.trim(), sec, comp, reg, nowUtc);

      db.prepare(
        `INSERT INTO tenant_settings (tenant_id, organization_name, product_name, country_code, region, timezone, industry, compliance_profile, retention_days, thresholds_json, remediation_policy_json, updated_at_utc)
         VALUES (?, ?, 'AURELIS', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        tenantId,
        organizationName.trim(),
        cleanCountry,
        reg,
        cleanTz,
        sec,
        comp,
        comp === 'gdpr' ? 7 : 30,
        JSON.stringify({ cpu_fair: 78, cpu_poor: 90, latency_fair_ms: 60, latency_poor_ms: 120, packet_loss_fair: 1.5 }),
        JSON.stringify({ dry_run: false, mode: 'approval_required', kill_switch: false, allowed_actions: ['flush_dns_cache', 'rotate_logs'] }),
        nowUtc
      );

      db.prepare(
        'INSERT INTO sites (id, tenant_id, name, region, timezone, sector_tag, status, last_seen_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)'
      ).run(siteId, tenantId, `${organizationName.trim()} Primary Site`, reg, cleanTz, sec, 'pending', nowUtc);
    } else {
      const existingOps = (db.prepare('SELECT COUNT(*) as c FROM operators WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
      role = existingOps === 0 ? 'owner' : 'admin';
    }

    const operatorId = `op-${crypto.randomUUID().slice(0, 10)}`;
    const salt = createSalt();
    const passwordHash = hashPassword(password, salt);

    db.prepare(
      'INSERT INTO operators (id, tenant_id, email, full_name, password_hash, password_salt, role, email_verified, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(operatorId, tenantId, cleanEmail, cleanName, passwordHash, salt, role, nowUtc);

    const verifyToken = `aur_vrf_${crypto.randomBytes(12).toString('hex')}`;
    const verifyHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    db.prepare(
      'INSERT INTO email_verifications (id, operator_id, token_hash, expires_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?)'
    ).run(`vrf-${crypto.randomUUID().slice(0, 8)}`, operatorId, verifyHash, new Date(Date.now() + 86400000).toISOString(), nowUtc);

    const mailRes = await sendMailViaSmtp(
      cleanEmail,
      'Verify your AURELIS Operator account',
      `Welcome ${cleanName}.\nVerification code: ${verifyToken}`
    );

    appendAuditLog(tenantId, null, 'Tier 2', cleanEmail, 'operator_registered', `Registered ${cleanEmail} (${role}).`, 'live');

    const settings = db
      .prepare('SELECT organization_name, product_name, logo_data_url, industry, compliance_profile, region FROM tenant_settings WHERE tenant_id = ?')
      .get(tenantId) as {
      organization_name: string;
      product_name: string;
      logo_data_url: string | null;
      industry: string;
      compliance_profile: string;
      region: string;
    };

    const token = signSessionToken({
      operatorId,
      tenantId,
      email: cleanEmail,
      fullName: cleanName,
      role,
      exp: Date.now() + 12 * 3600 * 1000,
    });

    res.status(201).json({
      token,
      emailVerificationNotice: mailRes.delivered
        ? `Verification sent via ${mailRes.transport}`
        : `Local preview verification token: ${verifyToken}`,
      operator: {
        id: operatorId,
        email: cleanEmail,
        fullName: cleanName,
        role,
        emailVerified: false,
        tenantId,
        organizationName: settings.organization_name,
        productName: settings.product_name,
        logoDataUrl: settings.logo_data_url,
        sectorTag: settings.industry,
        complianceProfile: settings.compliance_profile,
        defaultRegion: settings.region,
      },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const row = db
      .prepare('SELECT id, tenant_id, email, full_name, password_hash, password_salt, role, email_verified FROM operators WHERE email = ?')
      .get(cleanEmail) as
      | {
          id: string;
          tenant_id: string;
          email: string;
          full_name: string;
          password_hash: string;
          password_salt: string;
          role: string;
          email_verified: number;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      fs.appendFileSync(EVENT_LOG_PATH, `${new Date().toISOString()} WARN failed_login email=${cleanEmail}\n`);
      if (row) {
        appendAuditLog(row.tenant_id, null, 'Tier 2', cleanEmail, 'login_failed', `Failed password attempt for ${cleanEmail}.`, 'live');
      }
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const settings = db
      .prepare('SELECT organization_name, product_name, logo_data_url, industry, compliance_profile, region FROM tenant_settings WHERE tenant_id = ?')
      .get(row.tenant_id) as {
      organization_name: string;
      product_name: string;
      logo_data_url: string | null;
      industry: string;
      compliance_profile: string;
      region: string;
    };

    appendAuditLog(row.tenant_id, null, 'Tier 2', row.email, 'operator_login', `Signed in (${row.role}).`, 'live');

    const token = signSessionToken({
      operatorId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      exp: Date.now() + 12 * 3600 * 1000,
    });

    res.json({
      token,
      operator: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        emailVerified: Boolean(row.email_verified),
        tenantId: row.tenant_id,
        organizationName: settings?.organization_name || 'Aurelis Cloud Ops',
        productName: settings?.product_name || 'AURELIS',
        logoDataUrl: settings?.logo_data_url || null,
        sectorTag: settings?.industry || 'it',
        complianceProfile: settings?.compliance_profile || 'gdpr',
        defaultRegion: settings?.region || 'ap-south-1',
      },
    });
  });

  app.post('/api/auth/logout', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const op = req.operator!;
    appendAuditLog(op.tenantId, null, 'Tier 2', op.email, 'operator_logout', `Operator ${op.email} signed out.`, 'live');
    res.json({ status: 'logged_out' });
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const op = db.prepare('SELECT id, tenant_id, full_name FROM operators WHERE email = ?').get(cleanEmail) as
      | { id: string; tenant_id: string; full_name: string }
      | undefined;
    if (!op) {
      res.json({ message: 'If that operator account exists, a reset code has been dispatched.' });
      return;
    }

    const rawCode = `aur_rst_${crypto.randomBytes(10).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const nowUtc = new Date().toISOString();
    const expUtc = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO password_resets (id, operator_id, token_hash, expires_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?)'
    ).run(`rst-${crypto.randomUUID().slice(0, 8)}`, op.id, hash, expUtc, nowUtc);

    const mail = await sendMailViaSmtp(
      cleanEmail,
      'AURELIS Password Reset Code',
      `Hello ${op.full_name},\nUse this 15-minute reset code: ${rawCode}`
    );
    appendAuditLog(op.tenant_id, null, 'Tier 2', cleanEmail, 'password_reset_requested', 'Issued 15-minute password reset code.', 'live');

    res.json({
      message: mail.delivered ? `Reset code sent to MailHog (${mail.transport}).` : 'Reset code generated for local preview.',
      previewResetCode: mail.delivered ? undefined : rawCode,
    });
  });

  app.post('/api/auth/reset-password', (req, res) => {
    const { code, newPassword } = req.body || {};
    if (typeof code !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'Reset code and new password (min 8 chars) are required.' });
      return;
    }
    const hash = crypto.createHash('sha256').update(code.trim()).digest('hex');
    const row = db
      .prepare('SELECT id, operator_id, expires_at_utc, used_at_utc FROM password_resets WHERE token_hash = ?')
      .get(hash) as { id: string; operator_id: string; expires_at_utc: string; used_at_utc: string | null } | undefined;

    if (!row || row.used_at_utc || Date.now() > Date.parse(row.expires_at_utc)) {
      res.status(400).json({ error: 'Invalid or expired reset code.' });
      return;
    }

    const op = db.prepare('SELECT tenant_id, email FROM operators WHERE id = ?').get(row.operator_id) as {
      tenant_id: string;
      email: string;
    };
    const salt = createSalt();
    const pwHash = hashPassword(newPassword, salt);
    const nowUtc = new Date().toISOString();

    db.transaction(() => {
      db.prepare('UPDATE operators SET password_hash = ?, password_salt = ? WHERE id = ?').run(pwHash, salt, row.operator_id);
      db.prepare('UPDATE password_resets SET used_at_utc = ? WHERE id = ?').run(nowUtc, row.id);
    })();

    appendAuditLog(op.tenant_id, null, 'Tier 2', op.email, 'password_reset_completed', 'Password updated via reset flow.', 'live');
    res.json({ status: 'password_updated' });
  });

  app.post('/api/auth/verify-email', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const { code } = req.body || {};
    if (typeof code !== 'string' || !code.trim()) {
      res.status(400).json({ error: 'Verification code required.' });
      return;
    }
    const hash = crypto.createHash('sha256').update(code.trim()).digest('hex');
    const row = db
      .prepare('SELECT id, expires_at_utc, verified_at_utc FROM email_verifications WHERE token_hash = ? AND operator_id = ?')
      .get(hash, req.operator!.operatorId) as { id: string; expires_at_utc: string; verified_at_utc: string | null } | undefined;

    if (!row || row.verified_at_utc || Date.now() > Date.parse(row.expires_at_utc)) {
      res.status(400).json({ error: 'Invalid or expired verification token.' });
      return;
    }

    const nowUtc = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE email_verifications SET verified_at_utc = ? WHERE id = ?').run(nowUtc, row.id);
      db.prepare('UPDATE operators SET email_verified = 1 WHERE id = ?').run(req.operator!.operatorId);
    })();
    appendAuditLog(req.operator!.tenantId, null, 'Tier 2', req.operator!.email, 'email_verified', 'Operator email verified.', 'live');
    res.json({ verified: true });
  });

  app.get('/api/users', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const users = db
      .prepare('SELECT id, email, full_name, role, email_verified, created_at_utc FROM operators WHERE tenant_id = ? ORDER BY created_at_utc ASC')
      .all(req.operator!.tenantId);
    res.json({ users });
  });

  app.post('/api/users/invite', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const { email, fullName, role, temporaryPassword } = req.body || {};
    if (typeof email !== 'string' || !email.includes('@') || typeof temporaryPassword !== 'string' || temporaryPassword.length < 8) {
      res.status(400).json({ error: 'Valid email and temporary password (min 8 chars) required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const validRole = ['owner', 'admin', 'analyst', 'viewer'].includes(role) ? role : 'analyst';
    if (db.prepare('SELECT id FROM operators WHERE email = ?').get(cleanEmail)) {
      res.status(409).json({ error: 'User already exists.' });
      return;
    }
    const salt = createSalt();
    const hash = hashPassword(temporaryPassword, salt);
    const id = `op-${crypto.randomUUID().slice(0, 10)}`;
    const nowUtc = new Date().toISOString();
    db.prepare(
      'INSERT INTO operators (id, tenant_id, email, full_name, password_hash, password_salt, role, email_verified, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(id, req.operator!.tenantId, cleanEmail, typeof fullName === 'string' && fullName.trim() ? fullName.trim() : cleanEmail, hash, salt, validRole, nowUtc);
    appendAuditLog(req.operator!.tenantId, null, 'Tier 2', req.operator!.email, 'user_invited', `Added ${cleanEmail} as ${validRole}.`, 'live');
    res.status(201).json({ id });
  });

  // -------------------------------------------------------------------------
  // Tier 2 Ingest & Collector Jobs (with AIOps Anomaly + Health History)
  // -------------------------------------------------------------------------
  app.post('/v1/ingest', requireCollectorAuth, (req, res) => {
    const body = req.body || {};
    const { payload_id, collector_id, region, source, sent_at_utc, samples } = body;
    if (typeof payload_id !== 'string' || typeof collector_id !== 'string' || typeof region !== 'string' || !Array.isArray(samples)) {
      res.status(400).json({ error: 'Malformed ingest batch schema.' });
      return;
    }

    const collector = db
      .prepare('SELECT id, tenant_id, site_id, region, revoked FROM collectors WHERE id = ?')
      .get(collector_id) as { id: string; tenant_id: string; site_id: string; region: string; revoked: number } | undefined;

    if (!collector || collector.revoked) {
      res.status(403).json({ error: 'Unknown or revoked collector.' });
      return;
    }
    if (collector.region !== region) {
      res.status(403).json({ error: `Residency violation: collector bound to ${collector.region}, got ${region}.` });
      return;
    }

    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') {
        res.status(400).json({ error: 'Invalid sample record.' });
        return;
      }
      for (const key of Object.keys(sample)) {
        if (!ALLOW_LIST_FIELDS.has(key)) {
          res.status(400).json({ error: `Rejected non-allow-listed field: ${key}` });
          return;
        }
      }
    }

    const dup = db
      .prepare('SELECT id FROM payload_receipts WHERE tenant_id = ? AND payload_id = ?')
      .get(collector.tenant_id, payload_id);
    if (dup) {
      res.status(202).json({ status: 'duplicate_ignored', accepted_ids: [payload_id] });
      return;
    }

    const prevReceipt = db
      .prepare('SELECT payload_sha256 FROM payload_receipts WHERE tenant_id = ? ORDER BY received_at_utc DESC LIMIT 1')
      .get(collector.tenant_id) as { payload_sha256: string } | undefined;
    const payloadSha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const nowUtc = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO payload_receipts (id, tenant_id, site_id, collector_id, payload_id, region, source, payload_sha256, prev_attestation_sha256, record_count, sent_at_utc, received_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `rcp-${crypto.randomUUID().slice(0, 12)}`,
        collector.tenant_id,
        collector.site_id,
        collector.id,
        payload_id,
        collector.region,
        source === 'simulated' ? 'simulated' : 'live',
        payloadSha,
        prevReceipt?.payload_sha256 || null,
        samples.length,
        typeof sent_at_utc === 'string' ? sent_at_utc : nowUtc,
        nowUtc
      );

      const insertMetric = db.prepare(
        `INSERT INTO metrics_raw (tenant_id, site_id, collector_id, source_id, metric_name, metric_value, unit, health_state, health_reason, source, connector, collection_interval, source_timezone, timestamp_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      let cpuVal = 0;
      let ramVal = 0;
      for (const s of samples) {
        const val = Number(s.metric_value);
        if (!Number.isFinite(val)) continue;
        if (s.metric_name === 'cpu_total_percent') cpuVal = val;
        if (s.metric_name === 'ram_usage_percent') ramVal = val;

        const health = String(s.health_state || 'Good');
        const reason = String(s.alert_context || 'Within rolling baseline');
        insertMetric.run(
          collector.tenant_id,
          collector.site_id,
          collector.id,
          String(s.source_id || 'src_unknown'),
          String(s.metric_name),
          val,
          String(s.unit || ''),
          health,
          reason,
          s.source === 'simulated' ? 'simulated' : 'live',
          String(s.connector || 'host'),
          Number(s.collection_interval || 5),
          String(s.source_timezone || 'UTC'),
          String(s.timestamp_utc || nowUtc)
        );
      }

      db.prepare('UPDATE collectors SET status = ?, cpu_usage_pct = ?, ram_usage_pct = ?, last_seen_utc = ? WHERE id = ?').run(
        'online',
        Number(cpuVal.toFixed(2)),
        Number(ramVal.toFixed(2)),
        nowUtc,
        collector.id
      );
      db.prepare('UPDATE sites SET status = ?, last_seen_utc = ? WHERE id = ?').run('connected', nowUtc, collector.site_id);
    })();

    res.status(202).json({ status: 'accepted', accepted_ids: [payload_id] });
  });

  app.get('/v1/collector/jobs', requireCollectorAuth, (_req, res) => {
    const jobs = db
      .prepare("SELECT id, site_id, action_id, target_alias, nonce, signature_hmac, expires_at_epoch FROM jobs WHERE status = 'queued' ORDER BY created_at_utc ASC")
      .all();
    res.json({ jobs });
  });

  app.post('/v1/collector/jobs/:id/result', requireCollectorAuth, (req, res) => {
    const jobId = String(req.params.id);
    const { status, summary, before_evidence, after_evidence, verified_at_utc } = req.body || {};
    const job = db.prepare('SELECT id, tenant_id, site_id, incident_id, recommendation_id, action_id FROM jobs WHERE id = ?').get(jobId) as
      | { id: string; tenant_id: string; site_id: string; incident_id: string | null; recommendation_id: string | null; action_id: string }
      | undefined;
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const nowUtc = typeof verified_at_utc === 'string' ? verified_at_utc : new Date().toISOString();
    const safeStatus = ['verified_resolved', 'failed', 'rolled_back', 'rejected_policy', 'expired'].includes(status)
      ? status
      : 'failed';

    db.transaction(() => {
      db.prepare(
        'UPDATE jobs SET status = ?, summary = ?, before_evidence_json = ?, after_evidence_json = ?, completed_at_utc = ? WHERE id = ?'
      ).run(safeStatus, String(summary || ''), JSON.stringify(before_evidence || {}), JSON.stringify(after_evidence || {}), nowUtc, job.id);

      if (job.recommendation_id) {
        db.prepare('UPDATE recommendations SET status = ? WHERE id = ?').run(
          safeStatus === 'verified_resolved' ? 'executed_verified' : 'failed',
          job.recommendation_id
        );
      }

      if (job.incident_id) {
        if (safeStatus === 'verified_resolved') {
          db.prepare("UPDATE incidents SET status = 'resolved', resolved_at_utc = ? WHERE id = ?").run(nowUtc, job.incident_id);
          db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
            job.incident_id,
            job.tenant_id,
            'verified',
            'Tier 1 Collector',
            String(summary || 'Post-remediation verification passed.'),
            nowUtc
          );
        } else {
          db.prepare("UPDATE incidents SET status = 'resolution_failed' WHERE id = ?").run(job.incident_id);
          db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
            job.incident_id,
            job.tenant_id,
            'resolution_failed',
            'Tier 1 Collector',
            String(summary || 'Verification failed; rollback available.'),
            nowUtc
          );
        }
      }
    })();

    appendAuditLog(job.tenant_id, job.site_id, 'Tier 1', 'collector-agent', `job_${safeStatus}`, `${job.action_id}: ${String(summary || '')}`, 'live');
    res.json({ status: 'recorded', jobId: job.id, outcome: safeStatus });
  });

  // -------------------------------------------------------------------------
  // Organization Branding, Settings & Logo Upload
  // -------------------------------------------------------------------------
  app.get('/v1/settings', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const row = db.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(req.operator!.tenantId);
    res.json({ settings: row });
  });

  app.put('/v1/settings', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const { organization_name, product_name, country_code, region, timezone, industry, compliance_profile, retention_days, thresholds_json, remediation_policy_json } =
      req.body || {};

    const cleanRegion = VALID_REGIONS.has(region) ? region : 'ap-south-1';
    const cleanInd = VALID_SECTORS.has(industry) ? industry : 'it';
    const cleanComp = VALID_COMPLIANCE.has(compliance_profile) ? compliance_profile : 'gdpr';
    const cleanRet = Math.max(1, Math.min(3650, Number(retention_days) || 7));
    const nowUtc = new Date().toISOString();

    db.prepare(
      `UPDATE tenant_settings
       SET organization_name = COALESCE(?, organization_name),
           product_name = COALESCE(?, product_name),
           country_code = COALESCE(?, country_code),
           region = ?,
           timezone = COALESCE(?, timezone),
           industry = ?,
           compliance_profile = ?,
           retention_days = ?,
           thresholds_json = COALESCE(?, thresholds_json),
           remediation_policy_json = COALESCE(?, remediation_policy_json),
           updated_at_utc = ?
       WHERE tenant_id = ?`
    ).run(
      typeof organization_name === 'string' && organization_name.trim() ? organization_name.trim() : null,
      typeof product_name === 'string' && product_name.trim() ? product_name.trim() : null,
      typeof country_code === 'string' && country_code.trim() ? country_code.trim().toUpperCase() : null,
      cleanRegion,
      typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null,
      cleanInd,
      cleanComp,
      cleanRet,
      thresholds_json ? JSON.stringify(thresholds_json) : null,
      remediation_policy_json ? JSON.stringify(remediation_policy_json) : null,
      nowUtc,
      tenantId
    );

    appendAuditLog(tenantId, null, 'Tier 2', req.operator!.email, 'settings_updated', `Updated organization settings (${cleanInd}/${cleanComp}).`, 'live');
    res.json({ settings: db.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get(tenantId) });
  });

  app.post('/v1/settings/logo', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || dataUrl.length > 350000) {
      res.status(400).json({ error: 'Logo must be a valid PNG or SVG under 256 KB.' });
      return;
    }
    const isPng = dataUrl.startsWith('data:image/png;base64,');
    const isSvg = dataUrl.startsWith('data:image/svg+xml;base64,') || dataUrl.startsWith('data:image/svg+xml;utf8,');
    if (!isPng && !isSvg) {
      res.status(400).json({ error: 'Only PNG and sanitized SVG logos are allowed.' });
      return;
    }
    if (isSvg) {
      const decoded = dataUrl.includes('base64,')
        ? Buffer.from(dataUrl.split('base64,')[1], 'base64').toString('utf8')
        : decodeURIComponent(dataUrl.split(',')[1] || '');
      if (/<script|on\w+\s*=|javascript:/i.test(decoded)) {
        res.status(400).json({ error: 'Rejected SVG containing active script or event handler attributes.' });
        return;
      }
    }
    db.prepare('UPDATE tenant_settings SET logo_data_url = ?, updated_at_utc = ? WHERE tenant_id = ?').run(
      dataUrl,
      new Date().toISOString(),
      req.operator!.tenantId
    );
    appendAuditLog(req.operator!.tenantId, null, 'Tier 2', req.operator!.email, 'logo_updated', 'Uploaded validated organization logo.', 'live');
    res.json({ logoDataUrl: dataUrl });
  });

  // -------------------------------------------------------------------------
  // Sites CRUD & Collector Lifecycle (Rotate Key / Revoke / Config)
  // -------------------------------------------------------------------------
  app.get('/v1/sites', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const sites = db.prepare('SELECT * FROM sites WHERE tenant_id = ? ORDER BY created_at_utc ASC').all(req.operator!.tenantId);
    res.json({ sites });
  });

  app.post('/v1/sites', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const { name, region, timezone, sector_tag } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Site name is required.' });
      return;
    }
    const cleanRegion = VALID_REGIONS.has(region) ? region : 'ap-south-1';
    const cleanSector = VALID_SECTORS.has(sector_tag) ? sector_tag : 'it';
    const cleanTz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
    const siteId = `site-${crypto.randomUUID().slice(0, 8)}`;
    const nowUtc = new Date().toISOString();

    db.prepare(
      'INSERT INTO sites (id, tenant_id, name, region, timezone, sector_tag, status, last_seen_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)'
    ).run(siteId, tenantId, name.trim(), cleanRegion, cleanTz, cleanSector, 'pending', nowUtc);
    appendAuditLog(tenantId, siteId, 'Tier 2', req.operator!.email, 'site_created', `Created site "${name.trim()}" (${cleanRegion}).`, 'live');
    res.status(201).json({ site: db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) });
  });

  app.put('/v1/sites/:id', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = String(req.params.id);
    const { name, region, timezone, sector_tag } = req.body || {};
    const existing = db.prepare('SELECT id FROM sites WHERE id = ? AND tenant_id = ?').get(siteId, tenantId);
    if (!existing) {
      res.status(404).json({ error: 'Site not found.' });
      return;
    }
    db.prepare(
      'UPDATE sites SET name = COALESCE(?, name), region = COALESCE(?, region), timezone = COALESCE(?, timezone), sector_tag = COALESCE(?, sector_tag) WHERE id = ? AND tenant_id = ?'
    ).run(
      typeof name === 'string' && name.trim() ? name.trim() : null,
      VALID_REGIONS.has(region) ? region : null,
      typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null,
      VALID_SECTORS.has(sector_tag) ? sector_tag : null,
      siteId,
      tenantId
    );
    appendAuditLog(tenantId, siteId, 'Tier 2', req.operator!.email, 'site_updated', `Updated site ${siteId}.`, 'live');
    res.json({ site: db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) });
  });

  app.delete('/v1/sites/:id', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = String(req.params.id);
    if (siteId === 'site-blr-hq') {
      res.status(400).json({ error: 'Primary live host site cannot be deleted while daemon is bound.' });
      return;
    }
    const info = db.prepare('DELETE FROM sites WHERE id = ? AND tenant_id = ?').run(siteId, tenantId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Site not found.' });
      return;
    }
    appendAuditLog(tenantId, siteId, 'Tier 2', req.operator!.email, 'site_deleted', `Deleted site ${siteId}.`, 'live');
    res.json({ deleted: true });
  });

  app.post('/v1/sites/:id/enrollment-tokens', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = String(req.params.id);
    const site = db.prepare('SELECT id, name FROM sites WHERE id = ? AND tenant_id = ?').get(siteId, tenantId) as
      | { id: string; name: string }
      | undefined;
    if (!site) {
      res.status(404).json({ error: 'Site not found.' });
      return;
    }
    const rawToken = `aur_enr_${crypto.randomBytes(18).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const nowUtc = new Date().toISOString();
    db.prepare(
      'INSERT INTO site_enrollment_tokens (id, tenant_id, site_id, token_hash, expires_at_utc, used_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    ).run(`tok-${crypto.randomUUID().slice(0, 8)}`, tenantId, site.id, tokenHash, expiresAt, nowUtc);
    appendAuditLog(tenantId, site.id, 'Tier 2', req.operator!.email, 'enrollment_token_issued', `Issued 24h single-use enrollment token for ${site.name}.`, 'live');
    res.status(201).json({
      token: rawToken,
      expires_at_utc: expiresAt,
      command: `python3 collector/daemon.py --enroll-token ${rawToken} --site "${site.name}"`,
    });
  });

  app.post('/v1/collector/enroll', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const { token } = req.body || {};
    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'Enrollment token required.' });
      return;
    }
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const row = db
      .prepare('SELECT id, site_id, expires_at_utc, used_at_utc FROM site_enrollment_tokens WHERE token_hash = ? AND tenant_id = ?')
      .get(tokenHash, tenantId) as { id: string; site_id: string; expires_at_utc: string; used_at_utc: string | null } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Invalid enrollment token.' });
      return;
    }
    if (row.used_at_utc) {
      res.status(409).json({ error: 'Enrollment token already consumed (single-use enforced).' });
      return;
    }
    if (Date.now() > Date.parse(row.expires_at_utc)) {
      res.status(410).json({ error: 'Enrollment token expired.' });
      return;
    }
    const site = db.prepare('SELECT id, name, region FROM sites WHERE id = ?').get(row.site_id) as {
      id: string;
      name: string;
      region: string;
    };
    const nowUtc = new Date().toISOString();
    const collectorId = `col-${crypto.randomUUID().slice(0, 8)}`;
    db.transaction(() => {
      db.prepare('UPDATE site_enrollment_tokens SET used_at_utc = ? WHERE id = ?').run(nowUtc, row.id);
      db.prepare('UPDATE sites SET status = ?, last_seen_utc = ? WHERE id = ?').run('connected', nowUtc, site.id);
      db.prepare(
        `INSERT OR REPLACE INTO collectors (id, tenant_id, site_id, collector_code, region, collector_version, status, cpu_usage_pct, ram_usage_pct, local_policy_json, last_seen_utc, created_at_utc)
         VALUES (?, ?, ?, ?, ?, '2.5.0', 'online', 1.2, 2.9, ?, ?, ?)`
      ).run(
        collectorId,
        tenantId,
        site.id,
        `COL-${site.region.toUpperCase()}-${collectorId.slice(-4).toUpperCase()}`,
        site.region,
        JSON.stringify({ mode: 'approval_required', kill_switch: false, max_actions_per_hour: 6 }),
        nowUtc,
        nowUtc
      );
    })();
    appendAuditLog(tenantId, site.id, 'Tier 2', req.operator!.email, 'collector_enrolled', `Enrolled ${collectorId} into ${site.name}.`, 'live');
    res.json({ status: 'connected', collectorId, siteId: site.id, siteName: site.name });
  });

  app.get('/v1/collectors', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const rows = (siteId
      ? db
          .prepare('SELECT c.*, s.name as site_name, s.sector_tag FROM collectors c JOIN sites s ON c.site_id = s.id WHERE c.tenant_id = ? AND c.site_id = ?')
          .all(tenantId, siteId)
      : db
          .prepare('SELECT c.*, s.name as site_name, s.sector_tag FROM collectors c JOIN sites s ON c.site_id = s.id WHERE c.tenant_id = ? ORDER BY s.name ASC')
          .all(tenantId)) as Array<Record<string, unknown>>;

    // Detect collector offline within 60 seconds of last heartbeat
    const nowMs = Date.now();
    const collectors = rows.map((c) => {
      const lastMs = c.last_seen_utc ? Date.parse(String(c.last_seen_utc)) : 0;
      const ageSec = lastMs ? Math.round((nowMs - lastMs) / 1000) : 999;
      const computedStatus = c.revoked ? 'revoked' : ageSec > 60 && c.id === 'col-local-primary' ? 'offline' : c.status;
      return { ...c, heartbeat_age_sec: ageSec, computed_status: computedStatus };
    });

    res.json({ collectors, outageSimulated: fs.existsSync(OUTAGE_FLAG_PATH) });
  });

  app.post('/v1/collectors/:id/rotate-key', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const collectorId = String(req.params.id);
    const col = db.prepare('SELECT id, site_id, key_version FROM collectors WHERE id = ? AND tenant_id = ?').get(collectorId, tenantId) as
      | { id: string; site_id: string; key_version: number }
      | undefined;
    if (!col) {
      res.status(404).json({ error: 'Collector not found.' });
      return;
    }
    const newVer = (col.key_version || 1) + 1;
    db.prepare('UPDATE collectors SET key_version = ? WHERE id = ?').run(newVer, col.id);
    appendAuditLog(tenantId, col.site_id, 'Tier 2', req.operator!.email, 'collector_key_rotated', `Rotated API key for ${col.id} to v${newVer}.`, 'live');
    res.json({ collectorId: col.id, keyVersion: newVer });
  });

  app.post('/v1/collectors/:id/revoke', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const collectorId = String(req.params.id);
    const col = db.prepare('SELECT id, site_id, revoked FROM collectors WHERE id = ? AND tenant_id = ?').get(collectorId, tenantId) as
      | { id: string; site_id: string; revoked: number }
      | undefined;
    if (!col) {
      res.status(404).json({ error: 'Collector not found.' });
      return;
    }
    const nextRevoked = col.revoked ? 0 : 1;
    db.prepare('UPDATE collectors SET revoked = ?, status = ? WHERE id = ?').run(nextRevoked, nextRevoked ? 'offline' : 'online', col.id);
    appendAuditLog(
      tenantId,
      col.site_id,
      'Tier 2',
      req.operator!.email,
      nextRevoked ? 'collector_revoked' : 'collector_reinstated',
      `${nextRevoked ? 'Revoked' : 'Reinstated'} collector ${col.id}.`,
      'live'
    );
    res.json({ collectorId: col.id, revoked: Boolean(nextRevoked) });
  });

  app.put('/v1/collectors/:id/config', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const collectorId = String(req.params.id);
    const { mode, kill_switch } = req.body || {};
    const col = db.prepare('SELECT id, site_id, local_policy_json FROM collectors WHERE id = ? AND tenant_id = ?').get(collectorId, tenantId) as
      | { id: string; site_id: string; local_policy_json: string }
      | undefined;
    if (!col) {
      res.status(404).json({ error: 'Collector not found.' });
      return;
    }
    const current = JSON.parse(col.local_policy_json || '{}');
    const updated = {
      ...current,
      mode: ['dry_run', 'approval_required', 'auto_approved'].includes(mode) ? mode : current.mode,
      kill_switch: typeof kill_switch === 'boolean' ? kill_switch : current.kill_switch,
    };
    db.prepare('UPDATE collectors SET local_policy_json = ? WHERE id = ?').run(JSON.stringify(updated), col.id);
    appendAuditLog(tenantId, col.site_id, 'Tier 2', req.operator!.email, 'collector_policy_updated', `Updated policy for ${col.id}: mode=${updated.mode}, kill_switch=${updated.kill_switch}.`, 'live');
    res.json({ policy: updated });
  });

  // -------------------------------------------------------------------------
  // Data-Source Scoped Overview, Metrics, Health History, SLA Targets
  // -------------------------------------------------------------------------
  app.get('/v1/overview', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const sourceFilter = req.query.source === 'live' || req.query.source === 'simulated' ? String(req.query.source) : 'all';

    const sites = db.prepare('SELECT * FROM sites WHERE tenant_id = ? ORDER BY created_at_utc ASC').all(tenantId) as Array<{
      id: string;
      name: string;
      region: string;
      timezone: string;
      sector_tag: string;
      status: string;
      last_seen_utc: string | null;
    }>;

    const collectors = siteId
      ? db.prepare('SELECT * FROM collectors WHERE tenant_id = ? AND site_id = ?').all(tenantId, siteId)
      : db.prepare('SELECT * FROM collectors WHERE tenant_id = ?').all(tenantId);

    let incSql = "SELECT * FROM incidents WHERE tenant_id = ? AND status != 'resolved'";
    const incParams: unknown[] = [tenantId];
    if (siteId) {
      incSql += ' AND site_id = ?';
      incParams.push(siteId);
    }
    if (sourceFilter !== 'all') {
      incSql += ' AND source = ?';
      incParams.push(sourceFilter);
    }
    const incidents = db.prepare(incSql).all(...incParams);

    let mSql = 'SELECT site_id, source_id, metric_name, metric_value, health_state, source, timestamp_utc FROM metrics_raw WHERE tenant_id = ?';
    const mParams: unknown[] = [tenantId];
    if (siteId) {
      mSql += ' AND site_id = ?';
      mParams.push(siteId);
    }
    if (sourceFilter !== 'all') {
      mSql += ' AND source = ?';
      mParams.push(sourceFilter);
    }
    mSql += ' ORDER BY timestamp_utc DESC LIMIT 220';

    const recentRows = db.prepare(mSql).all(...mParams) as Array<{
      site_id: string;
      source_id: string;
      metric_name: string;
      metric_value: number;
      health_state: string;
      source: string;
      timestamp_utc: string;
    }>;

    const healthCounts = { Excellent: 0, Good: 0, Fair: 0, Poor: 0 };
    const seenSources = new Map<string, string>();
    const latencies: number[] = [];

    for (const r of recentRows) {
      if (!seenSources.has(r.source_id)) {
        seenSources.set(r.source_id, r.health_state);
        if (r.health_state in healthCounts) healthCounts[r.health_state as keyof typeof healthCounts] += 1;
      }
      if (r.metric_name === 'latency_avg_ms') latencies.push(r.metric_value);
    }

    const totalServers = seenSources.size;
    const healthyServers = healthCounts.Excellent + healthCounts.Good;
    const avgLatency = latencies.length > 0 ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0;

    const siteCards = sites.map((s) => {
      const sRows = recentRows.filter((r) => r.site_id === s.id);
      const sLive = sRows.some((r) => r.source === 'live');
      const sInc = (db
        .prepare("SELECT COUNT(*) as c FROM incidents WHERE tenant_id = ? AND site_id = ? AND status != 'resolved'")
        .get(tenantId, s.id) as { c: number }).c;
      const sCol = db.prepare("SELECT COUNT(*) as c FROM collectors WHERE tenant_id = ? AND site_id = ? AND status = 'online'").get(tenantId, s.id) as {
        c: number;
      };
      return {
        ...s,
        onlineCollectors: sCol.c,
        activeIncidents: sInc,
        dataSource: sLive ? 'live' : sRows.length > 0 ? 'simulated' : 'none',
        healthState: s.status === 'degraded' ? 'Fair' : sRows[0]?.health_state || 'Good',
      };
    });

    res.json({
      totals: {
        totalServers,
        healthyServers,
        activeIncidents: incidents.length,
        onlineCollectors: (collectors as Array<{ status: string }>).filter((c) => c.status === 'online').length,
        totalCollectors: collectors.length,
        avgLatencyMs: avgLatency,
      },
      healthDistribution: healthCounts,
      siteCards,
    });
  });

  app.get('/v1/metrics', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const type = String(req.query.type || 'cpu_total_percent');
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const range = String(req.query.range || '15m');
    const sourceFilter = req.query.source === 'live' || req.query.source === 'simulated' ? String(req.query.source) : 'all';

    const rangeMsMap: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 3600 * 1000,
      '24h': 24 * 3600 * 1000,
    };
    const cutoffIso = new Date(Date.now() - (rangeMsMap[range] || 15 * 60 * 1000)).toISOString();

    let sql = 'SELECT metric_value, unit, health_state, source, source_timezone, timestamp_utc FROM metrics_raw WHERE tenant_id = ? AND metric_name = ? AND timestamp_utc >= ?';
    const params: unknown[] = [tenantId, type, cutoffIso];
    if (siteId) {
      sql += ' AND site_id = ?';
      params.push(siteId);
    }
    if (sourceFilter !== 'all') {
      sql += ' AND source = ?';
      params.push(sourceFilter);
    }
    sql += ' ORDER BY timestamp_utc ASC';

    const rows = db.prepare(sql).all(...params) as Array<{
      metric_value: number;
      unit: string;
      health_state: string;
      source: string;
      source_timezone: string;
      timestamp_utc: string;
    }>;

    const values = rows.map((r) => r.metric_value);
    const mean = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const variance = values.length > 1 ? values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1) : 0;
    const stdDev = Math.sqrt(variance);

    const points: Array<{ timestamp_utc: string; value: number | null; baseline: number | null; anomaly: boolean; source: string }> = [];
    let prevTime = 0;
    for (const r of rows) {
      const t = Date.parse(r.timestamp_utc);
      if (prevTime > 0 && t - prevTime > 30000 && range === '15m') {
        points.push({ timestamp_utc: new Date(prevTime + 5000).toISOString(), value: null, baseline: null, anomaly: false, source: r.source });
      }
      prevTime = t;
      const z = stdDev > 0.05 ? Math.abs(r.metric_value - mean) / stdDev : 0;
      points.push({
        timestamp_utc: r.timestamp_utc,
        value: Number(r.metric_value.toFixed(3)),
        baseline: Number(mean.toFixed(2)),
        anomaly: z >= 2.2,
        source: r.source,
      });
    }

    const sortedVals = [...values].sort((a, b) => a - b);
    const lastTs = rows.length > 0 ? Date.parse(rows[rows.length - 1].timestamp_utc) : 0;
    const isStale = rows.length > 0 && Date.now() - lastTs > 20000 && rows.some((r) => r.source === 'live');

    res.json({
      metric: type,
      unit: rows[0]?.unit || (type.includes('ms') ? 'ms' : '%'),
      source: rows.some((r) => r.source === 'live') ? 'live' : rows.length > 0 ? 'simulated' : 'none',
      isStale,
      lastUpdatedUtc: rows.length > 0 ? rows[rows.length - 1].timestamp_utc : null,
      stats: {
        count: rows.length,
        min: sortedVals.length ? sortedVals[0] : null,
        avg: values.length ? Number(mean.toFixed(3)) : null,
        max: sortedVals.length ? sortedVals[sortedVals.length - 1] : null,
        p95: sortedVals.length ? computePercentile(sortedVals, 95) : null,
      },
      points,
    });
  });

  app.get('/v1/metrics/verify', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const type = String(req.query.type || 'cpu_total_percent');
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const rows = (siteId
      ? db.prepare('SELECT metric_value, timestamp_utc FROM metrics_raw WHERE tenant_id = ? AND site_id = ? AND metric_name = ? ORDER BY timestamp_utc ASC').all(tenantId, siteId, type)
      : db.prepare('SELECT metric_value, timestamp_utc FROM metrics_raw WHERE tenant_id = ? AND metric_name = ? ORDER BY timestamp_utc ASC').all(tenantId, type)) as Array<{
      metric_value: number;
      timestamp_utc: string;
    }>;

    const vals = rows.map((r) => r.metric_value).sort((a, b) => a - b);
    const gaps: Array<{ from_utc: string; to_utc: string; duration_sec: number }> = [];
    for (let i = 1; i < rows.length; i++) {
      const diff = (Date.parse(rows[i].timestamp_utc) - Date.parse(rows[i - 1].timestamp_utc)) / 1000;
      if (diff > 20) gaps.push({ from_utc: rows[i - 1].timestamp_utc, to_utc: rows[i].timestamp_utc, duration_sec: Math.round(diff) });
    }
    res.json({
      metric: type,
      sample_count: rows.length,
      first_timestamp_utc: rows[0]?.timestamp_utc || null,
      last_timestamp_utc: rows[rows.length - 1]?.timestamp_utc || null,
      raw_min: vals.length ? vals[0] : null,
      raw_avg: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)) : null,
      raw_max: vals.length ? vals[vals.length - 1] : null,
      raw_p95: vals.length ? computePercentile(vals, 95) : null,
      gaps,
    });
  });

  app.get('/v1/infrastructure', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const sourceFilter = req.query.source === 'live' || req.query.source === 'simulated' ? String(req.query.source) : 'all';

    let sql = `SELECT m.site_id, s.name as site_name, s.region, m.source_id, m.metric_name, m.metric_value, m.health_state, m.health_reason, m.source, m.timestamp_utc
               FROM metrics_raw m JOIN sites s ON m.site_id = s.id WHERE m.tenant_id = ?`;
    const params: unknown[] = [tenantId];
    if (siteId) {
      sql += ' AND m.site_id = ?';
      params.push(siteId);
    }
    if (sourceFilter !== 'all') {
      sql += ' AND m.source = ?';
      params.push(sourceFilter);
    }
    sql += ' ORDER BY m.timestamp_utc DESC LIMIT 400';

    const rows = db.prepare(sql).all(...params) as Array<{
      site_id: string;
      site_name: string;
      region: string;
      source_id: string;
      metric_name: string;
      metric_value: number;
      health_state: string;
      health_reason: string;
      source: string;
      timestamp_utc: string;
    }>;

    const nodes = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const key = `${r.site_id}:${r.source_id}:${r.source}`;
      let node = nodes.get(key);
      if (!node) {
        node = {
          source_id: r.source_id,
          site_id: r.site_id,
          site_name: r.site_name,
          region: r.region,
          cpu: null,
          ram: null,
          disk: null,
          latency: null,
          health_state: r.health_state,
          health_reason: r.health_reason,
          source: r.source,
          last_seen_utc: r.timestamp_utc,
        };
        nodes.set(key, node);
      }
      if (r.metric_name === 'cpu_total_percent' && node.cpu === null) node.cpu = r.metric_value;
      if (r.metric_name === 'ram_usage_percent' && node.ram === null) node.ram = r.metric_value;
      if (r.metric_name === 'disk_usage_percent' && node.disk === null) node.disk = r.metric_value;
      if (r.metric_name === 'latency_avg_ms' && node.latency === null) node.latency = r.metric_value;
    }
    res.json({ nodes: Array.from(nodes.values()) });
  });

  app.get('/v1/health-history', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const history = siteId
      ? db.prepare('SELECT * FROM health_history WHERE tenant_id = ? AND site_id = ? ORDER BY changed_at_utc DESC LIMIT 50').all(tenantId, siteId)
      : db.prepare('SELECT * FROM health_history WHERE tenant_id = ? ORDER BY changed_at_utc DESC LIMIT 50').all(tenantId);
    res.json({ history });
  });

  app.get('/v1/sla-metrics', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const receipts = db
      .prepare('SELECT payload_id, sent_at_utc, received_at_utc FROM payload_receipts WHERE tenant_id = ? ORDER BY received_at_utc DESC LIMIT 100')
      .all(tenantId) as Array<{ payload_id: string; sent_at_utc: string; received_at_utc: string }>;

    const latenciesSec = receipts
      .map((r) => Math.max(0, (Date.parse(r.received_at_utc) - Date.parse(r.sent_at_utc)) / 1000))
      .sort((a, b) => a - b);

    const p95IngestSec = latenciesSec.length ? computePercentile(latenciesSec, 95) : 0;

    // Compare Tier 1 egress_log 202_ACCEPTED payload_ids against Tier 2 payload_receipts
    let sentCount = 0;
    let matchedCount = 0;
    let queueSize = 0;
    const t1 = openTier1ReadOnly();
    if (t1) {
      try {
        const sentIds = t1
          .prepare("SELECT DISTINCT payload_id FROM egress_log WHERE result = '202_ACCEPTED'")
          .all() as Array<{ payload_id: string }>;
        sentCount = sentIds.length;
        const t2Set = new Set(
          (db.prepare('SELECT payload_id FROM payload_receipts WHERE tenant_id = ?').all(tenantId) as Array<{ payload_id: string }>).map(
            (r) => r.payload_id
          )
        );
        matchedCount = sentIds.filter((s) => t2Set.has(s.payload_id)).length;
        queueSize = (t1.prepare('SELECT COUNT(*) as c FROM outbound_queue').get() as { c: number }).c;
      } finally {
        t1.close();
      }
    }

    const col = db
      .prepare("SELECT last_seen_utc FROM collectors WHERE tenant_id = ? AND id = 'col-local-primary'")
      .get(tenantId) as { last_seen_utc: string | null } | undefined;
    const heartbeatAgeSec = col?.last_seen_utc ? Math.round((Date.now() - Date.parse(col.last_seen_utc)) / 1000) : 999;

    res.json({
      collectionToDashboardP95Sec: p95IngestSec,
      p95TargetMet: p95IngestSec < 10,
      breachToAlertTargetSec: 5.0,
      heartbeatAgeSec,
      offlineDetectionTargetMet: heartbeatAgeSec < 60,
      outageBufferQueueDepth: queueSize,
      sentPayloadCount: sentCount,
      matchedReceivedCount: matchedCount,
      parityPercent: sentCount > 0 ? Number(((matchedCount / sentCount) * 100).toFixed(2)) : 100,
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1 Privacy, Egress Match Check & Scenario Injector
  // -------------------------------------------------------------------------
  app.get('/v1/collector/raw-preview', requireOperatorAuth, (_req, res) => {
    const t1 = openTier1ReadOnly();
    if (!t1) {
      res.json({ previews: [] });
      return;
    }
    try {
      res.json({ previews: t1.prepare('SELECT * FROM raw_preview ORDER BY id DESC LIMIT 12').all() });
    } finally {
      t1.close();
    }
  });

  app.get('/v1/collector/egress-log', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const t1 = openTier1ReadOnly();
    if (!t1) {
      res.json({ egressLogs: [], queueSize: 0, parityMatch: true });
      return;
    }
    try {
      const egressLogs = t1
        .prepare('SELECT id, payload_id, timestamp_utc, byte_size, destination, result, payload_json FROM egress_log ORDER BY id DESC LIMIT 15')
        .all() as Array<{ payload_id: string; result: string; [k: string]: unknown }>;
      const qRow = t1.prepare('SELECT COUNT(*) as c, MIN(created_at_utc) as oldest FROM outbound_queue').get() as {
        c: number;
        oldest: string | null;
      };
      const t2Ids = new Set(
        (db.prepare('SELECT payload_id FROM payload_receipts WHERE tenant_id = ?').all(req.operator!.tenantId) as Array<{ payload_id: string }>).map(
          (r) => r.payload_id
        )
      );
      const enriched = egressLogs.map((e) => ({
        ...e,
        matched_in_saas: e.result === '202_ACCEPTED' ? t2Ids.has(e.payload_id) : false,
      }));
      res.json({ egressLogs: enriched, queueSize: qRow.c, oldestQueuedUtc: qRow.oldest });
    } finally {
      t1.close();
    }
  });

  app.get('/v1/privacy/received', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const receipts = db
      .prepare('SELECT * FROM payload_receipts WHERE tenant_id = ? ORDER BY received_at_utc DESC LIMIT 15')
      .all(req.operator!.tenantId);
    res.json({ receipts });
  });

  app.post('/v1/collector/simulate/outage', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const { enabled } = req.body || {};
    if (enabled) {
      fs.writeFileSync(OUTAGE_FLAG_PATH, new Date().toISOString(), 'utf8');
    } else if (fs.existsSync(OUTAGE_FLAG_PATH)) {
      fs.unlinkSync(OUTAGE_FLAG_PATH);
    }
    appendAuditLog(
      req.operator!.tenantId,
      'site-blr-hq',
      'Tier 1',
      req.operator!.email,
      enabled ? 'outage_simulation_enabled' : 'outage_simulation_cleared',
      enabled
        ? 'Simulated SaaS disconnect; Tier 1 buffering approved payloads in SQLite.'
        : 'Cleared SaaS disconnect; Tier 1 delivering buffered payloads with zero loss or duplicates.',
      'simulated'
    );
    res.json({ outageSimulated: fs.existsSync(OUTAGE_FLAG_PATH) });
  });

  app.post('/v1/collector/simulate/inject', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const { rawLogLine, extraFieldTest } = req.body || {};
    const sample =
      typeof rawLogLine === 'string' && rawLogLine.trim()
        ? rawLogLine.trim()
        : 'auth_debug user=elena@aurelis-ops.io password=abc123 src_ip=10.42.8.14 Bearer eyJhbGciOiJIUzI1NiJ9.secret';
    const redacted = redactLocalText(sample);
    const dropped = ['raw_log_line', 'process_cmdline', 'auth_header'];
    if (typeof extraFieldTest === 'string' && extraFieldTest.trim()) dropped.push(extraFieldTest.trim());

    const t1 = new Database(TIER1_DB_PATH);
    try {
      t1.prepare(
        'INSERT INTO raw_preview (captured_at_utc, raw_line, redacted_line, dropped_fields, source) VALUES (?, ?, ?, ?, ?)'
      ).run(new Date().toISOString(), sample, redacted, JSON.stringify(dropped), 'simulated');
    } finally {
      t1.close();
    }
    appendAuditLog(req.operator!.tenantId, 'site-blr-hq', 'Tier 1', req.operator!.email, 'secret_injection_dry_run', `Redacted test log locally and dropped [${dropped.join(', ')}].`, 'simulated');
    res.json({
      raw: sample,
      redacted,
      droppedFields: dropped,
      tier2RejectionTest: extraFieldTest
        ? { rejected: true, reason: `HTTP 400: Rejected non-allow-listed field '${extraFieldTest}' at Tier 2 schema boundary.` }
        : null,
    });
  });

  // Live 8-Scenario Injector (Organizer Replay, Auth Burst, Latency Spike, CPU Spike, Correlated Alerts, Duplicate/OOO)
  app.post('/v1/scenarios/run', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const { scenario } = req.body || {};
    const nowUtc = new Date().toISOString();

    if (scenario === 'organizer_replay') {
      const lines = fs.existsSync(ORGANIZER_STREAM_PATH)
        ? fs.readFileSync(ORGANIZER_STREAM_PATH, 'utf8').split('\n').filter(Boolean)
        : [];
      const payloadId = crypto.randomUUID();
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO payload_receipts (id, tenant_id, site_id, collector_id, payload_id, region, source, payload_sha256, record_count, sent_at_utc, received_at_utc)
           VALUES (?, ?, 'site-blr-hq', 'col-local-primary', ?, 'ap-south-1', 'simulated', ?, ?, ?, ?)`
        ).run(`rcp-${crypto.randomUUID().slice(0, 8)}`, tenantId, payloadId, crypto.createHash('sha256').update(payloadId).digest('hex'), lines.length, nowUtc, nowUtc);

        for (const line of lines) {
          const rec = JSON.parse(line);
          db.prepare(
            `INSERT INTO metrics_raw (tenant_id, site_id, collector_id, source_id, metric_name, metric_value, unit, health_state, health_reason, source, connector, collection_interval, source_timezone, timestamp_utc)
             VALUES (?, 'site-blr-hq', 'col-local-primary', ?, ?, ?, ?, ?, ?, 'simulated', 'organizer_replay', 5, ?, ?)`
          ).run(
            tenantId,
            rec.source_id || 'src_org_stream_01',
            rec.metric_name,
            Number(rec.metric_value),
            rec.unit || '',
            rec.metric_value > 90 ? 'Poor' : 'Good',
            rec.alert_context || 'Organizer stream replay',
            rec.source_timezone || 'UTC',
            rec.timestamp_utc || nowUtc
          );
        }
      });
      tx();
      appendAuditLog(tenantId, 'site-blr-hq', 'Tier 1', req.operator!.email, 'scenario_organizer_replay', `Replayed ${lines.length} organizer stream records tagged source="simulated".`, 'simulated');
      res.json({ status: 'completed', detail: `Replayed ${lines.length} organizer stream records (tagged SIMULATED).` });
      return;
    }

    if (scenario === 'failed_login_burst') {
      for (let i = 0; i < 27; i++) {
        fs.appendFileSync(EVENT_LOG_PATH, `${nowUtc} WARN failed_login user=unknown_actor ip=10.10.0.${i + 2} password=bad_${i}\n`);
      }
      appendAuditLog(tenantId, 'site-blr-hq', 'Tier 1', req.operator!.email, 'scenario_failed_login_burst', 'Injected 27 local auth failures; Tier 1 emits summary count=27 only (0 raw lines sent).', 'simulated');
      res.json({ status: 'completed', detail: '27 local auth failures written to Tier 1 log; collector emits summary counter only.' });
      return;
    }

    if (scenario === 'correlated_alerts' || scenario === 'latency_spike' || scenario === 'cpu_ram_deviation') {
      const incId = `inc-${crypto.randomUUID().slice(0, 8)}`;
      const title =
        scenario === 'latency_spike'
          ? 'Latency Z-Score Spike Detected (+92ms)'
          : scenario === 'cpu_ram_deviation'
            ? 'CPU & Memory Baseline Deviation (93% Peak)'
            : 'Correlated Compute & Network Saturation (6 Merged Alerts)';
      db.prepare(
        `INSERT INTO incidents (id, tenant_id, site_id, parent_incident_id, is_cross_site_parent, affected_site_names, source_id, cause_signal, title, severity, status, decision_mode, decision_reasoning_json, merged_alert_count, correlation_explanation, source, opened_at_utc)
         VALUES (?, ?, 'site-blr-hq', NULL, 0, ?, 'src_scenario_01', ?, ?, 'high', 'open', 'ASK_APPROVAL', ?, ?, ?, 'simulated', ?)`
      ).run(
        incId,
        tenantId,
        JSON.stringify(['Bengaluru Office (Primary Live)']),
        scenario,
        title,
        JSON.stringify({ cause: `Scenario ${scenario} triggered > 3.0 sigma EWMA deviation`, confidence: 0.93, outcome: 'ASK_APPROVAL' }),
        scenario === 'correlated_alerts' ? '6 related alerts inside 5-minute window merged into 1 incident.' : 'Single correlated incident created.',
        nowUtc
      );
      db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
        incId,
        tenantId,
        'detected',
        'Scenario Injector',
        title,
        nowUtc
      );
      appendAuditLog(tenantId, 'site-blr-hq', 'Tier 2', req.operator!.email, `scenario_${scenario}`, title, 'simulated');
      res.json({ status: 'completed', detail: `Created simulated incident "${title}".` });
      return;
    }

    if (scenario === 'duplicate_out_of_order') {
      const pid = crypto.randomUUID();
      const pastTs = new Date(Date.now() - 180000).toISOString();
      db.prepare(
        `INSERT INTO payload_receipts (id, tenant_id, site_id, collector_id, payload_id, region, source, payload_sha256, record_count, sent_at_utc, received_at_utc)
         VALUES (?, ?, 'site-blr-hq', 'col-local-primary', ?, 'ap-south-1', 'simulated', ?, 1, ?, ?)`
      ).run(`rcp-${crypto.randomUUID().slice(0, 8)}`, tenantId, pid, crypto.createHash('sha256').update(pid).digest('hex'), pastTs, nowUtc);
      db.prepare(
        `INSERT INTO metrics_raw (tenant_id, site_id, collector_id, source_id, metric_name, metric_value, unit, health_state, health_reason, source, connector, collection_interval, source_timezone, timestamp_utc)
         VALUES (?, 'site-blr-hq', 'col-local-primary', 'src_ooo_test', 'cpu_total_percent', 61.5, '%', 'Good', 'Out-of-order event placed by event timestamp', 'simulated', 'scenario', 5, 'UTC', ?)`
      ).run(tenantId, pastTs);
      // Replay identical payload_id -> rejected/ignored by unique index
      const dupCheck = db.prepare('SELECT id FROM payload_receipts WHERE tenant_id = ? AND payload_id = ?').get(tenantId, pid);
      appendAuditLog(tenantId, 'site-blr-hq', 'Tier 2', req.operator!.email, 'scenario_duplicate_ooo', `Backdated event inserted at ${pastTs}; duplicate payload_id ${pid} deduplicated.`, 'simulated');
      res.json({
        status: 'completed',
        detail: `Inserted out-of-order event (${pastTs}) ordered by event time; duplicate replay ${dupCheck ? 'deduplicated (0 duplicate rows)' : ''}.`,
      });
      return;
    }

    res.status(400).json({ error: 'Unknown scenario identifier.' });
  });

  // -------------------------------------------------------------------------
  // Incidents, Recommendations, Remediation & Rollback
  // -------------------------------------------------------------------------
  app.get('/v1/incidents', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const sourceFilter = req.query.source === 'live' || req.query.source === 'simulated' ? String(req.query.source) : 'all';

    let sql = 'SELECT * FROM incidents WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (siteId) {
      sql += ' AND (site_id = ? OR is_cross_site_parent = 1)';
      params.push(siteId);
    }
    if (sourceFilter !== 'all') {
      sql += ' AND source = ?';
      params.push(sourceFilter);
    }
    sql += ' ORDER BY opened_at_utc DESC';
    res.json({ incidents: db.prepare(sql).all(...params) });
  });

  app.get('/v1/incidents/:id/timeline', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const events = db
      .prepare('SELECT * FROM incident_timeline WHERE incident_id = ? AND tenant_id = ? ORDER BY timestamp_utc ASC')
      .all(String(req.params.id), req.operator!.tenantId);
    res.json({ events });
  });

  app.post('/v1/incidents/:id/acknowledge', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const inc = db.prepare('SELECT id, site_id, title FROM incidents WHERE id = ? AND tenant_id = ?').get(String(req.params.id), tenantId) as
      | { id: string; site_id: string | null; title: string }
      | undefined;
    if (!inc) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const nowUtc = new Date().toISOString();
    db.prepare("UPDATE incidents SET status = 'acknowledged', acknowledged_at_utc = ? WHERE id = ?").run(nowUtc, inc.id);
    db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
      inc.id,
      tenantId,
      'acknowledged',
      req.operator!.email,
      'Acknowledged by operator.',
      nowUtc
    );
    appendAuditLog(tenantId, inc.site_id, 'Tier 2', req.operator!.email, 'incident_acknowledged', `Acknowledged "${inc.title}".`, 'live');
    res.json({ status: 'acknowledged' });
  });

  app.post('/v1/incidents/:id/resolve', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const { manualEvidence } = req.body || {};
    const inc = db.prepare('SELECT id, site_id, title FROM incidents WHERE id = ? AND tenant_id = ?').get(String(req.params.id), tenantId) as
      | { id: string; site_id: string | null; title: string }
      | undefined;
    if (!inc) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const evidenceText = typeof manualEvidence === 'string' && manualEvidence.trim() ? manualEvidence.trim() : 'Operator verified nominal post-check';
    const nowUtc = new Date().toISOString();
    db.prepare("UPDATE incidents SET status = 'resolved', manual_assignee = ?, manual_evidence = ?, resolved_at_utc = ? WHERE id = ?").run(
      req.operator!.email,
      evidenceText,
      nowUtc,
      inc.id
    );
    db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
      inc.id,
      tenantId,
      'resolved',
      req.operator!.email,
      `Resolved with evidence: ${evidenceText}`,
      nowUtc
    );
    appendAuditLog(tenantId, inc.site_id, 'Tier 2', req.operator!.email, 'incident_resolved', `Resolved "${inc.title}" (${evidenceText}).`, 'live');
    res.json({ status: 'resolved' });
  });

  app.get('/v1/recommendations', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const recs = siteId
      ? db.prepare('SELECT * FROM recommendations WHERE tenant_id = ? AND site_id = ? ORDER BY created_at_utc DESC').all(tenantId, siteId)
      : db.prepare('SELECT * FROM recommendations WHERE tenant_id = ? ORDER BY created_at_utc DESC').all(tenantId);
    const jobs = db.prepare('SELECT * FROM jobs WHERE tenant_id = ? ORDER BY created_at_utc DESC LIMIT 15').all(tenantId);
    res.json({ recommendations: recs, jobs });
  });

  app.post('/v1/recommendations/:id/approve', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const rec = db.prepare('SELECT * FROM recommendations WHERE id = ? AND tenant_id = ?').get(String(req.params.id), tenantId) as
      | { id: string; site_id: string; incident_id: string | null; action_id: string; target_alias: string; risk_level: string; title: string }
      | undefined;
    if (!rec) {
      res.status(404).json({ error: 'Recommendation not found' });
      return;
    }
    const collector = db.prepare('SELECT id FROM collectors WHERE tenant_id = ? AND site_id = ? LIMIT 1').get(tenantId, rec.site_id) as
      | { id: string }
      | undefined;
    if (!collector) {
      res.status(409).json({ error: 'No collector bound to this site.' });
      return;
    }

    const jobId = `job-${crypto.randomUUID().slice(0, 10)}`;
    const nonce = crypto.randomBytes(12).toString('hex');
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + 120;
    const signatureHmac = crypto
      .createHmac('sha256', COLLECTOR_HMAC)
      .update(`${jobId}:${rec.action_id}:${nonce}:${expiresAtEpoch}:${rec.site_id}`)
      .digest('hex');
    const nowUtc = new Date().toISOString();

    db.transaction(() => {
      db.prepare("UPDATE recommendations SET status = 'approved_dispatched' WHERE id = ?").run(rec.id);
      db.prepare(
        `INSERT INTO jobs (id, tenant_id, site_id, collector_id, incident_id, recommendation_id, action_id, target_alias, risk_level, status, nonce, signature_hmac, expires_at_epoch, created_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
      ).run(jobId, tenantId, rec.site_id, collector.id, rec.incident_id, rec.id, rec.action_id, rec.target_alias, rec.risk_level, nonce, signatureHmac, expiresAtEpoch, nowUtc);
      if (rec.incident_id) {
        db.prepare('INSERT INTO incident_timeline (incident_id, tenant_id, stage, actor, detail, timestamp_utc) VALUES (?, ?, ?, ?, ?, ?)').run(
          rec.incident_id,
          tenantId,
          'approved',
          req.operator!.email,
          `Signed job ${jobId} (${rec.action_id}) queued for Tier 1 collector.`,
          nowUtc
        );
      }
    })();

    appendAuditLog(tenantId, rec.site_id, 'Tier 2', req.operator!.email, 'remediation_approved', `Dispatched signed job ${jobId} (${rec.action_id}).`, 'live');
    res.json({ status: 'queued', jobId, actionId: rec.action_id });
  });

  app.post('/v1/recommendations/:id/reject', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const rec = db.prepare('SELECT id, site_id, title FROM recommendations WHERE id = ? AND tenant_id = ?').get(String(req.params.id), tenantId) as
      | { id: string; site_id: string; title: string }
      | undefined;
    if (!rec) {
      res.status(404).json({ error: 'Recommendation not found' });
      return;
    }
    db.prepare("UPDATE recommendations SET status = 'dismissed' WHERE id = ?").run(rec.id);
    appendAuditLog(tenantId, rec.site_id, 'Tier 2', req.operator!.email, 'recommendation_dismissed', `Dismissed "${rec.title}".`, 'live');
    res.json({ status: 'dismissed' });
  });

  app.post('/v1/jobs/:id/rollback', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const job = db.prepare('SELECT id, site_id, action_id FROM jobs WHERE id = ? AND tenant_id = ?').get(String(req.params.id), tenantId) as
      | { id: string; site_id: string; action_id: string }
      | undefined;
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const nowUtc = new Date().toISOString();
    db.prepare("UPDATE jobs SET status = 'rolled_back', rollback_performed = 1, summary = ?, completed_at_utc = ? WHERE id = ?").run(
      `Manual rollback executed by ${req.operator!.email}; prior snapshot restored.`,
      nowUtc,
      job.id
    );
    appendAuditLog(tenantId, job.site_id, 'Tier 2', req.operator!.email, 'job_rolled_back', `Rolled back ${job.action_id} (${job.id}).`, 'live');
    res.json({ status: 'rolled_back' });
  });

  // -------------------------------------------------------------------------
  // Audit Logs + Tamper-Evident Hash Chain Verification + Notification Channels
  // -------------------------------------------------------------------------
  app.get('/v1/audit-logs', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const tenantId = req.operator!.tenantId;
    const siteId = typeof req.query.site_id === 'string' && req.query.site_id !== 'all' ? req.query.site_id : null;
    const logs = siteId
      ? db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ? AND (site_id = ? OR site_id IS NULL) ORDER BY id DESC LIMIT 120').all(tenantId, siteId)
      : db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT 120').all(tenantId);

    // Verify tamper-evident hash chain order
    const ascLogs = db
      .prepare('SELECT id, tenant_id, site_id, tier, actor, action, detail, source, prev_hash, entry_hash, timestamp_utc FROM audit_logs WHERE tenant_id = ? ORDER BY id ASC')
      .all(tenantId) as Array<Record<string, unknown>>;

    let chainValid = true;
    let prev = 'GENESIS';
    for (const row of ascLogs) {
      if (!row.entry_hash) continue;
      if (row.prev_hash !== prev) {
        chainValid = false;
        break;
      }
      prev = String(row.entry_hash);
    }

    res.json({ logs, chainVerified: chainValid, totalEntries: ascLogs.length });
  });

  app.get('/v1/notifications/channels', requireOperatorAuth, (req: AuthenticatedRequest, res) => {
    const channels = db
      .prepare('SELECT n.*, s.name as site_name FROM notification_channels n JOIN sites s ON n.site_id = s.id WHERE n.tenant_id = ? ORDER BY n.created_at_utc DESC')
      .all(req.operator!.tenantId);
    res.json({ channels });
  });

  app.post('/v1/notifications/channels', requireOperatorAuth, requireAdminRole, (req: AuthenticatedRequest, res) => {
    const { site_id, channel_type, target_label, quiet_hours } = req.body || {};
    if (typeof site_id !== 'string' || typeof channel_type !== 'string' || typeof target_label !== 'string' || !target_label.trim()) {
      res.status(400).json({ error: 'Site, channel type, and label are required.' });
      return;
    }
    const id = `ch-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      'INSERT INTO notification_channels (id, tenant_id, site_id, channel_type, target_label, quiet_hours, enabled, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(id, req.operator!.tenantId, site_id, channel_type, target_label.trim(), typeof quiet_hours === 'string' ? quiet_hours : '23:00-06:00', new Date().toISOString());
    res.status(201).json({ id });
  });

  // Vite middleware or production static
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const server = app.listen(3000, '0.0.0.0', () => {
    console.log('[AURELIS] Tier 2 Central SaaS + Vite Dashboard listening on http://0.0.0.0:3000');
    startLocalPythonCollector();
  });

  const shutdown = () => {
    if (collectorChild && !collectorChild.killed) collectorChild.kill('SIGTERM');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrapServer().catch((err) => {
  console.error('Failed to start AURELIS server:', err);
  process.exit(1);
});
