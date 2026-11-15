import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRussianArticleName } from '../scripts/lib/game-text.mjs';

test('RU article codec decodes the recovered alphabet without consuming CR', () => {
  const packed = String.fromCharCode(0x0b, 0x0c, ...Array.from({ length: 18 }, (_, i) => i + 0x0e));
  assert.equal(decodeRussianArticleName(packed), 'абвгдежзийклмнопрсту');
  assert.equal(decodeRussianArticleName('\r'), '\r');
});

test('real article examples retain variants and decode Rigoletto, materials and equipment', () => {
  for (const [raw, expected] of [
    ['Р\u0014\u000f\u001a\u0017\u0011\u001e\u001e\u001a', 'Риголетто'],
    ['Р\u0014\u000f\u001a\u0017\u0011\u001e\u001e\u001a II', 'Риголетто II'],
    ['Р\u0014\u000f\u001a\u0017\u0011\u001e\u001e\u001a N', 'Риголетто N'],
    ['Р\u0014\u000f\u001a\u0017\u0011\u001e\u001e\u001a X', 'Риголетто X'],
    ['Ш\u0014\u001b \u001b\u0014\u0016\u001d\u0014', 'Шип пикси'],
    ['Н\u001a\u0012 P', 'Нож P'],
    ['Х\u001c\u001f\u001b\u0016\u0014\u0015 \u001e\u0014\u001e\u000b\u0019', 'Хрупкий титан'],
    ['Ж\u0011\u0017\u0011\u0013\u0019\u000bя \u0010\u000b\u0018\u000b', 'Железная дама'],
    ['С\u0011\u0019-Ж\u0011\u001c\u0018\u0011\u0019', 'Сен-Жермен'],
  ]) {
    assert.equal(decodeRussianArticleName(raw), expected);
    assert.equal(decodeRussianArticleName(expected), expected);
  }
});

test('ordinary Unicode, Roman suffixes, punctuation and unknown controls are unchanged', () => {
  const value = 'Ёж ёж + II EX N X: Rigoletto — Éclair\n\r\t\u0001';
  assert.equal(decodeRussianArticleName(value), value);
  assert.throws(() => decodeRussianArticleName(null), /must be a string/);
});
