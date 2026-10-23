import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const workspaces = ['server', 'client'];
const allowed = new Set([
  '0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-4.0',
  'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'Python-2.0',
]);
const installed = new Map();

const mitFallback = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean);
    return values.length === 1 ? values[0] : values.join(' OR ');
  }
  return 'UNKNOWN';
}

function scan(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const packageDirectory = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      scan(packageDirectory);
      continue;
    }
    const manifestPath = path.join(packageDirectory, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name && manifest.version) {
      const key = `${manifest.name}@${manifest.version}`;
      if (!installed.has(key)) installed.set(key, { directory: packageDirectory, manifest });
    }
    scan(path.join(packageDirectory, 'node_modules'));
  }
}

function packageName(location) {
  const marker = location.lastIndexOf('node_modules/');
  if (marker < 0) return null;
  const parts = location.slice(marker + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function runtimeKeys() {
  const keys = new Set();
  for (const workspace of workspaces) {
    const lock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json'), 'utf8'));
    for (const [location, metadata] of Object.entries(lock.packages || {})) {
      if (!location || metadata.dev === true || !metadata.version) continue;
      const name = packageName(location);
      if (name) keys.add(`${name}@${metadata.version}`);
    }
  }
  return [...keys].sort();
}

function licenseText(entry) {
  const candidate = fs.readdirSync(entry.directory).find((name) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
  );
  if (candidate) {
    return fs.readFileSync(path.join(entry.directory, candidate), 'utf8')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  }

  const license = declaredLicense(entry.manifest);
  if (license !== 'MIT') throw new Error(`Missing license text for ${entry.manifest.name}@${entry.manifest.version}`);
  const author = typeof entry.manifest.author === 'string'
    ? entry.manifest.author
    : entry.manifest.author?.name || 'See package repository for copyright attribution';
  return `Copyright attribution from package manifest: ${author}\n\n${mitFallback}`;
}

for (const workspace of workspaces) scan(path.resolve(workspace, 'node_modules'));

const packages = runtimeKeys().map((key) => {
  const entry = installed.get(key);
  if (!entry) throw new Error(`Runtime package is not installed: ${key}`);
  const license = declaredLicense(entry.manifest);
  if (!allowed.has(license)) throw new Error(`Unapproved license ${license} for ${key}`);
  const text = licenseText(entry);
  const notice = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  return { key, license, notice, text };
});

const notices = new Map();
for (const item of packages) {
  if (!notices.has(item.notice)) notices.set(item.notice, item.text);
}

const lines = [
  '# Third-party notices',
  '',
  'Generated from the reviewed `server/package-lock.json` and',
  '`client/package-lock.json`. Regenerate with `npm run licenses:notices`.',
  '',
  '| Package | License | Notice |',
  '| --- | --- | --- |',
  ...packages.map((item) => `| \`${item.key}\` | ${item.license} | ${item.notice} |`),
  '',
  '## License texts',
  '',
];

for (const [id, text] of [...notices].sort(([left], [right]) => left.localeCompare(right))) {
  lines.push(`### ${id}`, '', '```text', text, '```', '');
}

fs.writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n').trimEnd()}\n`, 'utf8');
console.log(`Wrote ${packages.length} package entries and ${notices.size} unique license texts.`);
