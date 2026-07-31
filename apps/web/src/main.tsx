import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';

async function enableMocking() {
  if (!import.meta.env.DEV) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

void enableMocking().then(() => {
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
