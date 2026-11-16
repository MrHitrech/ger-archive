import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Gem,
  Search,
  Shield,
  Skull,
  Swords,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from './context';
import { useCollections } from './lib/data';
import type { BaseRecord, EntityKind, SearchEntry, Verification } from './types';

export const categories: Record<string, string> = {
  short_blade: 'Короткий клинок',
  long_blade: 'Длинный клинок',
  buster_blade: 'Тяжёлый клинок',
  boost_hammer: 'Ускоряющий молот',
  charge_spear: 'Зарядное копьё',
  variant_scythe: 'Коса',
  sniper: 'Снайперская винтовка',
  assault: 'Штурмовая пушка',
  blast: 'Бласт-пушка',
  shotgun: 'Дробовик',
  buckler: 'Баклер',
  shield: 'Щит',
  tower_shield: 'Башенный щит',
  upgrade: 'Модуль улучшения',
  consumable: 'Расходуемый предмет',
  clothing_top: 'Верхняя одежда',
  clothing_bottom: 'Нижняя одежда',
  mineral: 'Минерал',
  synthetic: 'Синтетический материал',
  organic: 'Органический материал',
  aragami: 'Материал арагами',
  unknown: 'Категория не уточнена',
};
export const kindLabels: Record<EntityKind, string> = {
  material: 'Материал',
  item: 'Снаряжение',
  mission: 'Миссия',
  aragami: 'Арагами',
};
export const routeFor = (entry: Pick<SearchEntry, 'id' | 'kind'>) =>
  `/${{ material: 'materials', item: 'craft', mission: 'missions', aragami: 'aragami' }[entry.kind]}/${entry.id}`;
export const methods: Record<string, string> = {
  mission_reward: 'Автоматически',
  bonus_reward: 'За выполнение условий',
  break: 'Раскол защиты',
  devour: 'Пожирание',
  gather: 'Сбор на локации',
  shop: 'Покупка',
  exchange: 'Обмен / синтез',
};
export const missionTypes: Record<string, string> = {
  standard: 'Стандартная',
  urgent: 'Срочная',
  extra: 'Дополнительная',
  challenge: 'Испытание',
  tutorial: 'Обучение',
};
export const elements: Record<string, string> = {
  blaze: 'Огонь',
  freeze: 'Лёд',
  spark: 'Молния',
  divine: 'Свет',
};
export const number = (n: number) => n.toLocaleString('ru-RU');

