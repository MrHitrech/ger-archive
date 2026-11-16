import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const items = JSON.parse(await readFile(resolve('data/items.json'), 'utf8'));
const materials = JSON.parse(await readFile(resolve('data/materials.json'), 'utf8'));
const recipes = JSON.parse(await readFile(resolve('data/recipes.json'), 'utf8'));
const item = (name: string) => items.find((i: { name_en: string }) => i.name_en === name);
const material = (name: string) => materials.find((i: { name_en: string }) => i.name_en === name);
const recipe = (name: string, operation = name === 'Knife P' ? 'craft' : 'upgrade') =>
  recipes.find(
    (r: { item_id: string; operation: string }) =>
      r.item_id === item(name).id && r.operation === operation,
  );

test('production build loads from a repository subdirectory without external requests', async ({
  page,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1:4173/')) external.push(req.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Знай, что искать/ })).toBeVisible();
  await expect(page.getByText(String(materials.length), { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/home-desktop.png', fullPage: true });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('Russian, English and a typo open the same material', async ({ page }) => {
  await page.goto('./#/materials?q=Brittle+Titanium');
  const search = page.getByRole('textbox', { name: 'Поиск по названиям' });
  const link = page.locator('tbody').getByRole('link', { name: /Хрупкий титан/ });
  await expect(link).toHaveCount(1);
  await search.fill('ХРУПКИЙ ТИТАН');
  await expect(link).toHaveCount(1);
  await search.fill('хрупкии титан');
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(new RegExp(material('Brittle Titanium').id));
  await expect(page.getByRole('heading', { name: 'Хрупкий титан' })).toBeVisible();
});

test('weapon to material to mission to aragami is fully linked inside the site', async ({
  page,
}) => {
  await page.goto(`./#/craft/${item('Knife P').id}`);
  await expect(page.getByRole('heading', { name: 'Нож P', exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: /Хрупкий титан/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Хрупкий титан' })).toBeVisible();
  await page
    .locator('.drop-table')
    .getByRole('link', { name: /Хвост дьявола/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Хвост дьявола' })).toBeVisible();
  await page
    .locator('.mission-enemy-grid')
    .getByRole('link', { name: /Огрехвост/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Огрехвост', exact: true })).toBeVisible();
  await expect(page.getByText('Разрушаемые части')).toBeVisible();
});

test('inventory, favorites, display mode and craft goals persist across reloads', async ({
  page,
}) => {
  await page.goto(`./#/craft/${item('Knife P').id}`);
  await page.getByRole('spinbutton', { name: 'Уже есть: Шип пикси' }).fill('2');
  await page.getByRole('button', { name: 'В избранное: Нож P' }).click();
  await page.getByRole('button', { name: 'В план крафта', exact: true }).click();
  await page.getByRole('combobox', { name: 'Отображение названий' }).selectOption('en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Knife P', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Уже есть: Pixie Thorn' })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Убрать из избранного: Knife P' })).toBeVisible();
  await page.goto('./#/planner');
  await expect(page.locator('.target-card')).toHaveCount(1);
  await expect(page.locator('.remaining.complete')).toBeVisible();
});

test('shared physical chain and stock aggregate correctly in the browser', async ({ page }) => {
  await page.goto('./#/planner');
  const add = page.getByLabel('Добавить рецепт в план');
  await add.selectOption(recipe('Knife').id);
  await add.selectOption(recipe('Knife II').id);
  const first = page.locator('.target-card').nth(0);
  const second = page.locator('.target-card').nth(1);
  await first.getByRole('combobox', { name: 'Расчёт', exact: true }).selectOption('chain');
  await second.getByRole('combobox', { name: 'Расчёт', exact: true }).selectOption('chain');
  const rootId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('ger-archive:progress:v1')!).targets[0].id,
  );
  await second
    .getByRole('combobox', { name: 'Экземпляр предмета', exact: true })
    .selectOption(rootId);
  const row = page.locator('tr').filter({ has: page.getByRole('link', { name: /Шип пикси/ }) });
  await expect(row.getByRole('cell').nth(1)).toHaveText('3');
  await row.getByRole('spinbutton').fill('2');
  await expect(row.getByRole('cell').nth(3)).toHaveText('1');
  await page.reload();
  await expect(row.getByRole('cell').nth(3)).toHaveText('1');
});

test('unknown probability is not rendered as zero or a made-up percent', async ({ page }) => {
  await page.route('**/data/drops.json*', async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({
      response,
      json: rows.map((d: { drop_rate: number | null }) => ({ ...d, drop_rate: null })),
    });
  });
  await page.goto(`./#/materials/${material('Pixie Thorn').id}`);
  await expect(page.getByText('Шанс неизвестен', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.drop-rate')).toHaveCount(0);
  await page.getByRole('link', { name: 'О данных' }).click();
  await expect(
    page.getByRole('heading', { name: 'База ещё не готова к полной публикации' }),
  ).toBeVisible();
});

test('light filter includes recovered elements and displays the Russian name Свет', async ({
  page,
}) => {
  await page.goto('./#/craft?element=divine&q=Immunity+Buckler');
  await expect(page.getByRole('combobox', { name: 'Элемент', exact: true })).toHaveValue('divine');
  await expect(page.getByRole('option', { name: 'Свет', exact: true })).toHaveCount(1);
  const card = page.locator('.equipment-card').filter({
    has: page.locator(`a[href$="${item('Immunity Buckler').id}"]`),
  });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.element.divine')).toHaveText('Свет');
  await card
    .locator(`a[href$="${item('Immunity Buckler').id}"]`)
    .first()
    .click();
  await expect(page.getByText('Огонь · Лёд · Молния · Свет', { exact: true })).toBeVisible();
});

test('mission rewards show separate 25% positions and native provenance', async ({ page }) => {
  const missions = JSON.parse(await readFile(resolve('data/missions.json'), 'utf8'));
  const mayflies = missions.find((m: { name_en: string }) => m.name_en === 'Mayflies');
  await page.goto(`./#/missions/${mayflies.id}`);
  const rows = page
    .locator('.drop-table tbody tr')
    .filter({ has: page.getByRole('link', { name: /Шип пикси/ }) });
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.drop-rate')).toHaveText(['25%', '25%']);
  await expect(rows.first().getByText('из файлов игры · для этой позиции')).toBeVisible();
  await expect(rows.first().getByText(/Позиция награды:/)).toBeVisible();
});

test('mobile navigation and wide tables stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Знай, что искать/ })).toBeVisible();
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page
    .getByRole('link', { name: /^Материалы/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Материалы', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto(`./#/craft/${item('Knife').id}`);
  await expect(page.getByRole('heading', { name: 'Нож', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/craft-mobile.png', fullPage: true });
});

test('global search supports all categories and keyboard suggestions', async ({ page }) => {
  await page.goto('./');
  const global = page.locator('.topbar').getByRole('combobox', {
    name: 'Поиск по русскому или английскому названию',
  });
  await global.fill('Vajra');
  await global.press('Enter');
  await expect(page.getByRole('heading', { name: 'Поиск по всему архиву' })).toBeVisible();
  await expect(
    page.locator('main').getByRole('link', { name: 'Ваджра Vajra', exact: true }),
  ).toBeVisible();
  await global.fill('Brittle Titanium');
  await expect(page.locator('.topbar [role="listbox"]')).toBeVisible();
  await global.press('ArrowDown');
  await global.press('Enter');
  await expect(page.getByRole('heading', { name: 'Хрупкий титан' })).toBeVisible();
});

test('small phone width contains source tables and hides closed navigation from focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const hash of ['', '#/materials', '#/sources', `#/craft/${item('Knife P').id}`]) {
    await page.goto(`./${hash}`);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test('newly extracted equipment shows its recipe and native provenance and works in the planner', async ({
  page,
}) => {
  const blade = item('Blade P');
  await page.goto(`./#/craft/${blade.id}`);
  await page.getByRole('combobox', { name: 'Отображение названий' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Blade P', exact: true })).toBeVisible();
  await expect(page.getByText('Характеристики этого предмета ещё не расшифрованы.')).toBeVisible();
  await expect(page.getByText(/Условия открытия рецепта ещё не расшифрованы/)).toBeVisible();
  const proof = page
    .locator('.source-reference')
    .filter({ hasText: 'equipment_composition.tr2' })
    .first();
  await proof.locator('summary').click();
  await expect(proof.getByText(/SHA-256 ресурса/)).toBeVisible();
  await page.getByRole('button', { name: 'В план крафта', exact: true }).click();
  await page.goto('./#/planner');
  await expect(page.locator('.target-card')).toHaveCount(1);
  await expect(
    page.locator('.target-card').getByRole('link', { name: 'Blade P', exact: true }),
  ).toBeVisible();
});

test('old English spelling remains searchable after mapping to a native material ID', async ({
  page,
}) => {
  const canonical = material('Wukong Armor +');
  await page.goto(`./#/materials?q=${encodeURIComponent('Wukong Armor+')}`);
  const result = page.locator(`tbody a[href$="${canonical.id}"]`);
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(page).toHaveURL(new RegExp(canonical.id));
});
