export type Verification = 'verified' | 'partial' | 'unverified';
export type LanguageMode = 'both' | 'ru' | 'en';
export type EntityKind = 'material' | 'item' | 'mission' | 'aragami';
export interface GameOrigin {
  source_id: string;
  resource: string;
  row_id: number;
  resource_sha256: string;
  byte_offset?: number;
}
export interface BaseRecord {
  id: string;
  game: 'ger';
  name_en: string;
  verification_status: Verification;
  checked_at: string;
  references: string[];
  missing_fields: string[];
  game_origin?: GameOrigin;
}
export interface Material extends BaseRecord {
  category: string;
  ranks: number[];
  description_ru: string | null;
}
export interface Item extends BaseRecord {
  category: string;
  rank: number | null;
  family: string;
  elements: string[];
  stats: Record<string, number>;
  skills_en?: string[];
}
export interface Ingredient {
  material_id: string;
  quantity: number;
}
export interface Recipe extends BaseRecord {
  item_id: string;
  operation: 'craft' | 'upgrade';
  from_item_id: string | null;
  materials: Ingredient[];
  cost_fc: number | null;
  required_rank: number | null;
  unlock_conditions_raw?: Record<string, number | null>;
}
export interface Mission extends BaseRecord {
  rank: number | 'challenge';
  type: string;
  variant: string;
  location_id: string;
  aragami_ids: string[];
  objectives_en: string;
  story?: boolean;
  reward_table_status: 'partial' | 'missing' | 'complete';
  time_limit_seconds: number | null;
}
export interface Aragami extends BaseRecord {
  variant: string;
  breakable_parts: string[] | null;
  size: string | null;
}
export interface Drop extends BaseRecord {
  material_id: string;
  mission_id: string | null;
  aragami_id: string | null;
  location_id: string | null;
  method: string;
  condition_ru: string;
  condition_en: string;
  drop_rate: number | null;
  quantity: number | null;
  slot: string | null;
  source_url: string;
}
export interface Translation {
  id: string;
  name_en: string;
  name_ru: string | null;
  aliases: string[];
  source: string;
  status: 'official' | 'verified' | 'unverified';
}
export interface Source {
  id: string;
  title: string;
  url: string | null;
  authors_url: string | null;
  game_scope: string;
  acquisition: string;
  checked_at: string;
  revision: string | null;
  license: string;
  note_ru?: string;
  app_id?: string;
  build_id?: string;
  resources?: Record<
    string,
    { resource_path: string; sha256: string; archive: string; entry_hash: string }
  >;
}
export interface Evidence {
  id: string;
  source_id: string;
  game: 'ger';
  section: string;
  excerpt: string;
  snapshot: string;
  snapshot_sha256: string;
  game_origin?: GameOrigin;
}
export interface Coverage {
  total: number;
  verified: number;
  partial: number;
  unverified: number;
  incomplete: number;
  universe_total: number | null;
  missing_from_universe: number | null;
}
export interface ImportIssue {
  code: string;
  name: string;
  detail: string;
  source_id?: string;
  excerpt?: string;
}
export interface QualityReport {
  game: string;
  checked_at: string;
  completeness: string;
  notice_ru: string;
  coverage: Record<string, Coverage>;
  translations: {
    total: number;
    official: number;
    verified: number;
    drafts: number;
    missing: number;
  };
  issues: ImportIssue[];
  missing: { collection: string; id: string; name_en: string; fields: string[] }[];
}
export interface SearchEntry {
  id: string;
  kind: EntityKind;
  name_en: string;
  name_ru: string | null;
  aliases: string[];
  category: string;
  rank: number | 'challenge' | null;
  verification_status: Verification;
}
export interface Collections {
  materials: Material[];
  items: Item[];
  recipes: Recipe[];
  missions: Mission[];
  aragami: Aragami[];
  locations: BaseRecord[];
  drops: Drop[];
  evidence: Evidence[];
}
export type CollectionKey = keyof Collections;
export interface CraftTarget {
  id: string;
  recipe_id: string;
  quantity: number;
  mode: 'step' | 'chain';
  from_item_id: string | null;
  shared_instance: string | null;
  choices: Record<string, string>;
  completed: boolean;
}
export interface Progress {
  version: 1;
  language: LanguageMode;
  favorites: string[];
  recent: string[];
  inventory: Record<string, number>;
  targets: CraftTarget[];
}
