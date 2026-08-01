import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
const storedTheme = localStorage.getItem('grain-pos-theme');
document.documentElement.setAttribute(
  'data-theme',
  storedTheme === 'dark' ? 'dark' : 'light',
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);