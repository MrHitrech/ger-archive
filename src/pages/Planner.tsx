import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCheck,
  CircleHelp,
  ListPlus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useApp } from '../context';
import { useCollections } from '../lib/data';
import { planCraft } from '../lib/planner';
import {
  Empty,
  EntityLink,
  Loading,
  methods,
  number,
  PageTitle,
  SectionHeading,
} from '../components';
import type { CraftTarget, Recipe } from '../types';

function ancestors(recipe: Recipe, recipes: Recipe[], seen = new Set<string>()): string[] {
  if (!recipe.from_item_id || seen.has(recipe.from_item_id)) return [];
  const next = new Set([...seen, recipe.from_item_id]);
  return [
    ...new Set([
      recipe.from_item_id,
      ...recipes
        .filter((r) => r.item_id === recipe.from_item_id)
        .flatMap((r) => ancestors(r, recipes, next)),
    ]),
  ];
}

export default function Planner() {
  const { data, error, retry } = useCollections(
    'items',
    'recipes',
    'materials',
    'missions',
    'drops',
  );
  const { progress, update, addTarget, name } = useApp();
  const plan = useMemo(
    () => (data ? planCraft(progress.targets, data.recipes, progress.inventory) : null),
    [data, progress.targets, progress.inventory],
  );
  if (!data || !plan) return <Loading error={error} retry={retry} />;
  const { recipes, items, missions, drops } = data;
  const patch = (id: string, fields: Partial<CraftTarget>) =>
    update((s) => ({
      ...s,
      targets: s.targets.map((t) => (t.id === id ? { ...t, ...fields } : t)),
    }));
  const active = progress.targets.filter((t) => !t.completed);
  const needed = plan.materials.filter((m) => m.remaining > 0);
  const missingIds = new Set(needed.map((m) => m.material_id));
  const farmMissions = missions
    .filter((m) => drops.some((d) => d.mission_id === m.id && missingIds.has(d.material_id)))
    .sort(
      (a, b) => (a.rank === 'challenge' ? 15 : a.rank) - (b.rank === 'challenge' ? 15 : b.rank),
    );
  const noSources = needed.filter((m) => !drops.some((d) => d.material_id === m.material_id));
  return (
    <>
      <PageTitle
        eyebrow="Ваш арсенал / Планирование"
        title="План крафта"
        description="Добавьте цели, укажите запасы и получите общий список недостающих материалов."
        action={
          <Link className="button secondary" to="/craft">
            <ListPlus size={16} />
            Выбрать снаряжение
          </Link>
        }
      />
      <div className="planner-topbar">
        <label className="filter-label">
          <span>Добавить рецепт в план</span>
          <select
            value=""
            onChange={(e) => {
              const r = recipes.find((r) => r.id === e.target.value);
              if (r) addTarget(r);
            }}
          >
            <option value="">Выберите предмет…</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {name(r.item_id)} · {r.operation === 'craft' ? 'создание' : 'улучшение'} ·{' '}
                {r.required_rank ?? 'ранг не установлен'}
              </option>
            ))}
          </select>
        </label>
        <span className="local-save">
          <CheckCheck size={15} />
          Сохраняется в этом браузере
        </span>
      </div>
      {progress.targets.length ? (
        <>
          <section>
            <SectionHeading title="Цели крафта" count={active.length}>
              <button
                className="text-link danger"
                onClick={() => update((s) => ({ ...s, targets: [] }))}
              >
                <Trash2 size={14} />
                Очистить цели
              </button>
            </SectionHeading>
            <div className="target-list">
              {progress.targets.map((target) => {
                const recipe = recipes.find((r) => r.id === target.recipe_id);
                if (!recipe)
                  return (
                    <div className="target-card" key={target.id}>
                      <p>Рецепт больше не существует в базе.</p>
                      <button
                        className="button secondary"
                        onClick={() =>
                          update((s) => ({
                            ...s,
                            targets: s.targets.filter((t) => t.id !== target.id),
                          }))
                        }
                      >
                        Удалить цель
                      </button>
                    </div>
                  );
                const parents = ancestors(recipe, recipes);
                const ambiguous = parents
                  .map((id) => ({ id, recipes: recipes.filter((r) => r.item_id === id) }))
                  .filter((p) => p.recipes.length > 1 && p.id !== target.from_item_id);
                const groupOptions = [
                  ...new Map(
                    progress.targets
                      .filter(
                        (t) =>
                          t.id !== target.id &&
                          !t.completed &&
                          t.mode === 'chain' &&
                          t.quantity === 1,
                      )
                      .map((t) => [t.shared_instance || t.id, t]),
                  ).values(),
                ];
                return (
                  <article
                    className={`target-card ${target.completed ? 'completed' : ''}`}
                    key={target.id}
                  >
                    <div className="target-heading">
                      <label className="completion-check">
                        <input
                          type="checkbox"
                          checked={target.completed}
                          onChange={(e) => patch(target.id, { completed: e.target.checked })}
                          aria-label={`Цель выполнена: ${name(recipe.item_id)}`}
                        />
                        <Check size={16} />
                      </label>
                      <EntityLink id={recipe.item_id} kind="item" />
                      <span className="rank-label">
                        Ранг {recipe.required_rank ?? 'не установлен'}
                      </span>
                      <button
                        className="icon-button danger"
                        aria-label={`Удалить цель ${name(recipe.item_id)}`}
                        onClick={() =>
                          update((s) => ({
                            ...s,
                            targets: s.targets
                              .filter((t) => t.id !== target.id)
                              .map((t) =>
                                t.shared_instance === target.id
                                  ? { ...t, shared_instance: null }
                                  : t,
                              ),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {!target.completed && (
                      <>
                        <div className="target-options">
                          <label className="filter-label">
                            <span>Расчёт</span>
                            <select
                              value={target.mode}
                              onChange={(e) =>
                                patch(target.id, {
                                  mode: e.target.value as 'step' | 'chain',
                                  shared_instance: null,
                                  from_item_id: null,
                                })
                              }
                            >
                              <option value="step">Только эта операция</option>
                              <option value="chain">Цепочка с нуля / имеющегося предмета</option>
                            </select>
                          </label>
                          <label className="filter-label target-quantity">
                            <span>Количество</span>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={target.quantity}
                              onChange={(e) =>
                                patch(target.id, {
                                  quantity: Math.min(
                                    99,
                                    Math.max(1, Math.floor(Number(e.target.value) || 1)),
                                  ),
                                  shared_instance: null,
                                })
                              }
                              aria-label={`Количество: ${name(recipe.item_id)}`}
                            />
                          </label>
                          {target.mode === 'chain' && (
                            <>
                              <label className="filter-label">
                                <span>Предыдущий предмет уже есть</span>
                                <select
                                  value={target.from_item_id || ''}
                                  onChange={(e) =>
                                    patch(target.id, { from_item_id: e.target.value || null })
                                  }
                                >
                                  <option value="">Нет, создать с нуля</option>
                                  {parents.map((id) => (
                                    <option key={id} value={id}>
                                      {name(id)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {target.quantity === 1 && (
                                <label className="filter-label">
                                  <span>Экземпляр предмета</span>
                                  <select
                                    value={target.shared_instance || ''}
                                    onChange={(e) =>
                                      patch(target.id, { shared_instance: e.target.value || null })
                                    }
                                  >
                                    <option value="">Отдельный экземпляр</option>
                                    {groupOptions.map((t) => (
                                      <option key={t.id} value={t.shared_instance || t.id}>
                                        Одна цепочка с:{' '}
                                        {name(
                                          recipes.find((r) => r.id === t.recipe_id)?.item_id || '',
                                        )}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </>
                          )}
                          {target.mode === 'chain' &&
                            ambiguous.map((parent) => (
                              <label className="filter-label" key={parent.id}>
                                <span>Рецепт для: {name(parent.id)}</span>
                                <select
                                  value={target.choices[parent.id] || ''}
                                  onChange={(e) =>
                                    patch(target.id, {
                                      choices: { ...target.choices, [parent.id]: e.target.value },
                                    })
                                  }
                                >
                                  <option value="">Выберите рецепт…</option>
                                  {parent.recipes.map((r, i) => (
                                    <option value={r.id} key={r.id}>
                                      {i + 1}.{' '}
                                      {r.operation === 'craft'
                                        ? 'Создание'
                                        : `Из ${name(r.from_item_id || '')}`}{' '}
                                      · {r.cost_fc ?? '?'} FC
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ))}
                        </div>
                        {target.mode === 'step' && recipe.from_item_id && (
                          <p className="target-precondition">
                            Для этой операции нужен готовый{' '}
                            <EntityLink id={recipe.from_item_id} kind="item" compact />. Его
                            материалы не включены в расчёт.
                          </p>
                        )}
                        {target.shared_instance && (
                          <p className="target-precondition">
                            Общий экземпляр: совпадающие предшествующие операции учитываются один
                            раз.
                          </p>
                        )}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="footnote">
              Отмеченные цели исключаются из расчёта. Запасы не расходуются автоматически. Разные
              цели по умолчанию используют отдельные экземпляры.
            </p>
          </section>
          {plan.errors.length ? (
            <div className="plan-errors" role="alert">
              <TriangleAlert size={21} />
              <div>
                <h3>Уточните цели перед расчётом</h3>
                {plan.errors.map((e, i) => (
                  <p key={i}>{e.replace(/^[^:]+: /, '')}</p>
                ))}
              </div>
            </div>
          ) : (
            <>
              <section className="panel">
                <SectionHeading title="Общий список материалов" count={plan.materials.length} />
                <div className="plan-summary">
                  <span>
                    <b>{active.length}</b> активных целей
                  </span>
                  <span>
                    <b>{plan.operations}</b> операций
                  </span>
                  <span>
                    <b>{number(plan.cost_fc)} FC</b>
                    {plan.unknown_costs
                      ? ` + неизвестная стоимость (${plan.unknown_costs})`
                      : ' суммарная стоимость'}
                  </span>
                  <span>
                    <b>{needed.length}</b> материалов осталось добыть
                  </span>
                </div>
                {plan.materials.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Материал</th>
                          <th>Нужно</th>
                          <th>Уже есть</th>
                          <th>Осталось</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {[...plan.materials]
                          .sort(
                            (a, b) =>
                              Number(a.remaining === 0) - Number(b.remaining === 0) ||
                              name(a.material_id).localeCompare(name(b.material_id), 'ru'),
                          )
                          .map((m) => (
                            <tr key={m.material_id}>
                              <td>
                                <EntityLink id={m.material_id} kind="material" />
                              </td>
                              <td className="tabular">{m.required}</td>
                              <td>
                                <input
                                  className="quantity-input"
                                  aria-label={`Запас: ${name(m.material_id)}`}
                                  type="number"
                                  min={0}
                                  max={999999}
                                  value={progress.inventory[m.material_id] || 0}
                                  onChange={(e) => {
                                    const value = Math.max(
                                      0,
                                      Math.min(999999, Math.floor(Number(e.target.value) || 0)),
                                    );
                                    update((s) => ({
                                      ...s,
                                      inventory: { ...s.inventory, [m.material_id]: value },
                                    }));
                                  }}
                                />
                              </td>
                              <td>
                                <span
                                  className={`remaining ${m.remaining === 0 ? 'complete' : ''}`}
                                >
                                  {m.remaining || <Check size={16} />}
                                </span>
                              </td>
                              <td>
                                <Link className="text-link" to={`/materials/${m.material_id}`}>
                                  Способы получения <ArrowRight size={13} />
                                </Link>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="inline-empty">
                    <p>Все цели отмечены как выполненные.</p>
                  </div>
                )}
              </section>
              {needed.length > 0 && (
                <section className="panel">
                  <SectionHeading
                    title="Миссии для недостающих материалов"
                    count={farmMissions.length}
                  />
                  <div className="data-note compact-note">
                    <CircleHelp size={16} />
                    Это список известных источников. Данных для достоверного выбора самого быстрого
                    фарма недостаточно.
                  </div>
                  {farmMissions.length > 0 && (
                    <div className="farm-missions">
                      {farmMissions.map((m) => (
                        <article className="farm-mission" key={m.id}>
                          <div>
                            <span className="rank-square">
                              {m.rank === 'challenge' ? 'EX' : m.rank}
                            </span>
                            <EntityLink id={m.id} kind="mission" />
                          </div>
                          <ul>
                            {drops
                              .filter((d) => d.mission_id === m.id && missingIds.has(d.material_id))
                              .map((d) => (
                                <li key={d.id}>
                                  <EntityLink id={d.material_id} kind="material" compact />
                                  <span>
                                    {d.drop_rate === null ? 'Шанс неизвестен' : `${d.drop_rate}%`}
                                  </span>
                                  <small>
                                    {methods[d.method]} · {d.condition_ru}
                                  </small>
                                </li>
                              ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  )}
                  {noSources.length > 0 && (
                    <div className="missing-sources">
                      <h3>Способы получения ещё не добавлены</h3>
                      <div>
                        {noSources.map((m) => (
                          <EntityLink
                            key={m.material_id}
                            id={m.material_id}
                            kind="material"
                            compact
                          />
                        ))}
                      </div>
                      <p>
                        Эти материалы остаются в плане. Миссии и вероятности для них не
                        подставляются автоматически.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {active.length > 0 && needed.length === 0 && (
                <div className="success-note">
                  <CheckCheck size={20} />
                  Все материалы для активных целей уже есть.
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <Empty
          title="Ваш план пока пуст"
          text="Добавьте рецепт здесь или на странице снаряжения. Запасы и цели сохраняются в браузере."
          action={
            <Link className="button" to="/craft">
              Выбрать предмет <ArrowRight size={15} />
            </Link>
          }
        />
      )}
      <p className="footnote">
        Инвентарь учитывается один раз после суммирования всех целей: осталось = max(0, нужно − уже
        есть).
      </p>
      <div className="sr-only">{items.length} предметов доступно</div>
    </>
  );
}
