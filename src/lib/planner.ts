import type { Recipe, CraftTarget } from '../types.ts';

export interface PlannedMaterial {
  material_id: string;
  required: number;
  owned: number;
  remaining: number;
}
export interface PlanResult {
  materials: PlannedMaterial[];
  cost_fc: number;
  unknown_costs: number;
  errors: string[];
  operations: number;
}

export function planCraft(
  targets: CraftTarget[],
  recipes: Recipe[],
  inventory: Record<string, number>,
): PlanResult {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const byItem = new Map<string, Recipe[]>();
  for (const recipe of recipes)
    byItem.set(recipe.item_id, [...(byItem.get(recipe.item_id) || []), recipe]);
  const totals = new Map<string, number>();
  const operations = new Map<string, { recipe: Recipe; quantity: number }>();
  const instances = new Map<
    string,
    { final: string; path: string[]; start: string | null; choices: Map<string, string> }[]
  >();
  const errors: string[] = [];
  for (const target of targets.filter((t) => !t.completed)) {
    try {
      const recipe = byId.get(target.recipe_id);
      if (!recipe) throw new Error('Рецепт цели больше не существует в базе.');
      if (!Number.isSafeInteger(target.quantity) || target.quantity < 1 || target.quantity > 99)
        throw new Error('Количество целей должно быть целым числом от 1 до 99.');
      const instance = target.shared_instance || target.id;
      const shared =
        targets.filter((t) => !t.completed && (t.shared_instance || t.id) === instance).length > 1;
      if (shared && (target.quantity !== 1 || target.mode !== 'chain'))
        throw new Error(
          'Для общего экземпляра выберите полную цепочку и количество 1 у каждой цели.',
        );
      const path: string[] = [];
      const steps: Recipe[] = [];
      const seen = new Set<string>();
      const choices = new Map<string, string>();
      function expand(current: Recipe) {
        if (seen.has(current.item_id)) throw new Error('Обнаружен цикл в дереве улучшений.');
        seen.add(current.item_id);
        path.push(current.item_id);
        choices.set(current.item_id, current.id);
        steps.push(current);
        if (target.mode === 'step' || !current.from_item_id) return;
        if (current.from_item_id === target.from_item_id) {
          path.push(current.from_item_id);
          return;
        }
        const alternatives = byItem.get(current.from_item_id) || [];
        const chosenId = target.choices[current.from_item_id];
        const parent = chosenId
          ? alternatives.find((r) => r.id === chosenId)
          : alternatives.length === 1
            ? alternatives[0]
            : null;
        if (!parent)
          throw new Error(
            alternatives.length > 1
              ? 'Выберите рецепт для предыдущего улучшения.'
              : 'Не хватает рецепта предыдущего улучшения.',
          );
        expand(parent);
      }
      expand(recipe);
      if (target.mode === 'chain' && target.from_item_id && !path.includes(target.from_item_id))
        throw new Error('Имеющийся предмет не принадлежит выбранной ветке.');
      const others = instances.get(instance) || [];
      for (const other of others) {
        if (target.from_item_id !== other.start)
          throw new Error('У целей общего экземпляра должен совпадать исходный имеющийся предмет.');
        if (!path.includes(other.final) && !other.path.includes(recipe.item_id))
          throw new Error(
            'Один экземпляр нельзя одновременно улучшить по разным веткам. Выберите отдельные экземпляры.',
          );
        for (const [item, choice] of choices)
          if (other.choices.has(item) && other.choices.get(item) !== choice)
            throw new Error('Для общего экземпляра выбраны разные рецепты одного улучшения.');
      }
      instances.set(instance, [
        ...others,
        { final: recipe.item_id, path, start: target.from_item_id, choices },
      ]);
      for (const step of steps) {
        const key = `${instance}|${step.item_id}`;
        if (!operations.has(key)) operations.set(key, { recipe: step, quantity: target.quantity });
      }
    } catch (error) {
      errors.push(`${target.id}: ${(error as Error).message}`);
    }
  }
  let cost_fc = 0;
  let unknown_costs = 0;
  for (const { recipe, quantity } of operations.values()) {
    if (recipe.cost_fc === null) unknown_costs += quantity;
    else cost_fc += recipe.cost_fc * quantity;
    for (const ingredient of recipe.materials)
      totals.set(
        ingredient.material_id,
        (totals.get(ingredient.material_id) || 0) + ingredient.quantity * quantity,
      );
  }
  const materials = [...totals]
    .map(([material_id, required]) => {
      const input = inventory[material_id];
      const owned = Number.isSafeInteger(input) && input >= 0 ? input : 0;
      return { material_id, required, owned, remaining: Math.max(0, required - owned) };
    })
    .sort((a, b) => a.material_id.localeCompare(b.material_id));
  return { materials, cost_fc, unknown_costs, errors, operations: operations.size };
}
