/**
 * Reads a setting the way people paste it into a hosting dashboard: surrounding spaces, quotes,
 * or the whole "NAME=value" line from a .env file are removed.
 */
export function envValue(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
  let value = env[name]?.trim();
  if (!value) return undefined;
  if (value.startsWith(`${name}=`)) value = value.slice(name.length + 1).trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return (quoted ? quoted[2]! : value).trim() || undefined;
}
