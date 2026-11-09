import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './AppContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Simulator from './pages/Simulator';
import History from './pages/History';
import DataManager from './pages/DataManager';
import Admin from './pages/Admin';
import Security from './pages/Security';
import Documentation from './pages/Documentation';

function Guard({ roles, children }) {
  const { user } = useApp();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, ready } = useApp();
  if (!ready) return <div className="h-full grid place-items-center text-tx2">…</div>;
  const home = user?.role === 'ANALYST' ? '/history' : '/';
  return (
    <div className="min-h-full flex flex-col">
      <Navbar />
      <main className="flex-1 px-4 py-4 max-w-[1600px] w-full mx-auto">
        <Routes>
          <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login />} />
          <Route path="/" element={<Guard roles={['TRADER', 'ADMIN']}>{user?.role === 'ANALYST' ? <Navigate to="/history" replace /> : <Simulator />}</Guard>} />
          <Route path="/history" element={<Guard><History /></Guard>} />
          <Route path="/data" element={<Guard roles={['ANALYST', 'ADMIN']}><DataManager /></Guard>} />
          <Route path="/admin" element={<Guard roles={['ADMIN']}><Admin /></Guard>} />
          <Route path="/security" element={<Guard><Security /></Guard>} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
