import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HUB_CARDS} from '../src/hub-catalog.js';

const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');

test('Code Watch interface and application metadata remain guild-neutral', () => {
  const files = [
    'public/index.html', 'public/admin.js', 'integrations/hub/index.html',
    'integrations/hub/navigation.patch', 'README.md', 'deployment.json',
    'src/ui.generated.js', 'src/hub-catalog.js'
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /Warhammer 420k/i, file+' should not show a historical guild name');
    assert.doesNotMatch(read(file), /420 Smoke Legion/i, file+' should be generic');
  }
  assert.match(read('public/index.html'), /<title>Tacticus Code Watch · M-TechLabs<\/title>/);
  assert.match(read('public/index.html'), /TACTICUS CODE WATCH/);
  assert.match(read('public/admin.js'), /GUILD ACCESS/);
  assert.match(HUB_CARDS.find(card=>card.id==='tacticus-code-watch').description, /personal redemptions/);
});
