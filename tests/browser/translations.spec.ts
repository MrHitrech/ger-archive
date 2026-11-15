import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const items = JSON.parse(await readFile('data/items.json', 'utf8'));
const rigoletto = items.find((row: { name_en: string }) => row.name_en === 'Rigoletto II');

test('decoded Rigoletto is searchable in Russian and exposes its native translation', async ({
  page,
}) => {
  await page.goto(`./#/craft/${rigoletto.id}`);
  await expect(page.getByRole('heading', { name: 'Риголетто II', exact: true })).toBeVisible();
  await expect(page.locator('.english-title')).toHaveText('Rigoletto II');
  await expect(page.getByText('Название из установленной игры · требует проверки')).toBeVisible();
  const proof = page.locator('.source-reference').filter({ hasText: '/ru/article.kst' });
  await expect(proof).toHaveCount(1);
  await proof.locator('summary').click();
  await expect(proof.locator('pre')).toContainText('"row_id":10874');
  await expect(proof.locator('pre')).toContainText('"name_ru":"Риголетто II"');
  await page.getByRole('combobox', { name: 'Отображение названий' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Rigoletto II', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Отображение названий' }).selectOption('ru');
  await page.goto(`./#/craft?q=${encodeURIComponent('Риголетто II')}`);
  const result = page.locator(`.equipment-title[href$="${rigoletto.id}"]`);
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(page.getByRole('heading', { name: 'Риголетто II', exact: true })).toBeVisible();
});
