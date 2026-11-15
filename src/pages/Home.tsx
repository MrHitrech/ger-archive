import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  Database,
  Gem,
  ListChecks,
  Search,
  Shield,
  Skull,
  Swords,
} from 'lucide-react';
import { useApp } from '../context';
import {
  EntityLink,
  EntityName,
  FavoriteButton,
  RecordIcon,
  SearchBox,
  SectionHeading,
  number,
  routeFor,
} from '../components';

export default function Home() {
  const { report, entries, progress } = useApp();
  const [mode, setMode] = useState<'material' | 'item'>('material');
  const materials = ['Brittle Titanium', 'Pixie Thorn', 'Aragami Bone Chip', 'Ogre Tail']
    .map((name) => entries.find((e) => e.kind === 'material' && e.name_en === name))
    .filter((e) => e !== undefined);
  const equipment = ['Knife P', 'Fiery Knife', 'Dama de Ferro', 'Decoy Shield']
    .map((name) => entries.find((e) => e.kind === 'item' && e.name_en === name))
    .filter((e) => e !== undefined);
  const recent = progress.recent
    .map((id) => entries.find((e) => e.id === id))
    .filter((e) => e !== undefined)
    .slice(0, 4);
  return (
    <>
      <header className="hero">
        <div className="hero-content">
          <p className="eyebrow">
            <span className="red-line" />
            Полевой справочник · God Eater Resurrection
          </p>
          <h1>
            Знай, что искать.
            <br />
            <span>Собери свой арсенал.</span>
          </h1>
          <p>
            Материалы, рецепты и миссии в одном архиве.
            <br className="desktop-only" /> От нужного снаряжения — к способу добычи.
          </p>
          <div className="hero-tags">
            <span>
              <Database size={13} />
              Локальная база
            </span>
            <span>
              <BookOpen size={13} />
              Русский + English
            </span>
            <span>Только Resurrection</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="art-cross" />
          <Swords size={86} strokeWidth={0.8} />
          <span className="art-label">
            GE:R
            <br />
            <small>FIELD ARCHIVE / 01</small>
          </span>
          <span className="art-coordinate">
            RESURRECTION
            <br />
            DATABASE / RU
          </span>
        </div>
      </header>
      <section className="home-search">
        <div className="search-section-top">
          <h2>Что будем искать?</h2>
          <div className="segmented" aria-label="Область поиска">
            <button
              className={mode === 'material' ? 'active' : ''}
              onClick={() => setMode('material')}
              aria-pressed={mode === 'material'}
            >
              <Gem size={15} />
              Материалы
            </button>
            <button
              className={mode === 'item' ? 'active' : ''}
              onClick={() => setMode('item')}
              aria-pressed={mode === 'item'}
            >
              <Swords size={15} />
              Крафт
            </button>
          </div>
        </div>
        <SearchBox key={mode} kind={mode} large />
        <p className="search-help">
          Например: <Link to="/materials?q=титан">титан</Link>,{' '}
          <Link to="/materials?q=Pixie+Thorn">Pixie Thorn</Link> или{' '}
          <Link to="/craft?q=Knife">Knife</Link>
          <span>Поддерживаются опечатки и альтернативные названия</span>
        </p>
      </section>
      <section className="stat-grid" aria-label="Наполнение архива">
        {[
          { key: 'materials', icon: Gem, label: 'Материалов', route: '/materials' },
          { key: 'items', icon: Swords, label: 'Предметов крафта', route: '/craft' },
          { key: 'missions', icon: ListChecks, label: 'Миссий', route: '/missions' },
          { key: 'aragami', icon: Skull, label: 'Арагами', route: '/aragami' },
        ].map(({ key, icon: Icon, label, route }) => (
          <Link key={key} to={route} className="stat-card">
            <div>
              <Icon size={18} />
              <ArrowUpRight size={15} />
            </div>
            <strong>{number(report.coverage[key].total)}</strong>
            <p>{label}</p>
            <small>
              {report.coverage[key].verified} проверено · {report.coverage[key].incomplete} с
              пробелами
            </small>
          </Link>
        ))}
      </section>
      <div className="home-columns">
        <section>
          <SectionHeading title="Материалы для начала" link="/materials" />
          <div className="panel compact-records">
            {materials.map((e) => (
              <div className="compact-record" key={e.id}>
                <RecordIcon />
                <EntityLink kind="material" id={e.id} />
                <FavoriteButton id={e.id} />
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionHeading title="Снаряжение и ветки" link="/craft" />
          <div className="panel compact-records">
            {equipment.map((e) => (
              <div className="compact-record" key={e.id}>
                <RecordIcon kind="item" category={e.category} />
                <EntityLink kind="item" id={e.id} />
                <span className="rank-label">Ранг {e.rank ?? 'не установлен'}</span>
                <FavoriteButton id={e.id} />
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="route-banner">
        <span className="banner-icon">
          <Search size={23} />
        </span>
        <div>
          <h3>От рецепта к миссии</h3>
          <p>Откройте предмет, выберите материал и узнайте, где его получить.</p>
        </div>
        <div className="route-steps">
          <Swords size={18} />
          <ArrowRight size={13} />
          <Gem size={18} />
          <ArrowRight size={13} />
          <Shield size={18} />
        </div>
        <Link className="button secondary" to="/craft">
          Открыть крафт <ArrowRight size={15} />
        </Link>
      </section>
      {recent.length > 0 && (
        <section className="recent-section">
          <SectionHeading title="Недавно открытые" />
          <div className="recent-grid">
            {recent.map((e) => (
              <Link to={routeFor(e)} className="recent-card" key={e.id}>
                <RecordIcon kind={e.kind} category={e.category} />
                <EntityName id={e.id} compact />
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="quality-callout">
        <CheckCheck size={20} />
        <div>
          <h3>Архив пополняется. Точность — в приоритете.</h3>
          <p>
            Предметы и рецепты дополнены из файлов игры. Неизвестные шансы и условия открытия
            отмечены отдельно; полнота базы относительно игры не установлена.
          </p>
        </div>
        <Link to="/sources">
          Источники и проверка <ArrowRight size={14} />
        </Link>
      </section>
    </>
  );
}
