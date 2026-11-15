import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PlatformProvider } from './context/PlatformContext';
import { cleanupAppInstall, initializeAppInstall } from './lib/appInstall';
import { InstallAppPrompt } from './components/InstallApp';
import { registerServiceWorker } from './lib/registerServiceWorker';
import './styles.css';
import './theme.css';

initializeAppInstall();
createRoot(document.getElementById('root')).render(<React.StrictMode><PlatformProvider><App /></PlatformProvider><InstallAppPrompt/></React.StrictMode>);
registerServiceWorker();
if (import.meta.hot) import.meta.hot.dispose(cleanupAppInstall);
