import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WebsitePage } from '@brightwork/shared';
import { api, write } from '../auth/client';

type PreviewRequest = {
  channel: 'foundable-app-preview';
  nonce: string;
  id: string;
  operation:
    | 'list'
    | 'create'
    | 'update'
    | 'delete'
    | 'action'
    | 'storage-list'
    | 'storage-put'
    | 'storage-get'
    | 'storage-remove'
    | 'jobs-list'
    | 'jobs-schedule'
    | 'jobs-cancel'
    | 'function';
  collection: string;
  recordId?: string;
  data?: Record<string, unknown>;
  action?: string;
  fileId?: string;
  name?: string;
  mime?: string;
  jobId?: string;
  functionName?: string;
  input?: unknown;
};
type PreviewRecord = {
  id: string;
  data: Record<string, unknown>;
  actions?: { name: string; label: string }[];
};

function previewRuntime(nonce: string) {
  return `<script nonce="${nonce}">
    (() => {
      const nonce = ${JSON.stringify(nonce)};
      const pending = new Map();
      let next = 0;
      const request = (payload) => new Promise((resolve, reject) => {
        const id = String(++next);
        pending.set(id, { resolve, reject });
        parent.postMessage({ channel: 'foundable-app-preview', nonce, id, ...payload }, '*');
      });
      window.foundableStorage = {
        list: () => request({ operation: 'storage-list', collection: 'records' }),
        put: (name, mime, data) => request({ operation: 'storage-put', collection: 'records', name, mime, data: { data } }),
        get: (fileId) => request({ operation: 'storage-get', collection: 'records', fileId }),
        remove: (fileId) => request({ operation: 'storage-remove', collection: 'records', fileId }),
      };
      window.foundableJobs = {
        list: () => request({ operation: 'jobs-list', collection: 'records' }),
        schedule: (collection, recordId, action, runAt) => request({
          operation: 'jobs-schedule', collection: 'records',
          data: { id: crypto.randomUUID(), collection, recordId, action, runAt },
        }),
        cancel: (jobId) => request({ operation: 'jobs-cancel', collection: 'records', jobId }),
      };
      window.foundableFunctions = {
        invoke: async (functionName, input = {}) => {
          const result = await request({ operation: 'function', collection: 'records', functionName, input });
          return result.result;
        },
      };
      const text = (tag, value) => {
        const node = document.createElement(tag);
        node.textContent = value;
        return node;
      };
      const value = (field) => field.type === 'checkbox' ? field.checked
        : field.type === 'number' && field.value !== '' ? Number(field.value) : field.value;
      const clear = (root) => {
        delete root.dataset.foundableEditing;
        for (const field of root.querySelectorAll('[data-foundable-field]')) {
          if (field.type === 'checkbox') field.checked = false;
          else field.value = '';
        }
        const button = root.querySelector('button[data-foundable-create]');
        if (button) {
          button.textContent = button.dataset.foundableLabel || 'Save';
          delete button.dataset.foundableLabel;
        }
        const status = root.querySelector('[data-foundable-status]');
        if (status) status.textContent = '';
        root.querySelector('button[data-preview-cancel]')?.remove();
      };
      const refresh = async (root) => {
        const list = root.querySelector('[data-foundable-record-list]');
        if (!list) return;
        try {
          const result = await request({ operation: 'list', collection: root.dataset.foundableRecords || 'records' });
          list.replaceChildren();
          for (const record of result.records || []) {
            const card = document.createElement('article');
            const fields = document.createElement('dl');
            for (const [key, item] of Object.entries(record.data || {})) {
              fields.append(text('dt', key), text('dd', typeof item === 'string' ? item : JSON.stringify(item)));
            }
            card.append(fields);
            for (const action of record.actions || []) {
              const button = text('button', action.label);
              button.type = 'button';
              button.dataset.previewAction = action.name;
              button.dataset.previewRecord = record.id;
              card.append(button);
            }
            const edit = text('button', 'Edit');
            edit.type = 'button';
            edit.dataset.previewEdit = record.id;
            edit.dataset.previewRecord = record.id;
            card.append(edit);
            const remove = text('button', 'Delete');
            remove.type = 'button';
            remove.dataset.previewDelete = record.id;
            card.append(remove);
            list.append(card);
          }
        } catch (error) {
          list.replaceChildren(text('p', error.message || 'Could not load preview data'));
        }
      };
      window.addEventListener('message', (event) => {
        if (event.source !== parent || event.data?.channel !== 'foundable-app-preview' || event.data?.nonce !== nonce || event.data?.type !== 'result') return;
        const call = pending.get(event.data.id);
        if (!call) return;
        pending.delete(event.data.id);
        if (event.data.ok) call.resolve(event.data.value);
        else call.reject(new Error(event.data.message || 'Preview request failed'));
      });
      const initializedRoots = new WeakSet();
      const initialize = (root) => {
        if (initializedRoots.has(root)) return;
        initializedRoots.add(root);
        refresh(root);
      };
      const scan = (node) => {
        if (!(node instanceof Element)) return;
        if (node.matches('[data-foundable-records]')) initialize(node);
        for (const root of node.querySelectorAll('[data-foundable-records]')) initialize(root);
      };
      scan(document.documentElement);
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.addedNodes) scan(node);
      }).observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('click', async (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (!button) return;
        const root = button.closest('[data-foundable-records]');
        if (!root) return;
        const collection = root.dataset.foundableRecords || 'records';
        try {
          if (button.dataset.previewAction) {
            await request({ operation: 'action', collection, recordId: button.dataset.previewRecord, action: button.dataset.previewAction });
            return refresh(root);
          }
          if (button.dataset.previewDelete) {
            await request({ operation: 'delete', collection, recordId: button.dataset.previewDelete });
            return refresh(root);
          }
          if (button.dataset.previewEdit) {
            const card = button.closest('article');
            root.dataset.foundableEditing = button.dataset.previewRecord;
            for (const field of root.querySelectorAll('[data-foundable-field]')) {
              const key = field.name;
              const display = card?.querySelectorAll('dd');
              if (!key || !display) continue;
              const entries = [...card.querySelectorAll('dl dt')].map((node) => node.textContent || '');
              const index = entries.indexOf(key);
              const raw = index < 0 ? '' : display[index]?.textContent || '';
              if (field.type === 'checkbox') field.checked = raw === 'true';
              else field.value = raw;
            }
            if (!root.querySelector('button[data-preview-cancel]')) {
              const cancel = text('button', 'Cancel edit');
              cancel.type = 'button';
              cancel.dataset.previewCancel = '';
              root.append(cancel);
            }
            const save = root.querySelector('button[data-foundable-create]');
            if (save) {
              save.dataset.foundableLabel ||= save.textContent || 'Save';
              save.textContent = 'Save changes';
            }
            return;
          }
          if (button.dataset.previewCancel) return clear(root);
          if (!button.matches('button[data-foundable-create]')) return;
          const data = {};
          for (const field of root.querySelectorAll('[data-foundable-field]')) {
            if (field.name) data[field.name] = value(field);
          }
          const recordId = root.dataset.foundableEditing;
          await request({ operation: recordId ? 'update' : 'create', collection, ...(recordId ? { recordId } : {}), data });
          clear(root);
          await refresh(root);
        } catch (error) {
          let status = root.querySelector('[data-foundable-status]');
          if (!status) {
            status = text('p', '');
            status.dataset.foundableStatus = '';
            root.append(status);
          }
          status.textContent = error.message || 'Preview request failed';
        }
      });
    })();
  </script>`;
}