export function EntityName({ id, compact = false }: { id: string; compact?: boolean }) {
  const { name, english, progress, translations } = useApp();
  const t = translations.get(id);
  return (
    <span className={`entity-name ${compact ? 'compact' : ''}`}>
      <span>{name(id)}</span>
      {progress.language === 'both' && t?.name_ru && <small>{english(id)}</small>}
      {progress.language !== 'en' && !t?.name_ru && (
        <small className="muted">перевод не найден</small>
      )}
    </span>
  );
}
export function EntityLink({
  id,
  kind,
  compact = false,
}: {
  id: string;
  kind: EntityKind;
  compact?: boolean;
}) {
  return (
    <Link className="entity-link" to={routeFor({ id, kind })}>
      <EntityName id={id} compact={compact} />
    </Link>
  );
}
export function FavoriteButton({ id }: { id: string }) {
  const { progress, toggleFavorite, name } = useApp();
  const active = progress.favorites.includes(id);
  return (
    <button
      className={`icon-button favorite ${active ? 'selected' : ''}`}
      onClick={() => toggleFavorite(id)}
      aria-label={`${active ? 'Убрать из избранного' : 'В избранное'}: ${name(id)}`}
      aria-pressed={active}
      title={active ? 'Убрать из избранного' : 'В избранное'}
    >
      <Bookmark size={17} fill={active ? 'currentColor' : 'none'} />
    </button>
  );
}
export function StatusBadge({ status = 'partial' }: { status?: Verification }) {
  return (
    <span className={`status-badge ${status}`}>
      {status === 'verified' ? <Check size={12} /> : <CircleHelp size={12} />}
      {status === 'verified'
        ? 'Проверено'
        : status === 'partial'
          ? 'Частичные данные'
          : 'Не подтверждено'}
    </span>
  );
}
export function RecordIcon({
  kind = 'material',
  category = '',
  large = false,
}: {
  kind?: EntityKind;
  category?: string;
  large?: boolean;
}) {
  const Icon: LucideIcon =
    kind === 'aragami'
      ? Skull
      : kind === 'mission'
        ? ArrowRight
        : kind === 'item'
          ? category.includes('shield') || category === 'buckler'
            ? Shield
            : Swords
          : Gem;
  return (
    <span className={`record-icon ${kind} ${large ? 'large' : ''}`}>
      <Icon size={large ? 32 : 21} strokeWidth={1.4} />
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="description">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function CoverageBar({ collection }: { collection: string }) {
  const { report } = useApp();
  const c = report.coverage[collection];
  if (!c) return null;
  return (
    <div className="coverage-bar">
      <span>
        <b>{number(c.total)}</b> записей
      </span>
      <span className="green">
        <i />
        {c.verified} проверено
      </span>
      <span>
        <i className="amber-dot" />
        {c.incomplete} с пробелами
      </span>
      <Link to="/sources" className="coverage-link">
        Полнота не установлена <ExternalLink size={12} />
      </Link>
    </div>
  );
}
export function Empty({
  title = 'Ничего не найдено',
  text = 'Попробуйте другое название или сбросьте фильтры.',
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Search size={28} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Loading({ error, retry }: { error?: string | null; retry?: () => void }) {
  return (
    <div className="loading-state" role={error ? 'alert' : 'status'}>
      {error ? (
        <>
          <TriangleAlert size={24} />
          <p>{error}</p>
          <button className="button secondary" onClick={retry}>
            Повторить
          </button>
        </>
      ) : (
        <>
          <span className="loading-mark" />
          <p>Загружаем раздел…</p>
        </>
      )}
    </div>
  );
}
export function RankSelect({
  value,
  onChange,
  challenge = false,
  label = 'Сложность',
}: {
  value: string;
  onChange: (v: string) => void;
  challenge?: boolean;
  label?: string;
}) {
  return (
    <label className="filter-label">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Все уровни</option>
        {Array.from({ length: 14 }, (_, i) => (
          <option key={i} value={i + 1}>
            {i + 1}
          </option>
        ))}
        {challenge && <option value="challenge">Испытания</option>}
      </select>
    </label>
  );
}
export function Pager({
  page,
  setPage,
  total,
  size = 24,
}: {
  page: number;
  setPage: (n: number) => void;
  total: number;
  size?: number;
}) {
  const pages = Math.ceil(total / size);
  if (pages < 2) return null;
  return (
    <nav className="pager" aria-label="Страницы результатов">
      <span>
        {(page - 1) * size + 1}–{Math.min(page * size, total)} из {total}
      </span>
      <div>
        <button
          className="icon-button"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="icon-button"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
          aria-label="Следующая страница"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}
export function SearchBox({
  kind,
  initial = '',
  large = false,
}: {
  kind?: EntityKind;
  initial?: string;
  large?: boolean;
}) {
  const { search, name } = useApp();
  const [query, setQuery] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const options = query.trim() ? search(query, kind).slice(0, 6) : [];
  useEffect(() => {
    setQuery(initial);
  }, [initial]);
  useEffect(() => {
    const handle = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handle);
    return () => document.removeEventListener('pointerdown', handle);
  }, []);
  function go(entry?: SearchEntry) {
    setOpen(false);
    if (entry) navigate(routeFor(entry));
    else
      navigate(
        `/${!kind ? 'search' : kind === 'item' ? 'craft' : kind === 'mission' ? 'missions' : kind === 'aragami' ? 'aragami' : 'materials'}?q=${encodeURIComponent(query)}`,
      );
  }
  return (
    <div
      ref={container}
      className={`search-box ${large ? 'large-search' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(active >= 0 ? options[active] : undefined);
        }}
      >
        <Search size={large ? 23 : 18} />
        <input
          value={query}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && open ? `${id}-${active}` : undefined}
          aria-label="Поиск по русскому или английскому названию"
          placeholder={large ? 'Название на русском или английском…' : 'Найти в архиве…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            }
            if (e.key === 'Escape') {
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить поиск"
            onClick={() => {
              setQuery('');
              setActive(-1);
            }}
          >
            <X size={16} />
          </button>
        )}
        <button
          type="submit"
          className={large ? 'search-submit' : 'small-search-submit'}
          aria-label="Найти"
        >
          <span>{large ? 'Найти' : ''}</span>
          <ArrowRight size={18} />
        </button>
      </form>
      {open && options.length > 0 && (
        <ul
          className="search-suggestions"
          id={`${id}-list`}
          role="listbox"
          aria-label="Подсказки поиска"
        >
          {options.map((e, i) => (
            <li
              role="option"
              id={`${id}-${i}`}
              key={e.id}
              aria-selected={i === active}
              onPointerMove={() => setActive(i)}
            >
              <button type="button" tabIndex={-1} onClick={() => go(e)}>
                <RecordIcon kind={e.kind} category={e.category} />
                <span>
                  <b>{name(e.id)}</b>
                  <small>{e.name_en}</small>
                </span>
                <span className="suggestion-kind">{kindLabels[e.kind]}</span>
                <ArrowRight size={14} />
              </button>
            </li>
          ))}
          <li className="suggestion-tip" role="presentation">
            <ArrowDown size={12} /> для выбора <kbd>Enter</kbd> открыть
          </li>
        </ul>
      )}
    </div>
  );
}
export function DetailHeader({
  record,
  kind,
  category,
}: {
  record: BaseRecord;
  kind: EntityKind;
  category?: string;
}) {
  const { translations, visit, english, name, progress, sources } = useApp();
  useEffect(() => {
    visit(record.id);
    document.title = `${name(record.id)} — GER Archive`;
  }, [record.id]); // record visit should not rerun when local progress changes
  const t = translations.get(record.id);
  const gameTranslation = sources.some((s) => s.id === t?.source && s.acquisition === 'game_files');
  return (
    <>
      <Link className="back-link" to={routeFor({ id: '', kind }).replace(/\/$/, '')}>
        <ChevronLeft size={14} />
        {
          {
            material: 'Материалы',
            item: 'Крафт и снаряжение',
            mission: 'Миссии',
            aragami: 'Арагами',
          }[kind]
        }
      </Link>
      <header className="detail-heading">
        <RecordIcon kind={kind} category={category} large />
        <div>
          <div className="detail-meta">
            <span className="eyebrow">
              {category ? categories[category] || category : kindLabels[kind]}
            </span>
            <StatusBadge status={record.verification_status} />
          </div>
          <h1>{name(record.id)}</h1>
          {t?.name_ru && progress.language === 'both' && (
            <p className="english-title">{english(record.id)}</p>
          )}
          <p className="translation-note">
            {t?.name_ru
              ? t.status === 'unverified'
                ? gameTranslation
                  ? 'Название из установленной игры · требует проверки'
                  : 'Черновой перевод проекта · требует проверки'
                : t.status === 'official'
                  ? 'Подтверждённое официальное название'
                  : 'Проверенный неофициальный перевод'
              : 'Перевод не найден'}
          </p>
        </div>
        <FavoriteButton id={record.id} />
      </header>
      <div className="data-note">
        <CircleHelp size={16} />
        <span>
          {record.game_origin
            ? 'Данные дополнены из файлов игры. Доступность контента и условия открытия ещё требуют проверки в игре.'
            : 'Сведения получены из поисковой копии Wiki. Ручная проверка по оригиналу или игре ещё не завершена.'}
        </span>
        <Link to="/sources">
          О данных <ArrowRight size={13} />
        </Link>
      </div>
    </>
  );
}
export function SourceReferences({
  references,
  translationId,
}: {
  references: string[];
  translationId?: string;
}) {
  const { data, error, retry } = useCollections('evidence');
  const { sources, translations } = useApp();
  if (!data) return <Loading error={error} retry={retry} />;
  const entries = [
    ...new Set([
      ...references,
      ...(translationId ? (translations.get(translationId)?.references ?? []) : []),
    ]),
  ]
    .map((ref) => data.evidence.find((e) => e.id === ref))
    .filter((e) => e !== undefined);
  return (
    <section className="panel source-panel">
      <div className="section-heading">
        <h2>Происхождение данных</h2>
        <span className="muted">{entries.length} свидетельств</span>
      </div>
      {entries.map((ev) => {
        const source = sources.find((s) => s.id === ev.source_id);
        return (
          <details key={ev.id} className="source-reference">
            <summary>
              <ExternalLink size={14} />
              <span>
                {source?.title || ev.source_id}
                <small>{ev.section}</small>
              </span>
            </summary>
            <div className="source-reference-body">
              <p>
                {source?.acquisition === 'game_files'
                  ? `Сборка ${source.build_id} · строка ${ev.game_origin?.row_id} · извлечено ${source.checked_at}.`
                  : `Копия: ${ev.snapshot} · проверена ${source?.checked_at}. Ревизия оригинала неизвестна.`}
              </p>
              {ev.game_origin && (
                <p>{source?.resources?.[ev.game_origin.resource]?.resource_path}</p>
              )}
              {source?.url && (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Открыть оригинальную страницу <ExternalLink size={13} />
                </a>
              )}
              {source?.authors_url && (
                <a href={source.authors_url} target="_blank" rel="noreferrer">
                  Авторы и история правок <ExternalLink size={13} />
                </a>
              )}
              <pre>{ev.excerpt}</pre>
              <p className="hash">SHA-256 копии: {ev.snapshot_sha256}</p>
              {ev.game_origin && (
                <p className="hash">SHA-256 ресурса: {ev.game_origin.resource_sha256}</p>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}
export function SectionHeading({
  title,
  count,
  link,
  children,
}: {
  title: string;
  count?: number;
  link?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {link ? (
        <Link className="text-link" to={link}>
          Смотреть все <ArrowRight size={14} />
        </Link>
      ) : (
        children
      )}
    </div>
  );
}
