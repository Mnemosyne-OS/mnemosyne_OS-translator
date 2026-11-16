import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import './src/styles/theme.css';

// Inside a Mnemosyne OS window, before the first paint: the window paints the
// ground and the page stays transparent (`html.in-host` in the CSS).
if (window.parent !== window) document.documentElement.classList.add('in-host');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
