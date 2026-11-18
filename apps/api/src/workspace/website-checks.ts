import { load } from 'cheerio';

const origin = 'https://generated-site.invalid';

export function websiteLinks(html: string) {
  return load(html)('a[href],area[href]')
    .map((_, link) => (link.attribs.href ?? '').trim())
    .get();
}

export function addCatalogLink(html: string, path: string) {
  if (websiteLinks(html).some((href) => websiteRoute(href, '/') === path))
    return html;
  const $ = load(html);
  const container = $('main').first().length ? $('main').first() : $('body');
  container.append(
    $('<p>').append($('<a>').attr('href', path).text('Shop the catalog')),
  );
  return $.html();
}

export function websiteStyles(html: string) {
  return load(html)('style').text().slice(0, 8000);
}

export function completePageDocument(html: string, title: string) {
  if (!html.startsWith('<')) return html;
  const $ = load(html);
  if (!$('body h1').length) return html;
  if (
    /^<!doctype html>/iu.test(html) &&
    /<\/body>\s*<\/html>$/iu.test(html) &&
    $('html').attr('lang') &&
    $('title').text().trim() &&
    $('meta[name="viewport"]').attr('content') &&
    $('main').length
  )
    return html;
  if (!$('html').attr('lang')) $('html').attr('lang', 'en');
  if (!$('title').text().trim()) {
    $('title').remove();
    $('head').append($('<title>').text(title));
  }
  if (!$('meta[name="viewport"]').attr('content')) {
    $('meta[name="viewport"]').remove();
    $('head').append(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
  }
  if (!$('main').length) $('body').wrapInner('<main></main>');
  return '<!doctype html>' + $('html').toString();
}

export function websiteRoute(href: string, route: string) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) return null;
  const url = URL.parse(href, origin + route);
  return url?.origin === origin ? url.pathname : null;
}

export function checkGeneratedPage(
  html: string,
  route: string,
  routes: Set<string>,
  references: string,
) {
  const $ = load(html);
  const issues: string[] = [];
  if (!/^<!doctype html>/iu.test(html) || !/<\/body>\s*<\/html>$/iu.test(html))
    issues.push('Return a complete HTML5 document ending with </body></html>.');
  if (
    !$('html').attr('lang') ||
    !$('title').text().trim() ||
    !$('meta[name="viewport"]').attr('content') ||
    !$('main').length ||
    !$('body h1').first().text().trim()
  )
    issues.push(
      'Include the language, page title, viewport meta tag, a main landmark and a visible h1 heading.',
    );
  if (!$('style').text().trim())
    issues.push('Include inline CSS in a style element.');
  if (
    $(
      'script, iframe, object, embed, link, base, form, audio, video, meta[http-equiv]',
    ).length
  )
    issues.push(
      'Remove scripts, form submissions, embeds, external stylesheets and HTTP-equiv directives.',
    );

  const attributes = $('*')
    .toArray()
    .flatMap((tag) => ('attribs' in tag ? Object.entries(tag.attribs) : []));
  if (
    attributes.some(
      ([name]) => /^on/iu.test(name) || /^(?:srcdoc|srcset|ping)$/iu.test(name),
    )
  )
    issues.push(
      'Remove HTML event handlers, srcdoc, srcset, and tracking attributes.',
    );
  if (
    attributes.some(
      ([name, value]) =>
        /^(?:src|poster)$/iu.test(name) &&
        !/^data:image\/(?:png|jpeg|gif|webp);base64,/iu.test(value),
    )
  )
    issues.push(
      'Remove image references to files and URLs. Draw with inline SVG or CSS gradients.',
    );
  if (
    attributes.some(
      ([name, value]) => name === 'style' && /url\s*\(|@import/iu.test(value),
    ) ||
    /url\s*\(|@import/iu.test($('style').text())
  )
    issues.push(
      'Remove CSS url() and @import. Use gradients, inline SVG and system fonts.',
    );

  const broken = new Set<string>();
  const groundedLinks = new Set(
    [...references.matchAll(/https:\/\/[^\s<>"\\]+/giu)].flatMap(([value]) => {
      const url = URL.parse(value.replace(/[.,;)]+$/u, ''));
      return url ? [url.href] : [];
    }),
  );
  const groundedEmails = new Set(
    references.toLowerCase().match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gu) ?? [],
  );
  const groundedPhones = new Set(
    (references.match(/\+?\d[\d ().-]{5,}\d/gu) ?? []).map((value) =>
      value.replace(/\D/gu, ''),
    ),
  );
  let inventedLink = false;
  for (const link of $('a[href],area[href]').toArray()) {
    const href = ($(link).attr('href') ?? '').trim();
    const url = URL.parse(href, origin + route);
    if (
      !href ||
      !url ||
      !['https:', 'mailto:', 'tel:'].includes(url.protocol) ||
      (url.origin !== origin && !/^(https:\/\/|mailto:|tel:)/iu.test(href))
    ) {
      issues.push(
        'Use valid site-relative links, HTTPS links, mailto or tel links.',
      );
      break;
    }
    const path = websiteRoute(href, route);
    if (path !== null && !routes.has(path)) broken.add(path);
    if (
      (path === null &&
        url.protocol === 'https:' &&
        !groundedLinks.has(url.href)) ||
      (url.protocol === 'mailto:' &&
        !groundedEmails.has(url.pathname.toLowerCase())) ||
      (url.protocol === 'tel:' &&
        !groundedPhones.has(url.pathname.replace(/\D/gu, '')))
    )
      inventedLink = true;
    if (
      href.startsWith('#') &&
      href !== '#' &&
      !$('[id]')
        .toArray()
        .some((tag) => '#' + $(tag).attr('id') === href)
    )
      broken.add(href);
  }
  if (inventedLink)
    issues.push(
      'Omit invented contact details and outbound links. Use only external destinations, email addresses, and phone numbers supplied in the references.',
    );
  if (broken.size)
    issues.push(
      'Fix navigation targets: ' +
        [...broken]
          .slice(0, 8)
          .map((path) => path.slice(0, 80))
          .join(', '),
    );
  return issues;
}
