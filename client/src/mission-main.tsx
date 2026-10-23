import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MissionApp } from './MissionApp';
import './styles/global.css';

document.documentElement.setAttribute('data-theme', 'dark');
document.documentElement.setAttribute('data-scheme', 'matrix');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <MissionApp />
    </BrowserRouter>
  </React.StrictMode>,
);
