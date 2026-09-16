import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root to mount on');

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
