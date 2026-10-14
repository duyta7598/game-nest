import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalog, parseDetail, sourceUrl, validMagnet } from '../src/main/parser';
import { article, magnet } from './fixture';

test('catalog extracts WordPress structure, sizes, entities and pagination', () => {
  const result = parseCatalog(
    `<main id="content">${article}<div class="nav-previous"><a href="/page/2/">Next</a></div></main>`,
    1,
  );
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].title, 'Fixture & Friends – Deluxe');
  assert.equal(result.games[0].repackSize, 'from 5 GB [Selective Download]');
  assert.equal(result.games[0].originalSize, '10 GB');
  assert.deepEqual(result.games[0].genres, ['Action', 'RPG']);
  assert.equal(result.hasNext, true);
});
test('catalog excludes announcements and duplicates', () => {
  const result = parseCatalog(
    `<main id="content"><article><h1 class="entry-title">Upcoming Repacks</h1><div class="entry-content">Announcement</div></article>${article}${article}</main>`,
    1,
  );
  assert.equal(result.games.length, 1);
});
test('empty search remains valid, challenge pages fail explicitly', () => {
  assert.equal(parseCatalog('<main id="content">Nothing found</main>', 1).games.length, 0);
  assert.throws(() => parseCatalog('<html><title>Just a moment</title></html>', 1), /xác minh/);
});
test('detail reads decoded magnet, plain description and repack features', () => {
  const detail = parseDetail(article, 'https://fitgirl-repacks.site/fixture/');
  assert.equal(detail.magnets[0].uri, magnet);
  assert.equal(detail.magnets[0].label, 'Tracker');
  assert.equal(detail.description, 'A fictional adventure.\n\nPlay with friends.');
  assert.equal(detail.features.length, 2);
});
test('source rejects foreign hosts, credentials, custom ports and lookalikes', () => {
  for (const url of [
    'https://evil.example/',
    'https://fitgirl-repacks.site.evil.example/',
    'http://fitgirl-repacks.site/',
    'https://user@fitgirl-repacks.site/',
    'https://fitgirl-repacks.site:1234/',
  ])
    assert.throws(() => sourceUrl(url));
  assert.equal(sourceUrl('/fixture/#comments'), 'https://fitgirl-repacks.site/fixture/');
});
test('magnet validation supports v1 and v2 and rejects unrelated URLs', () => {
  assert.equal(validMagnet(magnet), true);
  assert.equal(validMagnet(`magnet:?xt=urn:btmh:1220${'a'.repeat(64)}`), true);
  assert.equal(validMagnet('magnet:?xt=urn:btih:broken'), false);
  assert.equal(validMagnet('https://example.com/'), false);
  assert.equal(validMagnet(`magnet:?xt=urn:btih:${'A'.repeat(32)}`), true);
});
