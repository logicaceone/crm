import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { PrivateRoute } from './components/PrivateRoute'
import { RoleRoute } from './components/RoleRoute'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Channels } from './pages/Channels'
import { ChannelDetail } from './pages/ChannelDetail'
import { Purchases } from './pages/Purchases'
import { Sales } from './pages/Sales'
import { Budget } from './pages/Budget'
import { Users } from './pages/Users'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route
              path="/dashboard"
              element={
                <RoleRoute allowedRoles={['admin', 'manager', 'viewer']}>
                  <Dashboard />
                </RoleRoute>
              }
            />
            <Route
              path="/channels"
              element={
                <RoleRoute allowedRoles={['admin', 'manager']}>
                  <Channels />
                </RoleRoute>
              }
            />
            <Route
              path="/channels/:id"
              element={
                <RoleRoute allowedRoles={['admin', 'manager']}>
                  <ChannelDetail />
                </RoleRoute>
              }
            />
            <Route
              path="/purchases"
              element={
                <RoleRoute allowedRoles={['admin', 'manager']}>
                  <Purchases />
                </RoleRoute>
              }
            />
            <Route
              path="/sales"
              element={
                <RoleRoute allowedRoles={['admin', 'manager']}>
                  <Sales />
                </RoleRoute>
              }
            />
            <Route
              path="/budget"
              element={
                <RoleRoute allowedRoles={['admin', 'manager']}>
                  <Budget />
                </RoleRoute>
              }
            />
            <Route
              path="/users"
              element={
                <RoleRoute allowedRoles={['admin']}>
                  <Users />
                </RoleRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
