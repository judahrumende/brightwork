import { readFileSync, writeFileSync } from 'node:fs';

const kit = new URL('../kit/design-tokens.json', import.meta.url);
const output = new URL('../apps/web/src/styles/tokens.css', import.meta.url);
const { rootTokens, darkTokens } = JSON.parse(readFileSync(kit, 'utf8'));

const cloudAssets = new Map([
  ['--sky-grain-night', 'none'],
  ['--sky-grain-day', 'none'],
  ['--sky-still-night', 'var(--sky-fade-studio-night)'],
  ['--sky-still-day', 'var(--sky-fade-studio-day)'],
  ['--cloud-soft-day', 'none'],
  ['--cloud-soft-day-phone', 'none'],
  ['--cloud-soft-day-wide', 'none'],
]);

function css(selector, tokens) {
  const rows = Object.entries(tokens).map(([name, value]) => {
    const neutral = name
      .replace('--ted-', '--agent-')
      .replace('--hb-', '--workbench-');
    const original = cloudAssets.get(name) ?? value;
    if (/url\(/u.test(original))
      throw new Error(`Unmapped captured asset: ${name}`);
    const normalized = original
      .replaceAll('--ted-', '--agent-')
      .replaceAll('--hb-', '--workbench-');
    return `  ${neutral}: ${normalized};`;
  });
  return `${selector} {\n${rows.join('\n')}\n}\n`;
}

const content = `/* Generated from the kit's design tokens. */\n${css(':root', rootTokens)}\n${css(':root[data-theme="dark"]', darkTokens)}`;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== content)
    throw new Error('Generated design tokens are out of date');
} else {
  writeFileSync(output, content);
}
