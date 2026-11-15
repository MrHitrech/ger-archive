import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../scripts/lib/files.mjs';
import { planCraft } from '../src/lib/planner.ts';

const data = await readDataset();
const item = (name) => data.items.find((i) => i.name_en === name);
const recipe = (name, operation = name === 'Knife P' ? 'craft' : 'upgrade') =>
  data.recipes.find((r) => r.item_id === item(name).id && r.operation === operation);
const material = (name) => data.materials.find((m) => m.name_en === name);
const goal = (name, id = 'target-1', extra = {}) => ({
  id,
  recipe_id: recipe(name).id,
  quantity: 1,
  mode: 'chain',
  from_item_id: null,
  shared_instance: null,
  choices: {},
  completed: false,
  ...extra,
});
const row = (plan, name) => plan.materials.find((m) => m.material_id === material(name).id);

test('one upgrade operation never silently includes crafting a predecessor', () => {
  const plan = planCraft([goal('Knife', 'one', { mode: 'step' })], data.recipes, {});
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.cost_fc, 280);
  assert.equal(row(plan, 'Pixie Thorn').required, 2);
  assert.equal(row(plan, 'Brittle Titanium').required, 1);
});
test('complete chain includes craft and upgrade as distinct operations', () => {
  const plan = planCraft([goal('Knife')], data.recipes, {});
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.cost_fc, 630);
  assert.equal(row(plan, 'Pixie Thorn').required, 3);
  assert.equal(row(plan, 'Brittle Titanium').required, 2);
  assert.equal(plan.operations, 2);
});
test('direct forging and upgrading the same item remain distinct selectable operations', () => {
  const craft = planCraft(
    [goal('Knife II', 'forge', { recipe_id: recipe('Knife II', 'craft').id })],
    data.recipes,
    {},
  );
  const upgrade = planCraft([goal('Knife II', 'upgrade')], data.recipes, {});
  assert.deepEqual(craft.errors, []);
  assert.deepEqual(upgrade.errors, []);
  assert.equal(craft.operations, 1);
  assert.equal(craft.cost_fc, 3500);
  assert.equal(upgrade.operations, 3);
  assert.equal(upgrade.cost_fc, 3430);
});
test('independent physical items include their own predecessors', () => {
  const plan = planCraft([goal('Knife', 'a'), goal('Knife II', 'b')], data.recipes, {});
  assert.deepEqual(plan.errors, []);
  assert.equal(row(plan, 'Pixie Thorn').required, 6);
  assert.equal(row(plan, 'Brittle Titanium').required, 4);
});
test('explicitly shared linear chain counts a predecessor exactly once', () => {
  const plan = planCraft(
    [goal('Knife', 'a'), goal('Knife II', 'b', { shared_instance: 'a' })],
    data.recipes,
    {},
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(row(plan, 'Pixie Thorn').required, 3);
  assert.equal(row(plan, 'Brittle Titanium').required, 2);
  assert.equal(plan.cost_fc, 3430);
  assert.equal(plan.operations, 3);
});
test('one physical item cannot be used for incompatible final branches', () => {
  const plan = planCraft(
    [goal('Fiery Knife', 'a'), goal('Shock Knife', 'b', { shared_instance: 'a' })],
    data.recipes,
    {},
  );
  assert.ok(plan.errors.some((e) => e.includes('разным веткам')));
});
test('owned predecessor stops chain expansion, and wrong-branch starts fail', () => {
  const plan = planCraft(
    [goal('Knife II', 'a', { from_item_id: item('Knife').id })],
    data.recipes,
    {},
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.cost_fc, 2800);
  assert.equal(row(plan, 'Pixie Thorn'), undefined);
  const wrong = planCraft(
    [goal('Knife II', 'a', { from_item_id: item('Fiery Knife').id })],
    data.recipes,
    {},
  );
  assert.ok(wrong.errors.some((e) => e.includes('не принадлежит')));
});
test('inventory is deducted once after aggregation and never produces negative needs', () => {
  const pixieId = material('Pixie Thorn').id;
  const titaniumId = material('Brittle Titanium').id;
  const plan = planCraft([goal('Knife', 'a'), goal('Knife', 'b')], data.recipes, {
    [pixieId]: 2,
    [titaniumId]: 99,
  });
  assert.equal(row(plan, 'Pixie Thorn').remaining, 4);
  assert.equal(row(plan, 'Brittle Titanium').remaining, 0);
});
test('completed goals, quantities and unknown currency costs are handled separately', () => {
  const plan = planCraft(
    [goal('Knife', 'a', { completed: true }), goal('Knife', 'b', { quantity: 2 })],
    data.recipes,
    {},
  );
  assert.equal(plan.cost_fc, 1260);
  assert.equal(row(plan, 'Pixie Thorn').required, 6);
  const changed = structuredClone(data.recipes);
  changed.find((r) => r.id === recipe('Knife').id).cost_fc = null;
  const unknown = planCraft([goal('Knife')], changed, {});
  assert.equal(unknown.cost_fc, 350);
  assert.equal(unknown.unknown_costs, 1);
});
test('ambiguous predecessor recipes require an explicit choice', () => {
  const altered = [...data.recipes, { ...recipe('Knife'), id: 'alternative-recipe', cost_fc: 999 }];
  const unresolved = planCraft([goal('Knife II')], altered, {});
  assert.ok(unresolved.errors.some((e) => e.includes('Выберите рецепт')));
  const resolved = planCraft(
    [goal('Knife II', 'a', { choices: { [item('Knife').id]: recipe('Knife').id } })],
    altered,
    {},
  );
  assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.cost_fc, 3430);
});
test('cycles and shared multi-item quantities produce errors instead of recursion or undercounting', () => {
  const changed = structuredClone(data.recipes);
  changed.find((r) => r.id === recipe('Knife P').id).from_item_id = item('Knife').id;
  const cycle = planCraft([goal('Knife')], changed, {});
  assert.ok(cycle.errors.some((e) => e.includes('цикл')));
  const shared = planCraft(
    [goal('Knife', 'a', { quantity: 2 }), goal('Knife II', 'b', { shared_instance: 'a' })],
    data.recipes,
    {},
  );
  assert.ok(shared.errors.some((e) => e.includes('количество 1')));
});
