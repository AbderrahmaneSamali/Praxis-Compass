import assert from 'node:assert/strict';
import test from 'node:test';

import { displayRomeSentence } from '../dist/exploration/rome-explorer.js';

test('doubled apostrophes from the ROME text export are undone for display', () => {
  assert.equal(
    displayRomeSentence("Développe des algorithmes d''apprentissage selon l''usage"),
    "Développe des algorithmes d'apprentissage selon l'usage",
  );
  assert.equal(displayRomeSentence('Sans apostrophe'), 'Sans apostrophe');
});
