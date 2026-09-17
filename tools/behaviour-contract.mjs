// Write docs/behaviour-contract.md from the test names themselves.
//
// The point: the tests are already the specification, written in English, and a
// rewrite in another language needs that specification more than it needs the
// JavaScript. Generated rather than typed, so it cannot drift from the suite.
//
//   node tools/behaviour-contract.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const nameOf = (line) => {
  const m = line.match(/^\s*(?:test|describe)\(\s*(['"`])([\s\S]*?)\1/);
  return m ? m[2].replace(/\\'/g, "'") : null;
};

const namesIn = (file) => readFileSync(file, 'utf8')
  .split('\n').map(nameOf).filter(Boolean);

const model = namesIn('tests/model.test.mjs');
const qr = namesIn('tests/qr.test.mjs');
const ui = readdirSync('tests/ui')
  .filter((f) => f.endsWith('.spec.js')).sort()
  .map((f) => ({ file: f, names: namesIn(join('tests/ui', f)) }));

const uiCount = ui.reduce((n, f) => n + f.names.length, 0);

const out = [];
out.push('# What this app promises');
out.push('');
out.push('**Generated — do not edit by hand.** Run `node tools/behaviour-contract.mjs`.');
out.push('');
out.push(`Every line below is a test that runs on every push and must pass before a version`);
out.push(`can be published. Together they are the specification of the app: ${model.length} rules about`);
out.push(`the logic, ${qr.length} about links and codes, and ${uiCount} about the app as you actually use it.`);
out.push('');
out.push('**If this app is ever rebuilt — in Swift or anything else — this is the list the new');
out.push('one has to satisfy.** Most of these are decisions nobody would arrive at twice by');
out.push('looking at the screen; they were argued out once, and a rewrite that does not know');
out.push('them will differ in ways that only show up months later, on a trip.');
out.push('');
out.push(`## The logic — \`js/model.js\` (${model.length})`);
out.push('');
out.push('Pure functions, no screen, no database. **This is the part to port first**, and these');
out.push('names are its acceptance list.');
out.push('');
model.forEach((n) => out.push(`- ${n}`));
out.push('');
out.push(`## Links, codes and sharing — \`js/qr.js\` (${qr.length})`);
out.push('');
qr.forEach((n) => out.push(`- ${n}`));
out.push('');
out.push(`## The app as you use it (${uiCount})`);
out.push('');
out.push('Driven through a real browser, every control found by its identifier rather than its');
out.push('wording. In a native app these become XCUITests against `accessibilityIdentifier`.');
out.push('');
ui.forEach(({ file, names }) => {
  out.push(`**${file}**`);
  out.push('');
  names.forEach((n) => out.push(`- ${n}`));
  out.push('');
});

writeFileSync('docs/behaviour-contract.md', out.join('\n') + '\n');
console.log(`docs/behaviour-contract.md — ${model.length} model · ${qr.length} qr · ${uiCount} ui = ${model.length + qr.length + uiCount} rules`);
