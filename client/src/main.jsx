import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';

import AdminLayout from './admin/AdminLayout.jsx';
import Login from './admin/Login.jsx';
import Dashboard from './admin/Dashboard.jsx';
import Templates from './admin/Templates.jsx';
import TemplateBuilder from './admin/TemplateBuilder.jsx';
import Activations from './admin/Activations.jsx';
import ActivationForm from './admin/ActivationForm.jsx';
import Submissions from './admin/Submissions.jsx';
import SubmissionDetail from './admin/SubmissionDetail.jsx';
import Students from './admin/Students.jsx';

import Home from './public/Home.jsx';
import FormPage from './public/FormPage.jsx';
import TrackPage from './public/TrackPage.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/form/:slug" element={<FormPage />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="templates" element={<Templates />} />
          <Route path="templates/new" element={<TemplateBuilder />} />
          <Route path="templates/:id" element={<TemplateBuilder />} />
          <Route path="activations" element={<Activations />} />
          <Route path="activations/new" element={<ActivationForm />} />
          <Route path="activations/:id" element={<ActivationForm />} />
          <Route path="submissions" element={<Submissions />} />
          <Route path="submissions/:id" element={<SubmissionDetail />} />
          <Route path="students" element={<Students />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
