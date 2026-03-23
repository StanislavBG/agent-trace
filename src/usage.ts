/**
 * Usage-based monetization for agent-trace (Preflight Suite — shared monthly cap).
 * Free tier: 50 runs/month across all Preflight Suite tools combined.
 * Pro tier: unlimited runs via PREFLIGHT_LICENSE_KEY or ~/.preflight-suite/license.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { validate } from '@bilkobibitkov/preflight-license';

const TOOL_NAME = 'agent-trace' as const;
const FREE_MONTHLY_LIMIT = 50;
const UPGRADE_URL = 'https://buy.stripe.com/28E00l73Ccu9ePH1S08k802';

const SUITE_DIR = path.join(os.homedir(), '.preflight-suite');
export const SUITE_USAGE_FILE = path.join(SUITE_DIR, 'usage.json');
export const SUITE_LICENSE_FILE = path.join(SUITE_DIR, 'license.json');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'agent-trace');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface SharedUsage {
  month: string; // YYYY-MM
  total: number;
  tools: {
    stepproof: number;
    'agent-comply': number;
    'agent-gate': number;
    'agent-trace': number;
  };
}

/** Read license key: env var → shared suite → legacy tool config */
export function getLicenseKey(): string | undefined {
  const envKey = process.env.TRACE_KEY ?? process.env.PREFLIGHT_LICENSE_KEY;
  if (envKey?.trim()) return envKey.trim();
  try {
    if (fs.existsSync(SUITE_LICENSE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUITE_LICENSE_FILE, 'utf8')) as { key?: string };
      if (parsed.key?.trim()) return parsed.key.trim();
    }
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as { key?: string };
      if (parsed.key?.trim()) return parsed.key.trim();
    }
  } catch { /* ignore */ }
  return undefined;
}

export function isProUser(): boolean {
  const key = getLicenseKey();
  if (!key) return false;
  const result = validate(key);
  return result.valid && result.tier !== 'free';
}

function readSharedUsage(): SharedUsage {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    if (fs.existsSync(SUITE_USAGE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUITE_USAGE_FILE, 'utf8')) as SharedUsage;
      if (parsed.month === currentMonth) return parsed;
    }
  } catch { /* corrupted — reset */ }
  return { month: currentMonth, total: 0, tools: { stepproof: 0, 'agent-comply': 0, 'agent-gate': 0, 'agent-trace': 0 } };
}

function writeSharedUsage(record: SharedUsage): void {
  try {
    fs.mkdirSync(SUITE_DIR, { recursive: true });
    fs.writeFileSync(SUITE_USAGE_FILE, JSON.stringify(record, null, 2), 'utf8');
  } catch { /* degrade gracefully */ }
}

/** Returns false (and prints error) if the monthly cap has been reached. */
export function checkUsageLimit(): boolean {
  if (isProUser()) return true;
  const usage = readSharedUsage();
  if (usage.total >= FREE_MONTHLY_LIMIT) {
    process.stderr.write(
      `\n  You've used ${FREE_MONTHLY_LIMIT}/${FREE_MONTHLY_LIMIT} free runs this month.\n` +
      `  Upgrade to Team for unlimited runs: ${UPGRADE_URL}\n` +
      `  Already have a key? agent-trace activate <key>\n\n`
    );
    return false;
  }
  return true;
}

/** Increment usage counter and print a soft upsell footer. Call after a successful run. */
export function trackUsageAfterRun(): void {
  if (isProUser()) return;
  const usage = readSharedUsage();
  usage.total += 1;
  usage.tools[TOOL_NAME] = (usage.tools[TOOL_NAME] ?? 0) + 1;
  writeSharedUsage(usage);

  const used = usage.total;
  const remaining = FREE_MONTHLY_LIMIT - used;

  let msg: string;
  if (remaining === 0) {
    msg = `\n  ${used}/${FREE_MONTHLY_LIMIT} free Preflight runs used — cap reached.\n` +
          `  Upgrade to Team for unlimited runs: ${UPGRADE_URL}\n\n`;
  } else if (remaining <= 5) {
    msg = `\n  ${used}/${FREE_MONTHLY_LIMIT} free Preflight runs used — ${remaining} left this month.\n` +
          `  Team tier removes the cap · $49/mo → ${UPGRADE_URL}\n\n`;
  } else {
    msg = `\n  Run ${used} of ${FREE_MONTHLY_LIMIT} free Preflight runs this month.\n\n`;
  }
  process.stderr.write(msg);
}

/** Activate a license key and save it to the shared suite config. */
export function activateLicense(key: string): void {
  const result = validate(key);
  if (!result.valid) {
    process.stderr.write(`\nInvalid license key: ${result.reason}\n\n`);
    process.exit(1);
  }
  try {
    fs.mkdirSync(SUITE_DIR, { recursive: true });
    fs.writeFileSync(SUITE_LICENSE_FILE, JSON.stringify({ key }), 'utf8');
    console.log(`\nLicense activated (${result.tier} — ${result.org}). Unlimited runs enabled.\n`);
  } catch (e) {
    process.stderr.write(`\nFailed to save license: ${(e as Error).message}\n\n`);
    process.exit(1);
  }
}
