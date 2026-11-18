import '@fontsource-variable/plus-jakarta-sans';
import './styles/tokens.css';
import './styles/global.css';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { MarketingPage, marketingMetadata } from './marketing/pages';

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root');

const path = location.pathname.replace(/\/$/u, '') || '/';
const marketing = marketingMetadata(path);
if (marketing) {
  const page = <MarketingPage path={path} />;
  if (root.hasAttribute('data-marketing-ssr')) hydrateRoot(root, page);
  else {
    document.title = marketing.title;
    createRoot(root).render(page);
  }
} else {
  const { Application } = await import('./application');
  createRoot(root).render(<Application />);
}
