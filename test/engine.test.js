/**
 * Engine tests — the demo's promises, written down as assertions.
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createStore } from '../server/store.js';
import { LIBRARY } from '../data/corpus.js';
import { understand, findAmounts, findPhones, parseAmount, contentTokens } from '../server/nlp.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = () => createStore();

const ask = (s, q, opts) => s.ask(q, { limit: 6, ...opts });

describe('corpus', () => {
  test('ids are unique and every item has the fields the index needs', () => {
    const ids = new Set();
    for (const item of LIBRARY) {
      assert.ok(item.id, 'item has an id');
      assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
      ids.add(item.id);
      assert.ok(item.kind, `${item.id} has a kind`);
      assert.ok(item.source, `${item.id} has a source`);
      assert.ok(item.title, `${item.id} has a title`);
      assert.ok((item.body || '').length > 20, `${item.id} has indexable text`);
    }
  });

  test('every referenced view and image exists on disk', async () => {
    for (const item of LIBRARY) {
      if (item.view) await access(path.join(ROOT, 'data', 'views', item.view));
      if (item.image) await access(path.join(ROOT, 'public', item.image.replace(/^\//, '')));
    }
  });

  test('the story is consistent — the flight price is the same everywhere', () => {
    const flightItems = LIBRARY.filter((i) => (i.tags || []).includes('flights'));
    const texts = flightItems.map((i) => `${i.title} ${i.summary} ${i.body}`);
    for (const text of texts) {
      const amounts = findAmounts(text).map((a) => a.value);
      assert.ok(amounts.includes(9420), `expected R9 420 in: ${text.slice(0, 80)}`);
    }
  });
});

describe('text utilities', () => {
  test('money parsing handles the formats the library actually uses', () => {
    assert.equal(parseAmount('R9 420'), 9420);
    assert.equal(parseAmount('£1,925'), 1925);
    assert.equal(parseAmount('R3 182.90'), 3182.9);
    assert.equal(parseAmount('€390'), 390);
  });

  test('phone numbers are found but not mistaken for money', () => {
    const text = 'Contact card. Nkomo Auto Repairs, Salt River. Ask for Jabu. Phone 073 630 7561.';
    assert.deepEqual(findPhones(text).map((p) => p.value), ['0736307561']);
    assert.deepEqual(findAmounts(text), [], 'a phone number is not a rand amount');
  });

  test('"reference number 8842" is not a rand amount', () => {
    assert.deepEqual(findAmounts('Letting agent: Halcyon Residential, reference number 8842.'), []);
  });

  test('amounts on the receipt are all found', () => {
    const values = findAmounts('Subtotal R2 767.74, VAT R415.16, total R3 182.90.').map((a) => a.value);
    assert.deepEqual(values, [2767.74, 415.16, 3182.9]);
  });

  test('query understanding classifies the demo questions', () => {
    assert.equal(understand('What was that website with the cheap flights I found?').intent, 'which_site');
    assert.equal(understand('What was the name of the person who recommended that mechanic?').intent, 'who');
    assert.equal(understand('How much was the car service?').intent, 'how_much');
    assert.equal(understand('When did I look for flights?').intent, 'when');
    assert.equal(understand('Where is that cafe with the wifi?').intent, 'where');
  });

  test('browsing queries are recognised as browsing, not as facts', () => {
    const u = understand('Show me my screenshots');
    assert.deepEqual(u.kinds, ['screenshot']);
    assert.equal(u.browse, true);
    assert.equal(understand('What did I save about focus?').browse, false);
  });
});

describe('the two questions from the pitch', () => {
  test('“What was that website with the cheap flights I found?”', () => {
    const out = ask(store(), 'What was that website with the cheap flights I found?');
    assert.equal(out.answer.primary, 'shot-flights', 'the Skyscanner screenshot answers it');
    assert.equal(out.answer.headline, 'Skyscanner — from R9 420.');
    assert.ok(out.answer.confidence.score >= 0.75, `confidence should be high, got ${out.answer.confidence.score}`);
    assert.equal(out.answer.hedged, false);

    // The answer quotes the fare, and the same figure is corroborated elsewhere.
    const amount = out.answer.facts.find((f) => f.label === 'Amount');
    assert.equal(amount.value, 'R9 420');
    const sources = new Set(out.answer.evidence.map((e) => e.source));
    assert.ok(sources.has('Screenshots'), 'evidence includes the screenshot');
    assert.ok(sources.size >= 3, `evidence spans several sources, got ${[...sources].join(', ')}`);

    // The word "website" appears nowhere in the item — this is a meaning match.
    const item = LIBRARY.find((i) => i.id === 'shot-flights');
    assert.ok(!`${item.title} ${item.body}`.toLowerCase().includes('website'));
  });

  test('“What was the name of the person who recommended that mechanic?”', () => {
    const out = ask(store(), 'What was the name of the person who recommended that mechanic?');
    assert.equal(out.answer.headline, 'Thabo Nkosi.', 'the recommender, not the mechanic');
    assert.equal(out.answer.hedged, false);
    assert.ok(out.answer.confidence.score >= 0.7);

    // The phone number is in a different item than the one that matched best.
    const phone = out.answer.facts.find((f) => /^Phone/.test(f.label));
    assert.ok(phone, 'a phone number is surfaced');
    assert.equal(phone.value, '073 630 7561');
    assert.notEqual(phone.from, out.answer.primary, 'the number comes from a connected item');
    const sources = new Set(out.answer.evidence.map((e) => e.source));
    assert.ok(sources.has('Mail') && sources.has('Contacts'), `sources: ${[...sources].join(', ')}`);
  });
});

describe('answers are grounded', () => {
  const s = store();

  test('how much: the total, not a line item', () => {
    const out = ask(s, 'How much was the car service?');
    assert.equal(out.answer.headline, 'R3 182.90.');
    assert.equal(out.answer.primary, 'photo-receipt');
  });

  test('how much: a per-night price, not the stay total', () => {
    assert.equal(ask(s, 'How much was the Lisbon apartment a night?').answer.headline, '€78.');
  });

  test('how much: rent', () => {
    assert.equal(ask(s, 'How much was the flat in London?').answer.headline, '£1,925.');
  });

  test('who: a contact card the question named', () => {
    assert.equal(ask(s, 'Who is Jabu?').answer.headline, 'Jabu.');
  });

  test('where: uses the place the item recorded', () => {
    const out = ask(s, 'Where is that cafe with the wifi?');
    assert.match(out.answer.headline, /Camden/);
  });

  test('meaning-only query finds the item with no shared words', () => {
    const out = ask(s, 'the place with the pastries and the good wifi');
    assert.equal(out.results[0].id, 'photo-matcha');
    assert.ok(out.results[0].signals.semantic > 0.5, 'matched on meaning');
  });

  test('every headline value appears in the item it points at', () => {
    for (const question of [
      'How much was the car service?',
      'How much was the flat in London?',
      'What was that website with the cheap flights I found?'
    ]) {
      const out = ask(s, question);
      const item = LIBRARY.find((i) => i.id === out.answer.primary);
      const text = `${item.title} ${item.summary} ${item.body}`;
      const number = out.answer.headline.replace(/[^\d]/g, '');
      assert.ok(text.replace(/[^\d]/g, '').includes(number), `${number} is in ${item.id}`);
    }
  });
});

describe('honesty', () => {
  const s = store();

  test('a question the library cannot answer is refused', () => {
    const out = ask(s, 'What did I watch on Netflix?');
    assert.equal(out.results.length, 0);
    assert.match(out.answer.headline, /Nothing in your library matches/);
  });

  test('a question with a word the phone has never seen is hedged, not invented', () => {
    const out = ask(s, 'Where did I park the car?');
    assert.equal(out.answer.hedged, true);
    assert.match(out.answer.headline, /Nothing on your phone mentions “park”/);
    assert.ok(out.answer.confidence.score <= 0.42, 'hedged answers are capped');
  });

  test('conversational filler does not trigger a false refusal', () => {
    for (const q of ['the spot where the tables are long and there are plug points', 'somewhere quiet to work in the morning']) {
      assert.equal(ask(s, q).answer.hedged, false, q);
    }
  });

  test('a confident answer is not hedged', () => {
    for (const q of ['What did I save about focus?', 'Who was the host in Lisbon?', 'What was the API v2 cutover date?']) {
      assert.equal(ask(s, q).answer.hedged, false, q);
    }
  });

  test('low extraction quality is reflected in confidence', () => {
    const blurry = ask(s, 'the blurry sunset photo');
    const match = blurry.results.find((r) => r.id === 'photo-sunset');
    if (match) assert.ok(match.trust < 0.7, `blurry item is trusted less, got ${match.trust}`);
  });
});

describe('library changes at runtime', () => {
  test('a new item is indexed immediately and can answer its own question', () => {
    const s = store();
    const before = s.stats().indexed;
    const added = s.addItem({
      id: 'test-item',
      kind: 'message',
      source: 'Messages',
      title: 'Test · the spare key',
      daysAgo: 0,
      summary: 'The spare key is with Nomsa in the top drawer.',
      body: 'Message: the spare key is with Nomsa, it is in the top drawer of the desk. Do not forget again.',
      tags: ['key', 'nomsa']
    }, 'test');
    assert.ok(added, 'item was added');
    assert.equal(s.stats().indexed, before + 1);
    assert.equal(s.ask('where is the spare key?').results[0].id, 'test-item');
    assert.deepEqual(s.reset(), { indexed: before }, 'reset restores the library');
  });
});

describe('ranking behaviour', () => {
  const s = store();

  test('“show me my screenshots” browses newest-first within the filter', () => {
    const out = ask(s, 'Show me my screenshots');
    assert.ok(out.results.length >= 3);
    assert.ok(out.results.every((r) => r.kind === 'screenshot'), 'only screenshots');
    const days = out.results.map((r) => r.daysAgo);
    assert.deepEqual(days, [...days].sort((a, b) => a - b), 'newest first');
  });

  test('“last month” narrows the window', () => {
    const withWindow = ask(s, 'What did I save in the last month?');
    assert.equal(withWindow.understanding.window, 30);
    assert.ok(withWindow.results.every((r) => (r.daysAgo ?? 0) <= 30), 'nothing older leaks in');
  });

  test('kind filters are honoured', () => {
    const out = ask(s, 'photos of Lisbon');
    const withKind = out.results.filter((r) => r.kind === 'photo');
    assert.ok(withKind.length >= 1);
  });

  test('extraction problems are visible in the payload', () => {
    const out = ask(s, 'the blurry sunset');
    for (const r of out.results) {
      assert.ok(r.trust > 0 && r.trust <= 1, `trust in range for ${r.id}`);
      assert.ok(r.why.length > 0, 'every result explains itself');
    }
  });

  test('search stays fast', () => {
    const started = Date.now();
    for (let i = 0; i < 20; i++) s.search('cheap flights to london');
    const per = (Date.now() - started) / 20;
    assert.ok(per < 50, `expected <50ms per query, got ${per.toFixed(1)}ms`);
  });
});
