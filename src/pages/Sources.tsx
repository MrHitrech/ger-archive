import { useState } from 'react';
import {
  CircleHelp,
  Download,
  ExternalLink,
  FileCheck,
  GitBranch,
  LockKeyhole,
  TriangleAlert,
} from 'lucide-react';
import { useApp } from '../context';
import { CoverageBar, number, PageTitle, SectionHeading } from '../components';
import { dataUrl } from '../lib/data';

const collectionLabels: Record<string, string> = {
  materials: 'Материалы',
  items: 'Снаряжение',
  recipes: 'Рецепты',
  missions: 'Миссии',
  aragami: 'Арагами',
  locations: 'Локации',
  drops: 'Способы получения',
};
const issueLabels: Record<string, string> = {
  CROSS_GAME_REJECTED: 'Другая игра',
  AMBIGUOUS_INGREDIENT: 'Неясный ингредиент',
  DUPLICATE_LABEL: 'Одинаковые названия',
  AMBIGUOUS_REWARD_SLOTS: 'Неясная структура наград',
  PLACEHOLDER_REJECTED: 'Незаполненный шаблон',
  SOURCE_ACCESS: 'Доступ к оригиналу',
  AMBIGUOUS_ENEMY: 'Не сопоставлен противник',
  GAME_ROW_QUARANTINED: 'Проблемная строка игры',
  GAME_AVAILABILITY_REVIEW: 'Доступность в игре',
  GAME_PACKED_LAYOUT_REVIEW: 'Поля рецептов',
  GAME_TEXT_ENCODING: 'Кодировка перевода',
  GAME_LEGACY_MATERIAL_UNMATCHED: 'Не сопоставлен материал Wiki',
  GAME_MISSION_UNMATCHED: 'Не сопоставлена миссия',
  GAME_REWARD_SCOPE_REVIEW: 'Неполное покрытие способов получения',
  GAME_WEIGHT_MODEL_REVIEW: 'Веса и вероятность',
  GAME_ENEMY_UNMATCHED: 'Не сопоставлен вариант арагами',
  GAME_DEVOUR_POOL_MISMATCH: 'Различие таблиц пожирания',
  GAME_SECONDARY_POOL_REVIEW: 'Дополнительные пулы материалов',
};
export default function Sources() {
  const { report, sources, images } = useApp();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="Открытые данные / Контроль качества"
        title="Источники и проверка"
        description="Откуда взялись данные, что проверено и какие пробелы ещё предстоит заполнить."
        action={
          <a
            className="button secondary"
            href={dataUrl('report.json')}
            download="ger-data-quality.json"
          >
            <Download size={15} />
            Отчёт в JSON
          </a>
        }
      />
      <div className="source-alert">
        <TriangleAlert size={24} />
        <div>
          <h2>База ещё не готова к полной публикации</h2>
          <p>{report.notice_ru}</p>
          <p>
            Последняя подготовка данных: <b>{report.checked_at}</b>. Сборка игры указана у игрового
            источника, а ревизии Wiki отмечены отдельно.
          </p>
        </div>
      </div>
      <section className="panel">
        <SectionHeading title="Изображения из игры" />
        <p>
          Игровые иконки для {images.coverage?.items ?? 0} предметов снаряжения и{' '}
          {images.coverage?.materials ?? 0} материалов. Изображения моделей для{' '}
          {images.coverage?.equipment_portraits ?? 0} оружий и щитов. Изображения всех{' '}
          {images.coverage?.aragami ?? 0} арагами. Сборка: {images.build_id ?? 'не загружена'}.
        </p>
        <p className="footnote">
          Форма и цвет иконок прочитаны из записи каждого предмета. Оружие, щиты и две формы арагами
          показаны по игровым моделям и текстурам; остальные арагами — по иллюстрациям NORN. Без
          подтверждённого игрового изображения остаётся записей: {images.missing.length}. Игровые
          изображения принадлежат правообладателям.
        </p>
        <a
          className="text-link"
          href={dataUrl('image-provenance.json')}
          download="ger-image-provenance.json"
        >
          Скачать привязки и происхождение изображений
        </a>
      </section>
      <section className="panel">
        <SectionHeading title="Наполнение базы" />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Раздел</th>
                <th>Записей</th>
                <th>Проверено вручную</th>
                <th>С пробелами</th>
                <th>Не добавлено из игры</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(report.coverage).map(([key, c]) => (
                <tr key={key}>
                  <td>{collectionLabels[key]}</td>
                  <td className="tabular">{number(c.total)}</td>
                  <td className="tabular green">{c.verified}</td>
                  <td className="tabular amber-text">{c.incomplete}</td>
                  <td className="muted">Не установлено</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Полнота не вычисляется без надёжного полного перечня игрового контента. Число записей с
          пробелами относится к импортированному набору.
        </p>
      </section>
      <section className="panel">
        <SectionHeading title="Русификация" />
        <div className="translation-stats">
          <div>
            <b>{report.translations.official}</b>
            <span>Официальных названий</span>
          </div>
          <div>
            <b>{report.translations.verified}</b>
            <span>Проверенных переводов</span>
          </div>
          <div>
            <b>{report.translations.drafts}</b>
            <span>Непроверенных названий</span>
          </div>
          <div>
            <b>{report.translations.missing}</b>
            <span>Переводов ещё нет</span>
          </div>
        </div>
        <p className="footnote">
          Из файлов установленной игры получено {number(report.translations.from_game_files)}{' '}
          названий. Редакционные переводы сохранены. Автоматический импорт не присваивает названиям
          статус официальных или проверенных; английские имена и игровые суффиксы сохранены.
        </p>
      </section>
      <section>
        <SectionHeading title="Использованные источники" count={sources.length} />
        <div className="source-cards">
          {sources.map((source) => (
            <article className="panel source-card" key={source.id}>
              <div>
                <span className="source-domain">
                  {source.acquisition === 'game_files'
                    ? `GOD EATER RESURRECTION / STEAM ${source.app_id}`
                    : 'GOD EATER WIKI / FANDOM'}
                </span>
                <h3>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    source.title
                  )}
                </h3>
                <p>{source.note_ru}</p>
              </div>
              <div className="source-card-footer">
                <span>
                  {source.acquisition === 'game_files'
                    ? `Сборка ${source.build_id}`
                    : source.game_scope === 'mixed'
                      ? 'Только раздел Resurrection'
                      : 'Страница Resurrection'}
                </span>
                {source.authors_url && (
                  <a href={source.authors_url} target="_blank" rel="noreferrer">
                    Авторы и история <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <SectionHeading title="Вопросы импорта" count={report.issues.length} />
        <div className="issue-list">
          {(expanded ? report.issues : report.issues.slice(-7)).map((issue, i) => (
            <article key={i} className="import-issue">
              <CircleHelp size={17} />
              <div>
                <span>{issueLabels[issue.code] || issue.code}</span>
                <h3>{issue.name}</h3>
                <p>{issue.detail}</p>
                {issue.excerpt && (
                  <details>
                    <summary>Фрагмент источника</summary>
                    <pre>{issue.excerpt}</pre>
                  </details>
                )}
              </div>
            </article>
          ))}
        </div>
        {report.issues.length > 7 && (
          <button className="button secondary show-all" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Свернуть' : `Показать все ${report.issues.length} вопросов`}
          </button>
        )}
      </section>
      <section className="quality-principles">
        <div>
          <FileCheck size={21} />
          <h3>Проверка перед сборкой</h3>
          <p>
            Контроль ID, связей, рецептов, циклов, количеств, вероятностей и контрольных сумм копий.
            Проверка структуры не подтверждает игровые факты.
          </p>
        </div>
        <div>
          <GitBranch size={21} />
          <h3>Игры разделены</h3>
          <p>
            В смешанных источниках импортируется только явно выделенный раздел Resurrection.
            Неоднозначные строки сохраняются для разбора.
          </p>
        </div>
        <div>
          <LockKeyhole size={21} />
          <h3>Локальные данные</h3>
          <p>
            Поиск и расчёты работают с JSON этого сайта. Запасы, избранное и цели хранятся только в
            вашем браузере.
          </p>
        </div>
      </section>
      <section className="panel license-panel">
        <h2>Источники и лицензии</h2>
        <p>
          Источники включают файлы установленной God Eater Resurrection и страницы God Eater Wiki. У
          игровых записей сохранены сборка, исходная таблица, ID строки и контрольная сумма. Для
          Wiki сохранены ссылки на страницы и историю правок.
        </p>
        <p>
          Общая политика Fandom предусматривает{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/3.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 3.0
          </a>{' '}
          для текста, если на конкретной Wiki не указано иное. Оригиналы и отдельные лицензионные
          уведомления пока недоступны, поэтому их проверка остаётся открытым пунктом. Правила:{' '}
          <a
            href="https://community.fandom.com/wiki/Help:Licensing"
            target="_blank"
            rel="noreferrer"
          >
            Fandom Licensing
          </a>
          .
        </p>
        <p>
          Материалы, производные от Wiki, и переводы проекта сопровождаются уведомлением CC BY-SA
          3.0. Извлечённым игровым данным проект не присваивает лицензию Wiki. Код проекта — MIT.
          Игровые архивы, изображения и полные описания предметов не включены в сайт.
        </p>
        <p>
          GER Archive — независимый фанатский проект, не связанный с Bandai Namco или
          правообладателями God Eater. Названия игры и персонажей принадлежат их владельцам.
        </p>
        <a className="text-link" href={dataUrl('LICENSE-DATA.md')} download>
          Скачать уведомление об источниках <Download size={14} />
        </a>
      </section>
      <CoverageBar collection="recipes" />
    </>
  );
}
