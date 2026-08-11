import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerServiceWorker } from './registerSW.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Makes the dashboard installable as the "Digital Agent" app. Production only —
// a service worker in dev caches the very files Vite is trying to hot-reload.
registerServiceWorker();
