import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app/router';
import { Providers } from './app/providers';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AppRoutes />
    </Providers>
  </StrictMode>,
);
