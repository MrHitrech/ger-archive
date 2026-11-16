import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Filter, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../context';
import {
  categories,
  CoverageBar,
  Empty,
  EntityLink,
  EntityName,
  FavoriteButton,
  Loading,
  missionTypes,
  PageTitle,
  Pager,
  RankSelect,
  RecordIcon,
  AragamiArtwork,
  StatusBadge,
  elements,
} from '../components';
import { useCollections } from '../lib/data';
import { equipmentFamilies, equipmentStatLabels, formatEquipmentStat } from '../lib/equipment';
import {
  isMissionRoot,
  matchesMissionRank,
  matchesMissionType,
  missionPhases,
} from '../lib/missions';
import type { EntityKind } from '../types';

function useFilters(kind: EntityKind) {
  const [params, setParams] = useSearchParams();
  const { search } = useApp();
  const [page, setPage] = useState(1);
  const q = params.get('q') || '';
  const ids = useMemo(() => new Set(search(q, kind).map((e) => e.id)), [search, q, kind]);
  const order = useMemo(() => new Map(search(q, kind).map((e, i) => [e.id, i])), [search, q, kind]);
  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  }
  useEffect(() => {
    setPage(1);
  }, [params.toString()]);
  return {
    params,
    set,
    q,
    ids,
    order,
    page,
    setPage,
    reset: () => {
      setParams({});
      setPage(1);
    },
  };
}
function FilterSearch({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  return (
    <label className="catalog-search">
      <Search size={18} />
      <input
        aria-label="Поиск по названиям"
        placeholder="Название на русском или английском"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-button" aria-label="Очистить поиск" onClick={() => onChange('')}>
          <X size={15} />
        </button>
      )}
    </label>
  );
}
function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="text-link reset-filters" onClick={onClick}>
      <X size={13} />
      Сбросить фильтры
    </button>
  );
}

