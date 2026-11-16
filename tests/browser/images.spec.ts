import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const images = JSON.parse(await readFile('data/game-images.json', 'utf8'));
const items = JSON.parse(await readFile('data/items.json', 'utf8'));
const aragami = JSON.parse(await readFile('data/aragami.json', 'utf8'));
const materials = JSON.parse(await readFile('data/materials.json', 'utf8'));

test('individual equipment pictures load on detail pages, while catalogs retain native icons', async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const category of [
    'short_blade',
    'long_blade',
    'buster_blade',
    'boost_hammer',
    'charge_spear',
    'variant_scythe',
    'sniper',
    'assault',
    'blast',
    'shotgun',
    'buckler',
    'shield',
    'tower_shield',
  ]) {
    const item = items.find((i: { category: string }) => i.category === category);
    await page.goto(`./#/craft/${item.id}`);
    const portrait = page.locator('figure.equipment-artwork > img');
    await expect(portrait).toBeVisible();
    await expect(portrait).toHaveJSProperty(
      'src',
      new URL(`/ger-archive/${images.assets[images.portraits[item.id].asset_id].file}`, page.url())
        .href,
    );
    await expect
      .poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(768);
    await expect(page.locator('.detail-heading .record-icon')).toHaveCount(0);
  }
  await page.screenshot({
    path: 'artifacts/game-image-research/shield-detail-final.png',
    fullPage: false,
  });
  await page.goto('./#/craft');
  const icon = page.locator('.record-icon img').first();
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(128);
  await expect(page.getByRole('option', { name: 'Искры', exact: true })).toHaveCount(1);
});

test('material icons preserve native colors and all Aragami have the correct game image', async ({
  page,
}) => {
  for (const name of ['Pixie Thorn', 'Wyrm Armor', 'King Feeler', 'Hanuman Mask']) {
    const material = materials.find((m: { name_en: string }) => m.name_en === name),
      asset = images.assets[images.entities[material.id].asset_id];
    await page.goto(`./#/materials/${material.id}`);
    const icon = page.locator('.detail-heading .record-icon img');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveJSProperty(
      'src',
      new URL(`/ger-archive/${asset.file}`, page.url()).href,
    );
  }
  for (const family of [1, 145, 148]) {
    const [id, image] = Object.entries(images.entities).find(
      ([, i]) => (i as { family_id: number }).family_id === family,
    ) as [string, { asset_id: string }];
    await page.goto(`./#/aragami/${id}`);
    const art = page.locator('figure.game-artwork > img');
    await expect(art).toBeVisible();
    await expect
      .poll(() => art.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(art).toHaveJSProperty(
      'src',
      new URL(`/ger-archive/${images.assets[image.asset_id].file}`, page.url()).href,
    );
  }
  await page.screenshot({
    path: 'artifacts/game-image-research/balfa-mata-final.png',
    fullPage: false,
  });
  await page.goto('./#/aragami');
  let total = 0;
  for (const count of [24, 24, 5]) {
    await expect(page.locator('.aragami-card-image img')).toHaveCount(count);
    total += count;
    const next = page.getByRole('button', { name: 'Следующая страница', exact: true });
    if (count === 5) await expect(next).toBeDisabled();
    else await next.click();
  }
  expect(total).toBe(53);
});

test('a failed equipment picture keeps the recipe and statistics usable', async ({ page }) => {
  const knife = items.find((i: { name_en: string }) => i.name_en === 'Knife P'),
    asset = images.assets[images.portraits[knife.id].asset_id];
  await page.route(`**/${asset.file}`, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`./#/craft/${knife.id}`);
  await expect(
    page.getByText('Не удалось загрузить изображение. Рецепт и характеристики доступны ниже.'),
  ).toBeVisible();
  await expect(page.locator('.recipe-table')).toBeVisible();
  await expect(page.locator('.fact-strip')).toBeVisible();
});

test('native model pictures and catalogs fit a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const knife = items.find((i: { name_en: string }) => i.name_en === 'Knife P'),
    vajra = aragami.find((a: { name_en: string }) => a.name_en === 'Vajra');
  for (const route of ['#/aragami', `#/aragami/${vajra.id}`, '#/craft', `#/craft/${knife.id}`]) {
    await page.goto('./' + route);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
  await page.screenshot({
    path: 'artifacts/game-image-research/equipment-images-mobile-final.png',
    fullPage: false,
  });
});
