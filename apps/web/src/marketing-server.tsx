import { renderToString } from 'react-dom/server';
import { MarketingPage, marketingMetadata } from './marketing/pages';

export function renderMarketing(
  template: string,
  path: string,
  origin: string,
) {
  const meta = marketingMetadata(path);
  if (!meta) return null;
  const head = renderToString(
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={new URL(path, origin).href} />
    </>,
  );
  const markup = renderToString(<MarketingPage path={path} />);
  return template
    .replace('</head>', () => head + '</head>')
    .replace(
      '<div id="root"></div>',
      () => '<div id="root" data-marketing-ssr>' + markup + '</div>',
    );
}
