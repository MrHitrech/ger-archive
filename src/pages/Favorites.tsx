import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bookmark, Download, Upload } from 'lucide-react';
import { useApp } from '../context';
import {
  Empty,
  EntityName,
  FavoriteButton,
  kindLabels,
  PageTitle,
  RecordIcon,
  routeFor,
} from '../components';
import { sanitizeProgress } from '../lib/storage';

export default function Favorites() {
  const { progress, entries, update } = useApp();
  const [message, setMessage] = useState('');
  const favorites = progress.favorites
    .map((id) => entries.find((e) => e.id === id))
    .filter((e) => e !== undefined);
  const missing = progress.favorites.length - favorites.length;
  function exportProgress() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ger-archive-progress.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <PageTitle
        eyebrow="Ваш арсенал / Закладки"
        title="Избранное"
        description="Сохранённые материалы, рецепты, миссии и арагами — всегда под рукой."
      />
      <div className="results-header">
        <span>
          <Bookmark size={14} />
          {favorites.length} сохранённых записей
        </span>
        <Link className="text-link" to="/planner">
          План крафта <ArrowRight size={14} />
        </Link>
      </div>
      {favorites.length ? (
        <div className="panel compact-records">
          {favorites.map((e) => (
            <div className="compact-record" key={e.id}>
              <RecordIcon id={e.id} kind={e.kind} category={e.category} />
              <Link className="entity-link" to={routeFor(e)}>
                <EntityName id={e.id} />
              </Link>
              <span className="muted">{kindLabels[e.kind]}</span>
              <FavoriteButton id={e.id} />
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="Пока нет избранного"
          text="Нажмите на значок закладки рядом с записью, чтобы сохранить её здесь."
          action={
            <Link className="button secondary" to="/materials">
              Открыть материалы
            </Link>
          }
        />
      )}
      {missing > 0 && (
        <p className="footnote">
          {missing} сохранённых записей отсутствуют в текущей базе; их ID сохранены на случай
          обновления.
        </p>
      )}
      <section className="panel backup-panel">
        <h2>Резервная копия прогресса</h2>
        <p>
          Перенесите закладки, запасы и план в другой браузер. Импорт заменяет текущий прогресс.
        </p>
        <div className="button-row">
          <button className="button secondary" onClick={exportProgress}>
            <Download size={15} />
            Скачать JSON
          </button>
          <label className="button secondary file-button">
            <Upload size={15} />
            Загрузить копию
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 2_000_000) throw new Error('Файл слишком большой.');
                  const raw = JSON.parse(await file.text());
                  if (raw?.version !== 1)
                    throw new Error('Формат резервной копии не поддерживается.');
                  const restored = sanitizeProgress(raw);
                  update(() => restored);
                  setMessage('Резервная копия загружена.');
                } catch (error) {
                  setMessage((error as Error).message || 'Не удалось прочитать JSON.');
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
    </>
  );
}
