export const IMAGE_DECODER = 'ger-native-images-v2';
export const iconPath = (sheet) =>
  `bin/resconv_pc/data/GameData/menu/image/icon/ps4/fromgim/Common_Icon_Middle_${sheet}.gnf`;
export const nornPaths = (family) =>
  ['ps4/fromtga', 'fromgim', 'ps4/fromgim', 'ps4'].map(
    (dir) =>
      `bin/resconv_pc/data/GameData/g999_Base/ssa/${dir}/NORN_Aragami_${String(family).padStart(3, '0')}.gnf`,
  );

/** article.kst +0x04: low six bits select the shape, next six select its palette. */
export function inventoryIcon(packedIcon) {
  if (!Number.isInteger(packedIcon) || packedIcon < 0 || packedIcon > 65535) return null;
  const type = packedIcon & 63,
    palette = (packedIcon >>> 6) & 63;
  if (type <= 12 && palette <= 5)
    return { sheet: type < 8 ? 11 : 12, index: (type < 8 ? type : type - 8) * 6 + palette };
  if (type >= 16 && type <= 23) return { sheet: 13, index: type - 16 };
  if (type >= 24 && type <= 27 && palette <= 5)
    return { sheet: 14, index: (type - 24) * 6 + palette };
  return null;
}

export const equipmentReferencePath = (part) =>
  `bin/resconv_pc/src/god_menu/god_menu_Wpn${part}_reftbl.rtbl`;
export const shieldPosePath =
  'bin/resconv_pc/data/GameData/menu/model/EquipGenerate/fromgms/EG_Shield_Sword.ixo';
export const equipmentPosePath = (genre) =>
  `bin/resconv_pc/data/GameData/player/Weapon/Motion/Menu/fromgms/motionEquipChange${genre}.ixo`;