function previewMarkup(html: string, nonce?: string, compiledApp = false) {
  if (compiledApp && nonce) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed
      .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
      .forEach((node) => node.remove());
    const scripts = [...parsed.querySelectorAll('script')];
    if (scripts.some((script) => script.src || script.type !== 'module'))
      return previewMarkup(
        '<main>Compiled app preview could not be loaded.</main>',
        nonce,
      );
    for (const script of scripts) script.setAttribute('nonce', nonce);
    parsed
      .querySelectorAll('link[rel="modulepreload"]')
      .forEach((node) => node.remove());
    parsed.head.insertAdjacentHTML(
      'beforeend',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`,
    );
    parsed.body.insertAdjacentHTML('beforeend', previewRuntime(nonce));
    return '<!doctype html>' + parsed.documentElement.outerHTML;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const doc = template.content;
  doc
    .querySelectorAll('script,iframe,object,embed,link,meta,base')
    .forEach((element) => element.remove());
  doc.querySelectorAll('form').forEach((form) => {
    const container = document.createElement('div');
    container.replaceChildren(...form.childNodes);
    form.replaceWith(container);
  });
  doc.querySelectorAll('a,area').forEach((element) => {
    element.removeAttribute('href');
    element.removeAttribute('ping');
  });
  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/iu.test(attribute.name) ||
        /^(?:srcdoc|formaction|ping|srcset)$/iu.test(attribute.name)
      )
        element.removeAttribute(attribute.name);
    }
  });
  const csp = nonce
    ? `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${template.innerHTML}${nonce ? previewRuntime(nonce) : ''}</body></html>`;
}

export function WebsitePreview({
  html,
  title,
  pages = [],
  thumbnail = false,
  appPreview,
}: {
  html: string;
  title: string;
  pages?: WebsitePage[];
  thumbnail?: boolean;
  appPreview?: { endpoint: string; revision: number };
}) {
  const [slug, setSlug] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const page = pages.find((item) => item.slug === slug);
  const compiledApp = useQuery({
    queryKey: [
      'app-preview-source',
      appPreview?.endpoint,
      appPreview?.revision,
    ],
    queryFn: ({ signal }) =>
      api<{ buildState: string | null; document: string | null }>(
        appPreview!.endpoint + '/source?revision=' + appPreview!.revision,
        { signal },
      ),
    enabled: Boolean(appPreview && !thumbnail),
    refetchInterval: (query) =>
      query.state.data?.buildState === 'queued' ||
      query.state.data?.buildState === 'building'
        ? 2_000
        : false,
  });

  useEffect(() => {
    if (!appPreview || thumbnail) return;
    const receive = async (event: MessageEvent<PreviewRequest>) => {
      const frameWindow = frame.current?.contentWindow;
      const request = event.data;
      if (
        event.source !== frameWindow ||
        request?.channel !== 'foundable-app-preview' ||
        request.nonce !== nonce ||
        !/^[1-9][0-9]{0,7}$/u.test(request.id) ||
        (request.operation.startsWith('storage-') ||
        request.operation.startsWith('jobs-') ||
        request.operation === 'function'
          ? request.collection !== 'records'
          : !/^[a-z][a-z0-9_-]{0,62}$/u.test(request.collection))
      )
        return;
      let ok = true;
      let value: unknown;
      let message: string | undefined;
      const collection = encodeURIComponent(request.collection);
      const recordsPath = appPreview.endpoint + '/records';
      try {
        if (request.operation === 'function') {
          if (
            !request.functionName ||
            !/^[a-z][a-z0-9-]{0,47}$/u.test(request.functionName)
          )
            throw new Error('Invalid server function.');
          value = await write(
            appPreview.endpoint +
              '/functions/' +
              request.functionName +
              '?revision=' +
              appPreview.revision,
            { input: request.input },
          );
        } else if (request.operation.startsWith('storage-')) {
          const storagePath =
            appPreview.endpoint + '/storage?revision=' + appPreview.revision;
          if (request.operation === 'storage-list') {
            value = await api(storagePath);
          } else if (request.operation === 'storage-put') {
            value = await write(storagePath, {
              name: request.name,
              mime: request.mime,
              data: request.data?.data,
            });
          } else {
            if (!request.fileId || !/^[0-9a-f-]{36}$/iu.test(request.fileId))
              throw new Error('Invalid preview file.');
            const itemPath =
              appPreview.endpoint +
              '/storage/' +
              request.fileId +
              '?revision=' +
              appPreview.revision;
            value =
              request.operation === 'storage-get'
                ? await api(itemPath)
                : await write(itemPath, {}, 'DELETE');
          }
        } else if (request.operation.startsWith('jobs-')) {
          const jobsPath =
            appPreview.endpoint + '/jobs?revision=' + appPreview.revision;
          if (request.operation === 'jobs-list') {
            value = await api(jobsPath);
          } else if (request.operation === 'jobs-schedule') {
            value = await write(jobsPath, request.data ?? {});
          } else {
            if (!request.jobId || !/^[0-9a-f-]{36}$/iu.test(request.jobId))
              throw new Error('Invalid preview job.');
            value = await write(
              jobsPath.replace(/\?.*$/u, '') +
                '/' +
                request.jobId +
                '?revision=' +
                appPreview.revision,
              {},
              'DELETE',
            );
          }
        } else if (request.operation === 'list') {
          value = await api<{ records: PreviewRecord[] }>(
            recordsPath +
              '?revision=' +
              appPreview.revision +
              '&collection=' +
              collection,
          );
        } else if (request.operation === 'create') {
          value = await write(
            recordsPath +
              '?revision=' +
              appPreview.revision +
              '&collection=' +
              collection,
            request.data ?? {},
          );
        } else {
          if (!request.recordId || !/^[0-9a-f-]{36}$/iu.test(request.recordId))
            throw new Error('Invalid preview record.');
          const itemPath = recordsPath + '/' + request.recordId;
          const query =
            '?revision=' + appPreview.revision + '&collection=' + collection;
          if (request.operation === 'update')
            value = await write(itemPath + query, request.data ?? {}, 'PUT');
          else if (request.operation === 'delete')
            value = await write(itemPath + query, {}, 'DELETE');
          else if (request.operation === 'action')
            value = await write(itemPath + '/actions' + query, {
              action: request.action ?? '',
            });
          else throw new Error('Unsupported preview operation.');
        }
      } catch (failure) {
        ok = false;
        message =
          failure instanceof Error
            ? failure.message
            : 'Preview request failed.';
      }
      frame.current?.contentWindow?.postMessage(
        {
          channel: 'foundable-app-preview',
          nonce,
          type: 'result',
          id: request.id,
          ok,
          value,
          message,
        },
        '*',
      );
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [appPreview, nonce, thumbnail]);

  const interactive = Boolean(appPreview && !thumbnail);
  return (
    <>
      {pages.length > 0 && (
        <label>
          Preview page{' '}
          <select
            value={page?.slug ?? ''}
            onChange={(event) => setSlug(event.currentTarget.value)}
          >
            <option value="">Homepage</option>
            {pages.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {interactive && (
        <p role="note">
          This draft uses isolated preview data. Published app records are not
          changed. Email sign-in is disabled in preview.
        </p>
      )}
      <iframe
        ref={frame}
        title={title}
        sandbox={interactive ? 'allow-scripts' : ''}
        loading={thumbnail ? 'lazy' : 'eager'}
        tabIndex={thumbnail ? -1 : undefined}
        aria-hidden={thumbnail || undefined}
        referrerPolicy="no-referrer"
        srcDoc={previewMarkup(
          compiledApp.data?.document ?? page?.html ?? html,
          interactive ? nonce : undefined,
          Boolean(compiledApp.data?.document),
        )}
      />
    </>
  );
}
