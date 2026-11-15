import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  Bookmark,
  BookOpen,
  ChevronRight,
  Database,
  Gem,
  Home,
  ListChecks,
  Menu,
  Skull,
  Swords,
  X,
  Zap,
} from 'lucide-react';
import { AppProvider, useApp } from './context';
import { Empty, Loading, SearchBox } from './components';
const HomePage = lazy(() => import('./pages/Home'));
const MaterialCatalog = lazy(() =>
  import('./pages/Catalogs').then((m) => ({ default: m.MaterialCatalog })),
);
const CraftCatalog = lazy(() =>
  import('./pages/Catalogs').then((m) => ({ default: m.CraftCatalog })),
);
const MissionCatalog = lazy(() =>
  import('./pages/Catalogs').then((m) => ({ default: m.MissionCatalog })),
);
const AragamiCatalog = lazy(() =>
  import('./pages/Catalogs').then((m) => ({ default: m.AragamiCatalog })),
);
const MaterialDetail = lazy(() =>
  import('./pages/Details').then((m) => ({ default: m.MaterialDetail })),
);
const ItemDetail = lazy(() => import('./pages/Details').then((m) => ({ default: m.ItemDetail })));
const MissionDetail = lazy(() =>
  import('./pages/Details').then((m) => ({ default: m.MissionDetail })),
);
const AragamiDetail = lazy(() =>
  import('./pages/Details').then((m) => ({ default: m.AragamiDetail })),
);
const Planner = lazy(() => import('./pages/Planner'));
const Favorites = lazy(() => import('./pages/Favorites'));
const Sources = lazy(() => import('./pages/Sources'));
const SearchResults = lazy(() => import('./pages/SearchResults'));
const nav = [
  { to: '/', label: 'Обзор архива', icon: Home },
  { to: '/materials', label: 'Материалы', icon: Gem, count: 'materials' },
  { to: '/craft', label: 'Крафт и снаряжение', icon: Swords, count: 'items' },
  { to: '/missions', label: 'Миссии', icon: ListChecks, count: 'missions' },
  { to: '/aragami', label: 'Арагами', icon: Skull, count: 'aragami' },
];

function Layout() {
  const { progress, update, report, storageError, notice } = useApp();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const current = [
    ...nav,
    { to: '/planner', label: 'План крафта' },
    { to: '/favorites', label: 'Избранное' },
    { to: '/sources', label: 'Источники и проверка' },
    { to: '/search', label: 'Поиск по архиву' },
  ].find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    document.title = `${current?.label || 'Архив'} — GER Archive`;
  }, [location.pathname]);
  useEffect(() => {
    if (!menu) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [menu]);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Перейти к содержимому
      </a>
      {menu && (
        <button className="menu-scrim" aria-label="Закрыть меню" onClick={() => setMenu(false)} />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Основная навигация">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Zap size={24} fill="currentColor" />
          </span>
          <span>
            GER<span className="brand-light"> ARCHIVE</span>
            <small>GOD EATER RESURRECTION</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Закрыть меню"
          onClick={() => setMenu(false)}
        >
          <X size={19} />
        </button>
        <div className="nav-caption">ИССЛЕДОВАТЬ БАЗУ</div>
        <nav>
          {nav.map(({ to, label, icon: Icon, count }) => (
            <NavLink
              key={to}
              end={to === '/'}
              to={to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {count && <small>{report.coverage[count]?.total}</small>}
            </NavLink>
          ))}
        </nav>
        <div className="nav-caption personal-caption">ВАШ АРСЕНАЛ</div>
        <nav>
          <NavLink
            to="/planner"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <ListChecks size={18} />
            <span>План крафта</span>
            <small>{progress.targets.filter((t) => !t.completed).length}</small>
          </NavLink>
          <NavLink
            to="/favorites"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Bookmark size={18} />
            <span>Избранное</span>
            <small>{progress.favorites.length}</small>
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <NavLink
            to="/sources"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <BookOpen size={18} />
            <span>Источники и проверка</span>
            <ArrowUpRight size={14} />
          </NavLink>
          <div className="sidebar-data-status">
            <span>
              <i />
              База пополняется
            </span>
            <p>Полнота пока не установлена</p>
            <small>v0.1 · {report.checked_at}</small>
          </div>
          <div className="sidebar-footer">
            <Database size={13} /> Независимый фанатский архив
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Архив</span>
            <ChevronRight size={12} />
            <b>{current?.label || 'Запись'}</b>
          </div>
          <div className="topbar-search">
            <SearchBox />
          </div>
          <label className="language-select">
            <span className="sr-only">Отображение названий</span>
            <select
              aria-label="Отображение названий"
              value={progress.language}
              onChange={(e) =>
                update((s) => ({ ...s, language: e.target.value as 'both' | 'ru' | 'en' }))
              }
            >
              <option value="both">RU + EN</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
        </header>
        {storageError && (
          <div className="storage-warning" role="alert">
            Браузер не разрешает сохранять прогресс. Текущие изменения доступны до закрытия
            страницы; скачайте резервную копию в избранном.
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/materials" element={<MaterialCatalog />} />
              <Route path="/materials/:id" element={<MaterialDetail />} />
              <Route path="/craft" element={<CraftCatalog />} />
              <Route path="/craft/:id" element={<ItemDetail />} />
              <Route path="/missions" element={<MissionCatalog />} />
              <Route path="/missions/:id" element={<MissionDetail />} />
              <Route path="/aragami" element={<AragamiCatalog />} />
              <Route path="/aragami/:id" element={<AragamiDetail />} />
              <Route path="/planner" element={<Planner />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/search" element={<SearchResults />} />
              <Route
                path="*"
                element={
                  <Empty
                    title="Страница не найдена"
                    text="В архиве нет такого адреса."
                    action={
                      <Link className="button secondary" to="/">
                        Открыть главную
                      </Link>
                    }
                  />
                }
              />
            </Routes>
          </Suspense>
          <footer className="main-footer">
            <span>
              GER ARCHIVE <span className="footer-divider">/</span> God Eater Resurrection
            </span>
            <Link to="/sources">
              Фанатский проект · источники и лицензии <ArrowUpRight size={12} />
            </Link>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <ListChecks size={17} />
          {notice}
          <Link to="/planner">
            Открыть <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Layout />
      </AppProvider>
    </HashRouter>
  );
}
