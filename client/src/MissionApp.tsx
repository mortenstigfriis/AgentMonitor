import { Routes, Route } from 'react-router-dom';
import { Login } from './pages/Login';
import { MissionControl } from './pages/MissionControl';
import { useAuth } from './hooks/useAuth';
import { LanguageProvider } from './i18n';

function AuthenticatedMissionControl() {
  const { authenticated, loading, logout } = useAuth();
  if (loading) return <div className="mc-boot">INITIALIZING MISSION CONTROL…</div>;
  if (!authenticated) return null;

  return (
    <div className="app mc-app">
      <nav className="nav mc-nav">
        <a href="/" className="nav-brand">TALIFLY // MC</a>
        <span>READ-ONLY OBSERVABILITY</span>
        <button className="nav-control" onClick={logout}>Logout</button>
      </nav>
      <main className="main"><MissionControl /></main>
    </div>
  );
}

export function MissionApp() {
  return (
    <LanguageProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AuthenticatedMissionControl />} />
      </Routes>
    </LanguageProvider>
  );
}
