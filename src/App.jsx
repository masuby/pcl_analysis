import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/Auth/PrivateRoute';
import Login from './components/Auth/Login/Login';
import MainLayout from './components/Layout/MainLayout';
import Dashboard from './pages/Dashboard/Dashboard';
import CSReports from './pages/CSReports/CSReports';
import LBFReports from './pages/LBFReports/LBFReports';
import SMEReports from './pages/SMEReports/SMEReports';
import AllReports from './pages/AllReports/AllReports';
import Administration from './pages/Administration/Administration';
import Profile from './pages/Profile/Profile';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute />}>
            <Route element={<MainLayout />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="cs-reports" element={<CSReports />} />
              <Route path="lbf-reports" element={<LBFReports />} />
              <Route path="sme-reports" element={<SMEReports />} />
              <Route path="all-reports" element={<AllReports />} />
              <Route path="administration" element={<Administration />} />
              <Route path="profile" element={<Profile />} />
              <Route index element={<Navigate to="/dashboard" />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;