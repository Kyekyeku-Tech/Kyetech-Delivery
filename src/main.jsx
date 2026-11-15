import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PlatformProvider } from './context/PlatformContext';
import { initializeAppInstall } from './lib/appInstall';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './styles.css';
import './theme.css';

initializeAppInstall();
createRoot(document.getElementById('root')).render(<React.StrictMode><PlatformProvider><App /></PlatformProvider></React.StrictMode>);
registerServiceWorker();
