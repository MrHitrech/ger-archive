import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';

test('recovered Russian names keep native IDs, variants and unverified provenance', async () => {
  const data = await readDataset();
  for (const suffix of ['', ' II', ' N', ' X']) {
    const item = data.items.find((r) => r.name_en === `Rigoletto${suffix}`);
    const translation = data.translations.find((r) => r.id === item.id);
    assert.equal(translation.name_ru, `Риголетто${suffix}`);
    assert.equal(translation.status, 'unverified');
    assert.ok(
      translation.references.some((ref) => {
        const ev = data.evidence.find((r) => r.id === ref);
        return (
          ev?.game_origin?.resource === 'article_ru' &&
          ev.game_origin.row_id === item.game_origin.row_id
        );
      }),
    );
  }
  assert.ok(!data.translations.some((r) => r.name_ru && /[\x00-\x1f\x7f\ufffd]/.test(r.name_ru)));
});
