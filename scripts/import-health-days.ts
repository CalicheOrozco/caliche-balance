/**
 * Saves a file of Apple Health days (the format of the Claude connector's add_health_days, for
 * example made by Claude from the Health export) into one person's account, read and summed exactly
 * like the Shortcut's sends. Days already in the app keep the values the file does not bring.
 *
 *   node --env-file=.env --import tsx scripts/import-health-days.ts <file.json> <username> [--dry-run]
 *
 * Uses MONGODB_URI (and MONGODB_DB) from .env, so it writes to that database. --dry-run reads and
 * checks the file and says what it would save, without writing anything.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { connect } from "../server/db.ts";
import { healthDayInput, readHealthDaysInput } from "../server/healthDays.ts";
import { markHealthImported, saveHealthDays } from "../server/services.ts";

const [file, username, flag] = process.argv.slice(2);
if (!file || !username || (flag && flag !== "--dry-run")) {
  console.error("usage: node --env-file=.env --import tsx scripts/import-health-days.ts <file.json> <username> [--dry-run]");
  process.exit(1);
}
const dryRun = flag === "--dry-run";

const json: unknown = JSON.parse(readFileSync(file, "utf8"));
const list = z.array(healthDayInput).safeParse(Array.isArray(json) ? json : (json as { days?: unknown })?.days);
if (!list.success) {
  console.error("The file is not a list of days in the add_health_days format:", list.error.issues.slice(0, 5));
  process.exit(1);
}
const { parsed, skipped } = readHealthDaysInput(list.data);
const dates = parsed.map((d) => d.date).sort();
console.log(`${parsed.length} days to save (${dates[0]} to ${dates.at(-1)}), ${skipped.length} skipped`);
for (const s of skipped.slice(0, 20)) console.log(`  skipped ${s.date}: ${s.reason}`);

const c = await connect();
const user = await c.users.findOne({ username });
if (!user) {
  console.error(`No account with the username "${username}".`);
  process.exit(1);
}
if (dryRun) {
  const existing = await c.healthDays.countDocuments({ userId: user._id, date: { $in: dates } });
  console.log(`Dry run: ${existing} of those days already exist in the app and would get the file's values. Nothing was written.`);
  process.exit(0);
}

// In parts, so badges are checked a few times and not once per day.
const PART = 200;
let values = 0;
for (let i = 0; i < parsed.length; i += PART) {
  const { counts } = await saveHealthDays(c, undefined, user._id, parsed.slice(i, i + PART));
  values += counts.reduce((sum, d) => sum + d.count, 0);
  console.log(`  saved ${Math.min(i + PART, parsed.length)} / ${parsed.length}`);
}
await markHealthImported(c, user);
console.log(`Done: ${parsed.length} days, ${values} values.`);
process.exit(0);
