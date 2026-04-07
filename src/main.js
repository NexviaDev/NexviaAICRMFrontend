import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app';
import PwaUpdatePrompt from './components/pwa-update-prompt/pwa-update-prompt';
import './styles/global.css';
/** Capacitor 앱에서만 window.__nexviaGeolocation 주입 (일반 브라우저·PWA 웹은 무시) */
import './lib/nexvia-native-geolocation';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PwaUpdatePrompt />
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
