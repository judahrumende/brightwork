import { useEffect, useMemo, useRef, useState } from 'react';

function editableMarkup(html: string) {
  const template = document.createElement('template');
  const body = /<body(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?>/iu.exec(html);
  const start = body ? body.index + body[0].length : 0;
  const end = body ? html.toLowerCase().lastIndexOf('</body>') : -1;
  const wrapped = end >= start;
  template.innerHTML = wrapped ? html.slice(start, end) : html;
  const text = Array.from(
    template.content.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,a,button,figcaption,li',
    ),
  ).filter((node) => node.childElementCount === 0);
  const images = Array.from(template.content.querySelectorAll('img'));
  const serialize = () =>
    wrapped
      ? html.slice(0, start) + template.innerHTML + html.slice(end)
      : template.innerHTML;
  return { template, text, images, serialize };
}

export function WebsiteVisual({
  html,
  maxLength,
  busy,
  onChange,
}: {
  html: string;
  maxLength: number;
  busy: boolean;
  onChange: (html: string) => void;
}) {
  const { text, images } = useMemo(() => editableMarkup(html), [html]);
  const [part, setPart] = useState(0);
  const [image, setImage] = useState(-1);
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const latestHtml = useRef(html);
  useEffect(() => {
    latestHtml.current = html;
  }, [html]);
  const selected = text[part];

  function updateText(value: string) {
    const parsed = editableMarkup(html);
    const node = parsed.text[part];
    if (!node) return;
    node.textContent = value;
    const updated = parsed.serialize();
    if (updated.length > maxLength) {
      setError('This page has reached its size limit.');
      return;
    }
    setError('');
    onChange(updated);
  }

  function addImage(file: File) {
    setError('');
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        file.type,
      ) ||
      file.size > 32 * 1024 ||
      !file.size
    ) {
      setError('Choose a PNG, JPEG, WebP, or GIF up to 32 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read that image.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      if (latestHtml.current !== html) {
        setError('The page changed while the image loaded. Select it again.');
        return;
      }
      const parsed = editableMarkup(html);
      const existing = parsed.images[image];
      const target = existing ?? document.createElement('img');
      target.setAttribute('src', reader.result);
      target.setAttribute('alt', alt);
      target.removeAttribute('srcset');
      if (!existing) parsed.template.content.append(target);
      const updated = parsed.serialize();
      if (updated.length > maxLength) {
        setError('This image would exceed the page size limit.');
        return;
      }
      onChange(updated);
    };
    reader.readAsDataURL(file);
  }

  return (
    <details>
      <summary>Visual editing</summary>
      {text.length > 0 && (
        <>
          <label>
            Text element
            <select
              value={part}
              onChange={(event) => setPart(Number(event.currentTarget.value))}
            >
              {text.map((element, index) => (
                <option key={index} value={index}>
                  {element.tagName.toLowerCase()} ·{' '}
                  {(element.textContent ?? '').slice(0, 60) || 'Empty'}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <label>
              Element text
              <textarea
                value={selected.textContent ?? ''}
                disabled={busy}
                onChange={(event) => updateText(event.currentTarget.value)}
              />
            </label>
          )}
        </>
      )}
      <label>
        Image placement
        <select
          value={image}
          onChange={(event) => {
            const index = Number(event.currentTarget.value);
            setImage(index);
            setAlt(images[index]?.alt ?? '');
          }}
        >
          <option value={-1}>Add at end of page</option>
          {images.map((element, index) => (
            <option key={index} value={index}>
              Replace {element.alt || 'image ' + (index + 1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Image description
        <input
          value={alt}
          maxLength={200}
          onChange={(event) => setAlt(event.currentTarget.value)}
        />
      </label>
      <label>
        Image file
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) addImage(file);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
