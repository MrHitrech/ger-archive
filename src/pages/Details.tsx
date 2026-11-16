import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleHelp, GitBranch, ListPlus, Minus, Plus, Target } from 'lucide-react';
import { useCollections } from '../lib/data';
import { equipmentStatLabels, formatEquipmentStat, hasCombatStats } from '../lib/equipment';
import { matchesMissionRank, missionPhases } from '../lib/missions';
import { useApp } from '../context';
import {
  categories,
  DetailHeader,
  AragamiArtwork,
  Empty,
  EntityLink,
  EntityName,
  Loading,
  methods,
  missionTypes,
  number,
  RankSelect,
  SectionHeading,
  SourceReferences,
  StatusBadge,
  elements,
} from '../components';
import type { Aragami, Drop, Item, Mission, Recipe } from '../types';

function MissingRecord() {
  return (
    <Empty
      title="Запись не найдена"
      text="Возможно, ссылка устарела или запись ещё не импортирована."
      action={
        <Link className="button secondary" to="/">
          Вернуться в архив
        </Link>
      }
    />
  );
}

export function DropTable({
  drops,
  missions,
  aragami,
  showMaterial = false,
}: {
  drops: Drop[];
  missions: Mission[];
  aragami: Aragami[];
  showMaterial?: boolean;
}) {
  const [sort, setSort] = useState('rank');
  const [rank, setRank] = useState('');
  const [method, setMethod] = useState('');
  const { name } = useApp();
  const rows = drops
    .filter(
      (d) =>
        matchesMissionRank(
          missions.find((m) => m.id === d.mission_id),
          rank,
        ) &&
        (!method || d.method === method),
    )
    .sort((a, b) => {
      const ma = missions.find((m) => m.id === a.mission_id);
      const mb = missions.find((m) => m.id === b.mission_id);
      if (sort === 'chance') return (b.drop_rate ?? -1) - (a.drop_rate ?? -1);
      if (sort === 'method')
        return (methods[a.method] || '').localeCompare(methods[b.method] || '', 'ru');
      if (sort === 'name')
        return name(a.mission_id || a.aragami_id || '').localeCompare(
          name(b.mission_id || b.aragami_id || ''),
          'ru',
        );
      return (
        (typeof ma?.rank === 'number' ? ma.rank : 99) -
        (typeof mb?.rank === 'number' ? mb.rank : 99)
      );
    });
  if (!drops.length)
    return (
      <div className="inline-empty">
        <CircleHelp size={20} />
        <p>
          Способы получения ещё не добавлены. Отсутствие записи не означает, что материал нельзя
          получить в игре.
        </p>
      </div>
    );
  return (
    <>
      <div className="drop-filters">
        <RankSelect value={rank} onChange={setRank} challenge />
        <label className="filter-label">
          <span>Способ</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Все способы</option>
            {Object.entries(methods).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-label">
          <span>Сортировать</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="rank">По сложности</option>
            <option value="chance">По вероятности ↓</option>
            <option value="method">По способу</option>
            <option value="name">По названию миссии</option>
          </select>
        </label>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="drop-table">
            <thead>
              <tr>
                {showMaterial && <th>Материал</th>}
                <th>Источник получения</th>
                <th>Способ и условие</th>
                <th>Шанс</th>
              </tr>
            </thead>
            {Object.entries(methods)
              .filter(([key]) => rows.some((d) => d.method === key))
              .map(([key, label]) => (
                <tbody key={key}>
                  <tr className="drop-group-title">
                    <th scope="rowgroup" colSpan={showMaterial ? 4 : 3}>
                      {label} · {rows.filter((d) => d.method === key).length}
                    </th>
                  </tr>
                  {rows
                    .filter((d) => d.method === key)
                    .map((d) => {
                      const mission = missions.find((m) => m.id === d.mission_id);
                      const enemy = aragami.find((a) => a.id === d.aragami_id);
                      return (
                        <tr key={d.id}>
                          {showMaterial && (
                            <td>
                              <EntityLink id={d.material_id} kind="material" />
                            </td>
                          )}
                          <td>
                            {mission ? (
                              <>
                                <EntityLink id={mission.id} kind="mission" />
                                <small className="table-subtext">
                                  Сложность{' '}
                                  {mission.rank === 'challenge' ? 'испытание' : mission.rank}
                                  {mission.type === 'urgent' ? ' · срочная' : ''}
                                </small>
                                <div className="inline-enemies">
                                  {enemy ? 'Арагами: ' : 'В миссии: '}
                                  {(enemy ? [enemy.id] : mission.aragami_ids).map((id, i) => (
                                    <span key={id}>
                                      {i > 0 && ', '}
                                      <EntityLink id={id} kind="aragami" compact />
                                    </span>
                                  ))}
                                </div>
                              </>
                            ) : enemy ? (
                              <EntityLink id={enemy.id} kind="aragami" />
                            ) : d.location_id ? (
                              <EntityName id={d.location_id} />
                            ) : (
                              <span>См. условие</span>
                            )}
                          </td>
                          <td>
                            <span className="method-label">{methods[d.method]}</span>
                            <p className="condition">{d.condition_ru}</p>
                            <small className="table-subtext">
                              Количество: {d.quantity ?? 'не установлено'}
                            </small>
                            {d.game_origin?.resource === 'mission_en' &&
                              d.game_origin.slot !== undefined && (
                                <small className="table-subtext">
                                  Позиция награды: {d.game_origin.slot + 1}
                                </small>
                              )}
                          </td>
                          <td>
                            <span className={d.drop_rate === null ? 'unknown-rate' : 'drop-rate'}>
                              {d.drop_rate === null ? 'Шанс неизвестен' : `${d.drop_rate}%`}
                            </span>
                            {d.drop_rate !== null && (
                              <small className="table-subtext">
                                {d.game_origin
                                  ? 'из файлов игры · для этой позиции'
                                  : 'по копии источника'}
                              </small>
                            )}
                            {d.pool_weight !== undefined && d.pool_total_weight !== undefined && (
                              <small className="table-subtext pool-share">
                                Вес: {d.pool_weight} / {d.pool_total_weight}
                                <br />
                                Доля веса:{' '}
                                {((100 * d.pool_weight) / d.pool_total_weight).toLocaleString(
                                  'ru-RU',
                                  { maximumFractionDigits: 2 },
                                )}
                                %
                              </small>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              ))}
          </table>
        </div>
      ) : (
        <Empty text="Для этих фильтров способы получения не найдены." />
      )}
      <p className="footnote">
        Вероятности разных строк не складываются. Без времени прохождения, количества наград и
        проверки условий нельзя определить самый быстрый фарм.
      </p>
      {drops.some((d) => d.pool_weight !== undefined) && (
        <p className="footnote">
          Для раскола защиты, пожирания и сбора показаны исходные веса и их доля в таблице. Точный
          шанс с учётом механики выбора и модификаторов ещё не подтверждён.
        </p>
      )}
    </>
  );
}

export function MaterialDetail() {
  const { id } = useParams();
  const { data, error, retry } = useCollections(
    'materials',
    'drops',
    'missions',
    'aragami',
    'recipes',
    'items',
  );
  if (!data) return <Loading error={error} retry={retry} />;
  const material = data.materials.find((m) => m.id === id);
  if (!material) return <MissingRecord />;
  const drops = data.drops.filter((d) => d.material_id === id);
  const uses = data.recipes.filter((r) => r.materials.some((m) => m.material_id === id));
  const refs = [...new Set([...material.references, ...drops.flatMap((d) => d.references)])];
  return (
    <>
      <DetailHeader record={material} kind="material" category={material.category} />
      <div className="fact-strip">
        <div>
          <span>Категория</span>
          <b>{categories[material.category]}</b>
        </div>
        <div>
          <span>Известные уровни получения</span>
          <b>{material.ranks.length ? material.ranks.join(', ') : 'Пока не установлены'}</b>
        </div>
        <div>
          <span>В рецептах</span>
          <b>{uses.length}</b>
        </div>
        <div>
          <span>Способов получения в базе</span>
          <b>{drops.length}</b>
        </div>
      </div>
      {material.description_ru && <p className="description">{material.description_ru}</p>}
      <section className="panel">
        <SectionHeading title="Где получить" count={drops.length} />
        <DropTable drops={drops} missions={data.missions} aragami={data.aragami} />
      </section>
      <section className="panel">
        <SectionHeading title="Для чего используется" count={uses.length} />
        {uses.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Предмет</th>
                  <th>Операция</th>
                  <th>Нужно</th>
                  <th>Стоимость</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {uses.map((r) => {
                  const item = data.items.find((i) => i.id === r.item_id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <EntityLink id={r.item_id} kind="item" />
                        <small className="table-subtext">
                          {item ? categories[item.category] : ''} · ранг{' '}
                          {r.required_rank ?? 'не установлен'}
                        </small>
                      </td>
                      <td>{r.operation === 'craft' ? 'Создание' : 'Улучшение'}</td>
                      <td className="tabular">
                        × {r.materials.find((m) => m.material_id === id)?.quantity}
                      </td>
                      <td className="tabular">
                        {r.cost_fc === null ? 'Не установлена' : `${number(r.cost_fc)} FC`}
                      </td>
                      <td>
                        <Link className="text-link" to={`/craft/${r.item_id}?recipe=${r.id}`}>
                          Рецепт <ArrowRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inline-empty">
            <p>Рецепты с этим материалом пока не добавлены.</p>
          </div>
        )}
      </section>
      <SourceReferences references={refs} translationId={material.id} />
    </>
  );
}

function UpgradeTree({ item, items, recipes }: { item: Item; items: Item[]; recipes: Recipe[] }) {
  const [zoom, setZoom] = useState(1);
  const family = items.filter((i) => i.family === item.family && i.category === item.category);
  const ids = new Set(family.map((i) => i.id));
  const edges = recipes.filter(
    (r) => r.from_item_id && ids.has(r.item_id) && ids.has(r.from_item_id),
  );
  const roots = family.filter((i) => !edges.some((e) => e.item_id === i.id));
  const { name } = useApp();
  function node(current: Item, path: Set<string>) {
    if (path.has(current.id)) return <li key={current.id}>Цикл в данных</li>;
    const seen = new Set([...path, current.id]);
    const children = edges.filter((r) => r.from_item_id === current.id);
    const recipe = recipes.find((r) => r.item_id === current.id);
    return (
      <li key={current.id}>
        <Link
          className={`tree-node ${current.id === item.id ? 'current' : ''}`}
          to={`/craft/${current.id}`}
        >
          <span className="tree-node-rank">Ранг {current.rank ?? 'не установлен'}</span>
          <b>{name(current.id)}</b>
          <small>
            {recipe?.cost_fc == null ? 'Стоимость неизвестна' : `${number(recipe.cost_fc)} FC`}
          </small>
        </Link>
        {children.length > 0 && (
          <ul>
            {children.map((r) => {
              const child = family.find((i) => i.id === r.item_id);
              return child ? node(child, seen) : null;
            })}
          </ul>
        )}
      </li>
    );
  }
  return (
    <section className="panel">
      <SectionHeading title="Дерево улучшений">
        <div className="tree-controls">
          <button
            className="icon-button"
            aria-label="Уменьшить дерево"
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            disabled={zoom <= 0.6}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Увеличить дерево"
            onClick={() => setZoom((z) => Math.min(1.3, z + 0.1))}
            disabled={zoom >= 1.3}
          >
            <Plus size={14} />
          </button>
        </div>
      </SectionHeading>
      {edges.length ? (
        <>
          <p className="tree-help">
            <GitBranch size={14} />
            Нажмите на узел, чтобы открыть рецепт и материалы. Область прокручивается.
          </p>
          <div
            className="tree-scroll"
            tabIndex={0}
            aria-label="Дерево улучшений с горизонтальной прокруткой"
          >
            <ul className="upgrade-tree" style={{ zoom }}>
              {roots.map((i) => node(i, new Set()))}
            </ul>
          </div>
        </>
      ) : (
        <div className="inline-empty">
          <p>В загруженном наборе нет связанных улучшений этого предмета.</p>
        </div>
      )}
    </section>
  );
}

export function ItemDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, error, retry } = useCollections(
    'items',
    'recipes',
    'materials',
    'drops',
    'missions',
  );
  const { progress, update, addTarget, name } = useApp();
  if (!data) return <Loading error={error} retry={retry} />;
  const item = data.items.find((i) => i.id === id);
  if (!item) return <MissingRecord />;
  const alternatives = data.recipes.filter((r) => r.item_id === id);
  const selected = params.get('recipe') || (alternatives.length === 1 ? alternatives[0].id : '');
  const recipe = alternatives.find((r) => r.id === selected);
  const refs = [...new Set([...item.references, ...alternatives.flatMap((r) => r.references)])];
  return (
    <>
      <DetailHeader record={item} kind="item" category={item.category} />
      <div className="fact-strip">
        <div>
          <span>Ранг</span>
          <b>{item.rank ?? 'Не установлен'}</b>
        </div>
        {Object.entries(item.stats).map(([key, value]) => (
          <div key={key}>
            <span>{equipmentStatLabels[key] || key}</span>
            <b>{formatEquipmentStat(item, value)}</b>
          </div>
        ))}
        <div>
          <span>
            {item.category.includes('shield') || item.category === 'buckler'
              ? 'Сопротивления в источнике'
              : 'Элемент'}
          </span>
          <b>
            {item.elements.length
              ? item.elements.map((e) => elements[e]).join(' · ')
              : item.missing_fields.includes('elements')
                ? 'Не установлен'
                : 'Без указанного элемента'}
          </b>
        </div>
      </div>
      {item.missing_fields.includes('stats') && (
        <p className="footnote">Характеристики этого предмета ещё не расшифрованы.</p>
      )}
      {!item.missing_fields.includes('stats') && (
        <p className="footnote">
          {hasCombatStats(item)
            ? 'Базовые значения без бонусов навыков и улучшений «+».'
            : 'У одежды и модулей нет базовой атаки или защиты. Их свойства определяются отдельно.'}
        </p>
      )}
      {!!item.skills_en?.length && (
        <div className="skills-line">
          <span>Навыки по источнику</span>
          {item.skills_en.map((skill) => (
            <span className="skill-chip" key={skill}>
              {skill}
            </span>
          ))}
          <small>Перевод навыков ещё не проверен</small>
        </div>
      )}
      <section className="panel">
        <SectionHeading title="Рецепт и материалы" count={alternatives.length}>
          {recipe && (
            <button className="button" onClick={() => addTarget(recipe)}>
              <ListPlus size={16} />В план крафта
            </button>
          )}
        </SectionHeading>
        {alternatives.length > 1 && (
          <label className="filter-label recipe-choice">
            <span>Альтернативный рецепт</span>
            <select value={selected} onChange={(e) => setParams({ recipe: e.target.value })}>
              <option value="">Выберите рецепт</option>
              {alternatives.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i + 1}.{' '}
                  {r.operation === 'craft' ? 'Создание' : `Улучшение ${name(r.from_item_id || '')}`}{' '}
                  · {r.cost_fc ?? '?'} FC
                </option>
              ))}
            </select>
          </label>
        )}
        {recipe ? (
          <>
            <div className="recipe-summary">
              <span className="operation-label">
                {recipe.operation === 'craft' ? 'Создание с нуля' : 'Улучшение предмета'}
              </span>
              {recipe.from_item_id && (
                <span>
                  Требуется <EntityLink id={recipe.from_item_id} kind="item" compact />
                </span>
              )}
              <strong>
                {recipe.cost_fc === null
                  ? 'Стоимость не установлена'
                  : `${number(recipe.cost_fc)} FC`}
              </strong>
            </div>
            {recipe.missing_fields.includes('unlock_conditions') && (
              <p className="footnote">
                Условия открытия рецепта ещё не расшифрованы. Ранг предмета не определяет момент его
                появления в магазине.
              </p>
            )}
            <div className="table-scroll">
              <table className="recipe-table">
                <thead>
                  <tr>
                    <th>Материал</th>
                    <th>Нужно</th>
                    <th>Уже есть</th>
                    <th>Осталось</th>
                    <th>Где получить</th>
                  </tr>
                </thead>
                <tbody>
                  {recipe.materials.map((m) => {
                    const owned = progress.inventory[m.material_id] || 0;
                    const remaining = Math.max(0, m.quantity - owned);
                    const sources = data.drops.filter((d) => d.material_id === m.material_id);
                    return (
                      <tr key={m.material_id}>
                        <td>
                          <EntityLink id={m.material_id} kind="material" />
                        </td>
                        <td className="tabular">{m.quantity}</td>
                        <td>
                          <input
                            className="quantity-input"
                            type="number"
                            min={0}
                            max={999999}
                            step={1}
                            aria-label={`Уже есть: ${name(m.material_id)}`}
                            value={owned}
                            onChange={(e) => {
                              const n = Math.min(
                                999999,
                                Math.max(0, Math.floor(Number(e.target.value) || 0)),
                              );
                              update((s) => ({
                                ...s,
                                inventory: { ...s.inventory, [m.material_id]: n },
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <span className={`remaining ${remaining === 0 ? 'complete' : ''}`}>
                            {remaining === 0 ? 'Готово' : remaining}
                          </span>
                        </td>
                        <td>
                          <Link className="text-link" to={`/materials/${m.material_id}`}>
                            {sources.length ? `${sources.length} способов` : 'Открыть материал'}
                            <ArrowRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="recipe-footer">
              <CircleHelp size={15} />
              <p>
                Расчёт для одной операции. Для всей ветки добавьте рецепт в план и выберите «Цепочка
                с нуля».
              </p>
              <Link to="/planner">
                План крафта <ArrowRight size={14} />
              </Link>
            </div>
          </>
        ) : (
          <div className="inline-empty">
            <p>
              {alternatives.length
                ? 'Выберите альтернативный рецепт для расчёта.'
                : 'Рецепт пока не добавлен.'}
            </p>
          </div>
        )}
      </section>
      <UpgradeTree key={item.family} item={item} items={data.items} recipes={data.recipes} />
      <SourceReferences references={refs} translationId={item.id} />
    </>
  );
}

export function MissionDetail() {
  const { id } = useParams();
  const { data, error, retry } = useCollections('missions', 'aragami', 'drops');
  if (!data) return <Loading error={error} retry={retry} />;
  const mission = data.missions.find((m) => m.id === id);
  if (!mission) return <MissingRecord />;
  const phases = missionPhases(mission, data.missions);
  const scope = mission.parent_mission_id ? [mission] : phases;
  const drops = data.drops.filter((d) => scope.some((m) => m.id === d.mission_id));
  const enemyIds = [...new Set(scope.flatMap((m) => m.aragami_ids))];
  const refs = [
    ...new Set([...scope.flatMap((m) => m.references), ...drops.flatMap((d) => d.references)]),
  ];
  return (
    <>
      <DetailHeader record={mission} kind="mission" />
      <div className="fact-strip">
        <div>
          <span>Сложность</span>
          <b>{mission.rank === 'challenge' ? 'Испытание' : mission.rank}</b>
        </div>
        <div>
          <span>Тип миссии</span>
          <b>
            {missionTypes[mission.type]}
            {mission.story ? ' · сюжетная' : ''}
          </b>
        </div>
        <div>
          <span>Локация</span>
          <b>
            <EntityName id={mission.location_id} compact />
          </b>
        </div>
        <div>
          <span>Лимит времени</span>
          <b>
            {mission.time_limit_seconds
              ? `${mission.time_limit_seconds / 60} мин.`
              : 'Не установлен'}
          </b>
        </div>
      </div>
      {mission.phase_count && (
        <section className="panel">
          <SectionHeading title="Этапы выживания" count={phases.length} />
          <p className="footnote">
            {mission.parent_mission_id
              ? `Открыт этап ${mission.phase_index} из ${mission.phase_count}. Ниже показаны награды этого этапа.`
              : 'Ниже собраны награды всех этапов. В каждой строке указана миссия соответствующего этапа.'}
          </p>
          <ol>
            {phases.map((phase) => (
              <li key={phase.id} aria-current={phase.id === mission.id ? 'step' : undefined}>
                Этап {phase.phase_index}: <EntityLink id={phase.id} kind="mission" /> ·{' '}
                <EntityName id={phase.location_id} compact />
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="panel">
        <SectionHeading
          title={mission.type === 'tutorial' ? 'Учебные цели' : 'Арагами в миссии'}
          count={enemyIds.length || undefined}
        />
        <div className="mission-enemy-grid">
          {enemyIds.map((id) => (
            <div key={id}>
              <Target size={20} />
              <EntityLink kind="aragami" id={id} />
            </div>
          ))}
        </div>
        <p className="footnote">
          {mission.type === 'tutorial'
            ? 'Обучение использует тренировочные мишени.'
            : !enemyIds.length
              ? 'В таблице задания не указано появление боевых противников.'
              : 'Список включает встречающихся противников. Основные цели и точные количества требуют сверки с условиями задания.'}
        </p>
        <details className="objective-source">
          <summary>Описание задания в источнике (English)</summary>
          <p>{mission.objectives_en}</p>
        </details>
      </section>
      <section className="panel">
        <SectionHeading title="Известные награды" count={drops.length} />
        {drops.length ? (
          <>
            <div className="data-note compact-note">
              <CircleHelp size={15} />
              Таблица заполнена частично; это не полный перечень наград миссии.
            </div>
            <DropTable drops={drops} missions={data.missions} aragami={data.aragami} showMaterial />
          </>
        ) : (
          <div className="inline-empty">
            <CircleHelp size={20} />
            <p>
              {mission.reward_table_status === 'missing'
                ? 'Таблица наград пока не импортирована. Это не означает, что в миссии нет наград.'
                : 'В известных данных нет наград материалами для этой миссии.'}
            </p>
          </div>
        )}
      </section>
      <SourceReferences references={refs} translationId={mission.id} />
    </>
  );
}

export function AragamiDetail() {
  const { id } = useParams();
  const { data, error, retry } = useCollections('aragami', 'missions', 'drops');
  if (!data) return <Loading error={error} retry={retry} />;
  const enemy = data.aragami.find((a) => a.id === id);
  if (!enemy) return <MissingRecord />;
  const missions = data.missions.filter((m) => m.aragami_ids.includes(enemy.id));
  const drops = data.drops.filter((d) => d.aragami_id === id);
  const ranks = [...new Set(missions.map((m) => m.rank))].sort(
    (a, b) => (a === 'challenge' ? 15 : a) - (b === 'challenge' ? 15 : b),
  );
  return (
    <>
      <DetailHeader record={enemy} kind="aragami" />
      <AragamiArtwork id={enemy.id} />
      <div className="fact-strip">
        <div>
          <span>Разновидность (оригинал)</span>
          <b>{enemy.variant}</b>
        </div>
        <div>
          <span>Известные сложности</span>
          <b>
            {ranks.map((r) => (r === 'challenge' ? 'Испытания' : r)).join(', ') || 'Не установлены'}
          </b>
        </div>
        <div>
          <span>Разрушаемые части</span>
          <b>
            {enemy.breakable_parts === null
              ? 'Пока не подтверждены'
              : enemy.breakable_parts.length
                ? enemy.breakable_parts.join(', ')
                : 'Нет'}
          </b>
        </div>
      </div>
      <section className="panel">
        <SectionHeading title="Добыча с арагами" count={drops.length} />
        <DropTable drops={drops} missions={data.missions} aragami={data.aragami} />
        <p className="footnote">
          Награды миссий не приравниваются к добыче с противника. Таблицы пожирания и разрушения
          частей проверяются отдельно для Resurrection.
        </p>
      </section>
      <section className="panel">
        <SectionHeading title="Где встречается" count={missions.length} />
        {missions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Миссия</th>
                  <th>Сложность</th>
                  <th>Локация</th>
                  <th>Тип</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <EntityLink kind="mission" id={m.id} />
                    </td>
                    <td>{m.rank === 'challenge' ? 'Испытание' : m.rank}</td>
                    <td>
                      <EntityName id={m.location_id} compact />
                    </td>
                    <td>{missionTypes[m.type]}</td>
                    <td>
                      <StatusBadge status={m.verification_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="Связанные миссии пока не добавлены." />
        )}
      </section>
      <SourceReferences references={enemy.references} translationId={enemy.id} />
    </>
  );
}
