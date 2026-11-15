export const RUSSIAN_ARTICLE_NAME_CODEC = 'ger-ru-article-name-v1';

/** Decode the packed lowercase letters used by RU article names only.
 * Keep raw extraction untouched; tabs, newlines, CR and other controls are not letters.
 */
export function decodeRussianArticleName(value) {
  if (typeof value !== 'string') throw new TypeError('Russian article name must be a string');
  return value.replace(/[\x0b\x0c\x0e-\x1f]/g, (character) => {
    const code = character.charCodeAt(0);
    return String.fromCodePoint(code + (code <= 0x0c ? 0x425 : 0x424));
  });
}
