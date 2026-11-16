export const IMAGE_DECODER = 'ger-dds-texture-set-v1';
export const iconPath = (sheet) =>
  `bin/resconv_pc/data/GameData/menu/image/icon/ps4/fromgim/Common_Icon_Middle_${sheet}.gnf`;
export const nornPaths = (family) =>
  ['ps4/fromtga', 'fromgim', 'ps4/fromgim', 'ps4'].map(
    (dir) =>
      `bin/resconv_pc/data/GameData/g999_Base/ssa/${dir}/NORN_Aragami_${String(family).padStart(3, '0')}.gnf`,
  );

/** Neutral palette 5 expresses category only, without inventing an item rarity. */
export function inventoryIcon(categoryCode) {
  const kind = categoryCode & 255,
    subtype = categoryCode >>> 8;
  if (kind === 14 && subtype <= 5)
    return { sheet: subtype === 5 ? 12 : 11, index: (subtype === 5 ? 4 : subtype) * 6 + 5 };
  if (kind === 15 && subtype <= 3) return { sheet: 12, index: subtype * 6 + 5 };
  if (kind === 16 && subtype <= 2) return { sheet: 11, index: (subtype + 5) * 6 + 5 };
  if ((kind === 12 || kind === 13) && subtype <= 2)
    return { sheet: 13, index: kind === 12 ? 1 : 2 };
  if (categoryCode === 17) return { sheet: 13, index: 0 };
  if (kind === 10 && subtype <= 2) return { sheet: 14, index: subtype * 6 + 5 };
  return null;
}
