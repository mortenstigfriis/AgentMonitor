import fs from 'node:fs';
import path from 'node:path';

const roots = ['node_modules', 'server/node_modules', 'client/node_modules', 'relay/node_modules'];
const allowed = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
]);
const packages = new Map();

function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean);
    if (values.length === 1) return values[0];
    if (values.length > 1) return values.join(' OR ');
  }
  return null;
}

function inspectNodeModules(directory) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const packageDirectory = path.join(directory, entry.name);

    if (entry.name.startsWith('@')) {
      inspectNodeModules(packageDirectory);
      continue;
    }

    const manifestPath = path.join(packageDirectory, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name && manifest.version) {
      const key = `${manifest.name}@${manifest.version}`;
      packages.set(key, {
        name: manifest.name,
        version: manifest.version,
        license: declaredLicense(manifest) ?? 'UNKNOWN',
      });
    }

    inspectNodeModules(path.join(packageDirectory, 'node_modules'));
  }
}

for (const root of roots) inspectNodeModules(path.resolve(root));

const inventory = [...packages.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);
const rejected = inventory.filter((entry) => !allowed.has(entry.license));
const counts = Object.fromEntries(
  [...allowed]
    .map((license) => [license, inventory.filter((entry) => entry.license === license).length])
    .filter(([, count]) => count > 0),
);

console.log(JSON.stringify({ packages: inventory.length, licenses: counts, rejected }, null, 2));

if (rejected.length > 0) {
  console.error('License audit failed: unknown or non-approved dependency licenses found.');
  process.exitCode = 1;
}