export function MaterialCatalog() {
  const { data, error, retry } = useCollections('materials', 'drops', 'recipes');
  const { name } = useApp();
  const f = useFilters('material');
  if (!data) return <Loading error={error} retry={retry} />;
  const rank = f.params.get('rank') || '';
  const cat = f.params.get('category') || '';
  const sourced = f.params.get('sourced') === 'yes';
  const verified = f.params.get('verified') === 'yes';
  const rows = data.materials
    .filter(
      (m) =>
        f.ids.has(m.id) &&
        (!rank || m.ranks.includes(Number(rank))) &&
        (!cat || m.category === cat) &&
        (!sourced || data.drops.some((d) => d.material_id === m.id)) &&
        (!verified || m.verification_status === 'verified'),
    )
    .sort((a, b) =>
      f.q
        ? (f.order.get(a.id) ?? 0) - (f.order.get(b.id) ?? 0)
        : name(a.id).localeCompare(name(b.id), 'ru'),
    );
  const page = Math.min(f.page, Math.max(1, Math.ceil(rows.length / 24)));
  return (
    <>
      <PageTitle
        eyebrow="Архив / 01"
        title="Материалы"
        description="Найдите ресурс, способы получения и рецепты, в которых он нужен."
      />
      <CoverageBar collection="materials" />
      <div className="filter-panel">
        <FilterSearch value={f.q} onChange={(q) => f.set('q', q)} />
        <div className="filter-row">
          <label className="filter-label">
            <span>Категория</span>
            <select value={cat} onChange={(e) => f.set('category', e.target.value)}>
              <option value="">Все категории</option>
              {['mineral', 'synthetic', 'organic', 'aragami', 'unknown'].map((k) => (
                <option value={k} key={k}>
                  {categories[k]}
                </option>
              ))}
            </select>
          </label>
          <RankSelect
            value={rank}
            onChange={(v) => f.set('rank', v)}
            label="Известная доступность"
          />
          <label className="check-label">
            <input
              type="checkbox"
              checked={sourced}
              onChange={(e) => f.set('sourced', e.target.checked ? 'yes' : '')}
            />
            Есть способ получения
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => f.set('verified', e.target.checked ? 'yes' : '')}
            />
            Только проверенные
          </label>
          <ResetButton onClick={f.reset} />
        </div>
      </div>
      <div className="results-header">
        <span>
          Найдено <b>{rows.length}</b>
        </span>
        <span>
          <SlidersHorizontal size={13} />
          {f.q ? 'По совпадению' : 'По названию'}
        </span>
      </div>
      {rows.length ? (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Материал</th>
                <th>Категория</th>
                <th>Доступность</th>
                <th>Способы получения</th>
                <th>Статус</th>
                <th>
                  <span className="sr-only">Избранное</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((page - 1) * 24, page * 24).map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="cell-name">
                      <RecordIcon id={m.id} />
                      <EntityLink id={m.id} kind="material" />
                    </div>
                  </td>
                  <td className="muted">{categories[m.category]}</td>
                  <td>
                    {m.ranks.length ? (
                      m.ranks.join(', ')
                    ) : (
                      <span className="muted">Не установлена</span>
                    )}
                  </td>
                  <td>
                    {data.drops.filter((d) => d.material_id === m.id).length || (
                      <span className="muted">Пока не добавлены</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={m.verification_status} />
                  </td>
                  <td>
                    <FavoriteButton id={m.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          action={
            <button className="button secondary" onClick={f.reset}>
              Сбросить фильтры
            </button>
          }
        />
      )}
      <Pager page={page} setPage={f.setPage} total={rows.length} />
      <p className="footnote">
        Ранги обозначают известные случаи получения. Отсутствие ранга означает, что доступность ещё
        не установлена.
      </p>
    </>
  );
}

export function CraftCatalog() {
  const { data, error, retry } = useCollections('items', 'recipes');
  const { name, progress } = useApp();
  const f = useFilters('item');
  if (!data) return <Loading error={error} retry={retry} />;
  const category = f.params.get('category') || '';
  const rank = f.params.get('rank') || '';
  const element = f.params.get('element') || '';
  const family = f.params.get('family') || '';
  const operation = f.params.get('operation') || '';
  const verified = f.params.get('verified') === 'yes';
  const rows = data.items
    .filter(
      (i) =>
        f.ids.has(i.id) &&
        (!category || i.category === category) &&
        (!rank || i.rank === Number(rank)) &&
        (!element || i.elements.includes(element)) &&
        (!family || i.family === family) &&
        (!operation ||
          (operation === 'next'
            ? data.recipes.some((r) => r.from_item_id === i.id)
            : data.recipes.some((r) => r.item_id === i.id && r.operation === operation))) &&
        (!verified || i.verification_status === 'verified'),
    )
    .sort((a, b) =>
      f.q
        ? (f.order.get(a.id) ?? 0) - (f.order.get(b.id) ?? 0)
        : (a.rank ?? 99) - (b.rank ?? 99) || name(a.id).localeCompare(name(b.id), 'ru'),
    );
  const page = Math.min(f.page, Math.max(1, Math.ceil(rows.length / 24)));
  return (
    <>
      <PageTitle
        eyebrow="Архив / 02"
        title="Крафт и снаряжение"
        description="Рецепты создания, стоимость улучшений и отдельные ветки развития."
        action={
          <Link className="button secondary" to="/planner">
            План крафта{' '}
            <span className="button-count">
              {progress.targets.filter((t) => !t.completed).length}
            </span>
            <ArrowRight size={15} />
          </Link>
        }
      />
      <CoverageBar collection="items" />
      <div className="filter-panel">
        <FilterSearch value={f.q} onChange={(q) => f.set('q', q)} />
        <div className="filter-row">
          <label className="filter-label">
            <span>Тип снаряжения</span>
            <select value={category} onChange={(e) => f.set('category', e.target.value)}>
              <option value="">Все типы</option>
              {Object.keys(categories)
                .filter(
                  (k) => !['mineral', 'synthetic', 'organic', 'aragami', 'unknown'].includes(k),
                )
                .map((k) => (
                  <option value={k} key={k}>
                    {categories[k]}
                  </option>
                ))}
            </select>
          </label>
          <RankSelect value={rank} onChange={(v) => f.set('rank', v)} label="Ранг" />
          <label className="filter-label">
            <span>Элемент</span>
            <select value={element} onChange={(e) => f.set('element', e.target.value)}>
              <option value="">Все элементы</option>
              {Object.entries(elements).map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-label">
            <span>Семейство</span>
            <select value={family} onChange={(e) => f.set('family', e.target.value)}>
              <option value="">Все семейства</option>
              {equipmentFamilies(data.items, name, category).map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-label">
            <span>Рецепт</span>
            <select value={operation} onChange={(e) => f.set('operation', e.target.value)}>
              <option value="">Любая операция</option>
              <option value="craft">Создание с нуля</option>
              <option value="upgrade">Улучшение</option>
              <option value="next">Есть следующее улучшение</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => f.set('verified', e.target.checked ? 'yes' : '')}
            />
            Проверенные
          </label>
          <ResetButton onClick={f.reset} />
        </div>
      </div>
      <div className="results-header">
        <span>
          Найдено <b>{rows.length}</b>
        </span>
        <span>
          <Filter size={13} />
          {f.q ? 'По совпадению' : 'По рангу'}
        </span>
      </div>
      {rows.length ? (
        <div className="equipment-grid">
          {rows.slice((page - 1) * 24, page * 24).map((item) => {
            const r = data.recipes.find((r) => r.item_id === item.id);
            return (
              <article className="equipment-card" key={item.id}>
                <div className="equipment-card-top">
                  <RecordIcon id={item.id} kind="item" category={item.category} />
                  <span className="rank-label">Ранг {item.rank ?? 'не установлен'}</span>
                  <FavoriteButton id={item.id} />
                </div>
                <Link className="equipment-title" to={`/craft/${item.id}`}>
                  <EntityName id={item.id} />
                </Link>
                <p>{categories[item.category]}</p>
                <div className="equipment-stats">
                  {Object.entries(item.stats).map(([k, v]) => (
                    <span key={k}>
                      {equipmentStatLabels[k] || k} <b>{formatEquipmentStat(item, v)}</b>
                    </span>
                  ))}
                  {item.elements.map((e) => (
                    <span key={e} className={`element ${e}`}>
                      {elements[e]}
                    </span>
                  ))}
                </div>
                <div className="equipment-card-bottom">
                  <span>
                    {r?.operation === 'upgrade' ? 'Улучшение' : 'Создание'} ·{' '}
                    {r?.cost_fc?.toLocaleString('ru-RU') ?? '—'} FC
                  </span>
                  <Link to={`/craft/${item.id}`} aria-label={`Открыть ${name(item.id)}`}>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          action={
            <button className="button secondary" onClick={f.reset}>
              Сбросить фильтры
            </button>
          }
        />
      )}
      <Pager page={page} setPage={f.setPage} total={rows.length} />
      <p className="footnote">
        В каталоге отображаются только импортированные ветки. Наличие фильтра не означает, что
        соответствующая категория уже заполнена.
      </p>
    </>
  );
}

export function MissionCatalog() {
  const { data, error, retry } = useCollections(
    'missions',
    'aragami',
    'drops',
    'materials',
    'locations',
  );
  const { name } = useApp();
  const f = useFilters('mission');
  if (!data) return <Loading error={error} retry={retry} />;
  const rank = f.params.get('rank') || '';
  const enemy = f.params.get('enemy') || '';
  const material = f.params.get('material') || '';
  const type = f.params.get('type') || '';
  const phases = new Map(
    data.missions
      .filter((m) => isMissionRoot(m))
      .map((m) => [m.id, missionPhases(m, data.missions)]),
  );
  const rows = data.missions
    .filter(
      (m) =>
        isMissionRoot(m) &&
        phases.get(m.id)!.some((p) => f.ids.has(p.id)) &&
        matchesMissionRank(m, rank) &&
        (!enemy || phases.get(m.id)!.some((p) => p.aragami_ids.includes(enemy))) &&
        (!material ||
          data.drops.some(
            (d) =>
              phases.get(m.id)!.some((p) => p.id === d.mission_id) && d.material_id === material,
          )) &&
        matchesMissionType(m, type),
    )
    .sort((a, b) =>
      f.q
        ? (f.order.get(a.id) ?? 0) - (f.order.get(b.id) ?? 0)
        : (a.rank === 'challenge' ? 15 : a.rank) - (b.rank === 'challenge' ? 15 : b.rank) ||
          name(a.id).localeCompare(name(b.id), 'ru'),
    );
  const page = Math.min(f.page, Math.max(1, Math.ceil(rows.length / 24)));
  return (
    <>
      <PageTitle
        eyebrow="Архив / 03"
        title="Миссии"
        description="Сложности 1–14, обучения, срочные и дополнительные задания. Этапы выживания объединены в одну миссию."
      />
      <CoverageBar collection="missions" />
      <div className="filter-panel">
        <FilterSearch value={f.q} onChange={(q) => f.set('q', q)} />
        <div className="filter-row">
          <RankSelect value={rank} challenge onChange={(v) => f.set('rank', v)} />
          <label className="filter-label">
            <span>Арагами</span>
            <select value={enemy} onChange={(e) => f.set('enemy', e.target.value)}>
              <option value="">Любой противник</option>
              {data.aragami.map((a) => (
                <option key={a.id} value={a.id}>
                  {name(a.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-label">
            <span>Награда</span>
            <select value={material} onChange={(e) => f.set('material', e.target.value)}>
              <option value="">Любой материал</option>
              {data.materials
                .filter((m) => data.drops.some((d) => d.material_id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {name(m.id)}
                  </option>
                ))}
            </select>
          </label>
          <label className="filter-label">
            <span>Тип</span>
            <select value={type} onChange={(e) => f.set('type', e.target.value)}>
              <option value="">Обычные, обучения и испытания</option>
              <option value="all">Все типы</option>
              {Object.entries(missionTypes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <ResetButton onClick={f.reset} />
        </div>
      </div>
      <div className="results-header">
        <span>
          Найдено <b>{rows.length}</b>
        </span>
        <span>По сложности</span>
      </div>
      {rows.length ? (
        <div className="panel table-scroll">
          <table className="mission-table">
            <thead>
              <tr>
                <th>Миссия</th>
                <th>Сложность</th>
                <th>Локация</th>
                <th>Арагами</th>
                <th>Награды</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice((page - 1) * 24, page * 24).map((m) => (
                <tr key={m.id}>
                  <td>
                    <EntityLink id={m.id} kind="mission" />
                    <small className="table-subtext">
                      {missionTypes[m.type]}
                      {m.phase_count ? ` · ${m.phase_count} этапа` : ''}
                      {m.story ? ' · сюжетная' : ''}
                    </small>
                  </td>
                  <td>
                    <span className="rank-square">{m.rank === 'challenge' ? 'EX' : m.rank}</span>
                  </td>
                  <td>
                    <EntityName id={m.location_id} compact />
                  </td>
                  <td>
                    <div className="enemy-links">
                      {m.type === 'tutorial' && !m.aragami_ids.length && (
                        <span>Тренировочные цели</span>
                      )}
                      {[...new Set(phases.get(m.id)!.flatMap((p) => p.aragami_ids))].map((id) => (
                        <EntityLink key={id} id={id} kind="aragami" compact />
                      ))}
                    </div>
                  </td>
                  <td>
                    {m.reward_table_status === 'missing' ? (
                      <span className="muted">Не добавлены</span>
                    ) : (
                      <span className="amber-text">Частично</span>
                    )}
                  </td>
                  <td>
                    <FavoriteButton id={m.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          action={
            <button className="button secondary" onClick={f.reset}>
              Сбросить фильтры
            </button>
          }
        />
      )}
      <Pager page={page} setPage={f.setPage} total={rows.length} />
    </>
  );
}

export function AragamiCatalog() {
  const { data, error, retry } = useCollections('aragami', 'missions');
  const { name } = useApp();
  const f = useFilters('aragami');
  if (!data) return <Loading error={error} retry={retry} />;
  const rank = f.params.get('rank') || '';
  const rows = data.aragami
    .filter(
      (a) =>
        f.ids.has(a.id) &&
        (!rank ||
          data.missions.some((m) => matchesMissionRank(m, rank) && m.aragami_ids.includes(a.id))),
    )
    .sort((a, b) => name(a.id).localeCompare(name(b.id), 'ru'));
  const page = Math.min(f.page, Math.max(1, Math.ceil(rows.length / 24)));
  return (
    <>
      <PageTitle
        eyebrow="Архив / 04"
        title="Арагами"
        description="Обычные, падшие и элементальные разновидности хранятся отдельно."
      />
      <CoverageBar collection="aragami" />
      <div className="filter-panel">
        <FilterSearch value={f.q} onChange={(q) => f.set('q', q)} />
        <div className="filter-row">
          <RankSelect value={rank} challenge onChange={(v) => f.set('rank', v)} />
          <ResetButton onClick={f.reset} />
        </div>
      </div>
      <div className="results-header">
        <span>
          Найдено <b>{rows.length}</b>
        </span>
      </div>
      {rows.length ? (
        <div className="equipment-grid aragami-grid">
          {rows.slice((page - 1) * 24, page * 24).map((a) => (
            <article className="equipment-card" key={a.id}>
              <div className="aragami-card-image">
                <AragamiArtwork id={a.id} compact />
                <FavoriteButton id={a.id} />
              </div>
              <Link className="equipment-title" to={`/aragami/${a.id}`}>
                <EntityName id={a.id} />
              </Link>
              <p>
                {
                  new Set(
                    data.missions
                      .filter((m) => m.aragami_ids.includes(a.id))
                      .map((m) => m.parent_mission_id || m.id),
                  ).size
                }{' '}
                связанных миссий
              </p>
              <div className="equipment-card-bottom">
                <StatusBadge status={a.verification_status} />
                <Link to={`/aragami/${a.id}`} aria-label={`Открыть ${name(a.id)}`}>
                  <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty />
      )}
      <Pager page={page} setPage={f.setPage} total={rows.length} />
    </>
  );
}
