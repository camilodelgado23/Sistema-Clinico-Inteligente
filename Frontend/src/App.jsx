import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'

import Layout        from './components/layout'
import Login         from './views/login'
import Dashboard     from './views/dashboard'
import PatientDetail from './views/PatientDetail'
import AdminPanel    from './views/AdminPanel'
import PatientView   from './views/PatientView'
import AgentView     from './views/AgentView'
import SuperUserView from './views/SuperUserView'

function PrivateRoute({ children, roles }) {
  const { token, role } = useAuthStore()
  const normalizedRole = role?.toUpperCase()
  if (!token) return <Navigate to="/login" replace />
  if (roles && !roles.includes(normalizedRole)) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const { role } = useAuthStore()
  const normalizedRole = role?.toUpperCase()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Ruta pública — médico externo no necesita cuenta interna */}
        <Route path="/superuser" element={<SuperUserView />} />

        <Route path="/" element={
          !normalizedRole ? <Navigate to="/login" replace />
          : normalizedRole === 'PACIENTE' ? <Navigate to="/my-profile" replace />
          : normalizedRole === 'ADMIN'    ? <Navigate to="/admin" replace />
          : <Navigate to="/dashboard" replace />
        } />

        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>

          <Route path="/dashboard" element={
            <PrivateRoute roles={['MEDICO','ADMIN']}><Dashboard /></PrivateRoute>
          } />

          <Route path="/patients/:id" element={
            <PrivateRoute roles={['MEDICO','ADMIN']}><PatientDetail /></PrivateRoute>
          } />

          <Route path="/agent" element={
            <PrivateRoute roles={['MEDICO','ADMIN']}><AgentView /></PrivateRoute>
          } />

          <Route path="/admin" element={
            <PrivateRoute roles={['ADMIN']}><AdminPanel /></PrivateRoute>
          } />

          <Route path="/my-profile" element={
            <PrivateRoute roles={['PACIENTE']}><PatientView /></PrivateRoute>
          } />

        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
