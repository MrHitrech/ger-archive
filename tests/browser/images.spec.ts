import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const images = JSON.parse(await readFile('data/game-images.json', 'utf8'));
const items = JSON.parse(await readFile('data/items.json', 'utf8'));
const aragami = JSON.parse(await readFile('data/aragami.json', 'utf8'));
const materials = JSON.parse(await readFile('data/materials.json', 'utf8'));

test('item icons and individual NORN illustrations load from the repository subdirectory', async ({
  page,
}) => {
  const knife = items.find((i: { name_en: string }) => i.name_en === 'Knife P');
  await page.goto(`./#/craft/${knife.id}`);
  const icon = page.locator('.detail-heading .record-icon img');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveJSProperty(
    'src',
    new URL(`/ger-archive/${images.assets[images.entities[knife.id].asset_id].file}`, page.url())
      .href,
  );
  await expect
    .poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText('Иконка категории из игры', { exact: true })).toBeVisible();
  const material = materials.find((m: { name_en: string }) => m.name_en === 'Brittle Titanium');
  await page.goto(`./#/materials/${material.id}`);
  await expect(page.locator('.detail-heading .record-icon img')).toBeVisible();
  const vajra = aragami.find((a: { name_en: string }) => a.name_en === 'Vajra');
  await page.goto(`./#/aragami/${vajra.id}`);
  const art = page.locator('figure.game-artwork > img');
  await expect(art).toBeVisible();
  await expect(art).toHaveJSProperty(
    'src',
    new URL(`/ger-archive/${images.assets[images.entities[vajra.id].asset_id].file}`, page.url())
      .href,
  );
  await expect
    .poll(() => art.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: 'artifacts/game-image-research/aragami-detail-desktop.png',
    fullPage: false,
  });
  await page.goto('./#/aragami');
  await expect(page.locator('.aragami-card-image img').first()).toBeVisible();
});
test('missing game illustrations and failed image requests retain a usable record', async ({
  page,
}) => {
  const missing = images.missing.find(
    (m: { reason: string }) => m.reason === 'no_norn_illustration',
  );
  await page.goto(`./#/aragami/${missing.id}`);
  await expect(
    page.getByText('Для этой формы иллюстрация NORN в игровых файлах не найдена.'),
  ).toBeVisible();
  await expect(page.locator('main h1')).toBeVisible();
  const knife = items.find((i: { name_en: string }) => i.name_en === 'Knife P'),
    asset = images.assets[images.entities[knife.id].asset_id];
  await page.route(`**/${asset.file}`, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`./#/craft/${knife.id}`);
  await expect(page.locator('.detail-heading .record-icon svg')).toBeVisible();
  await expect(page.locator('.recipe-table')).toBeVisible();
});
test('native illustrations and catalog cards fit a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const vajra = aragami.find((a: { name_en: string }) => a.name_en === 'Vajra');
  for (const route of ['#/aragami', `#/aragami/${vajra.id}`, '#/craft']) {
    await page.goto('./' + route);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
  await page.screenshot({
    path: 'artifacts/game-image-research/equipment-images-mobile.png',
    fullPage: true,
  });
});
