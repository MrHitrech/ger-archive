import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context';
import {
  Empty,
  EntityLink,
  kindLabels,
  PageTitle,
  RecordIcon,
  SearchBox,
  SectionHeading,
} from '../components';
import type { EntityKind } from '../types';

export default function SearchResults() {
  const [params] = useSearchParams();
  const { search } = useApp();
  const query = params.get('q') || '';
  const results = query.trim() ? search(query) : [];
  const kinds: EntityKind[] = ['material', 'item', 'mission', 'aragami'];
  return (
    <>
      <PageTitle
        eyebrow="Архив / Поиск"
        title="Поиск по всему архиву"
        description="Русские и английские названия, альтернативные переводы и небольшие опечатки."
      />
      <SearchBox initial={query} large />
      <div className="results-header search-results-heading">
        <span>
          {query
            ? `По запросу «${query}» найдено ${results.length}`
            : 'Введите название для поиска'}
        </span>
      </div>
      {results.length ? (
        kinds.map((kind) => {
          const entries = results.filter((e) => e.kind === kind);
          return entries.length ? (
            <section className="panel" key={kind}>
              <SectionHeading title={kindLabels[kind]} count={entries.length} />
              <div className="compact-records">
                {entries.map((e) => (
                  <div className="compact-record" key={e.id}>
                    <RecordIcon id={e.id} kind={e.kind} category={e.category} />
                    <EntityLink kind={kind} id={e.id} />
                  </div>
                ))}
              </div>
            </section>
          ) : null;
        })
      ) : (
        <Empty
          title={query ? 'Ничего не найдено' : 'Что найти в архиве?'}
          text="Попробуйте русское или английское название материала, предмета, миссии или арагами."
        />
      )}
    </>
  );
}
