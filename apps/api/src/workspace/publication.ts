import type { BuyerAccess } from './store-buyer-routes';
import {
  registerStorefront,
  storePublicRoute,
  type StorePayments,
} from './storefront';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { websiteDocument, websitePageSlug } from '@brightwork/shared';
import type { agentStore } from './agent-store';
import {
  GeneratedAppRecordQuotaExceeded,
  GeneratedAppUniqueFieldError,
  generatedAppRecordsPageQuery,
  type generatedAppRecords,
} from './generated-app-records';
import { browserCookie, cookie, sessionLifetimeSeconds } from '../auth/tokens';
import type { generatedAppUsers } from './generated-app-users';
import {
  AppStorageBillingUnavailable,
  AppStorageCreditsRequired,
  type generatedAppStorage,
} from './generated-app-storage';
import type { generatedAppJobs } from './generated-app-jobs';
import { appJobInput } from './generated-app-jobs';
import { runGeneratedAppFunction } from './generated-app-functions';
import {
  generatedAppFunctionOperation,
  signGeneratedAppFunctionCapability,
  verifyGeneratedAppFunctionCapability,
} from './generated-app-function-capabilities';

const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/u,
  );
export function siteHosting(
  app: FastifyInstance,
  store: ReturnType<typeof agentStore>,
  origin: string,
  domain: string | undefined,
  limitOrder: (key: string) => Promise<void>,
  buyerAccess?: BuyerAccess,
  payments?: StorePayments,
  appRecords?: ReturnType<typeof generatedAppRecords>,
  appUsers?: ReturnType<typeof generatedAppUsers>,
  sendAppUserCode?: (
    email: string,
    code: string,
    application: string,
  ) => Promise<void>,
  appStorage?: ReturnType<typeof generatedAppStorage>,
  appJobs?: ReturnType<typeof generatedAppJobs>,
  runAppFunction: typeof runGeneratedAppFunction = runGeneratedAppFunction,
  functionCapabilitySecret?: string,
) {
  const parsed = hostSchema.safeParse(domain);
  if (!parsed.success) return null;
  const base = parsed.data;
  const scheme = new URL(origin).protocol;
  const baseUrl = new URL(scheme + '//' + base);
  const dashboard = new URL(origin).hostname;
  const onSiteDomain = (hostname: string) =>
    hostname === baseUrl.hostname || hostname.endsWith('.' + baseUrl.hostname);
  if (onSiteDomain(dashboard))
    throw new Error('Site hosting needs a distinct base domain');
  const url = (id: string) => scheme + '//' + id + '.' + base;
  const siteId = (hostname: string) => {
    const suffix = '.' + baseUrl.hostname;
    const lower = hostname.toLowerCase();
    if (!lower.endsWith(suffix)) return null;
    const parsed = z.uuid().safeParse(lower.slice(0, -suffix.length));
    return parsed.success ? parsed.data : null;
  };
  const secure = scheme === 'https:';
  const functionCapabilityUrl =
    scheme === 'https:'
      ? new URL('/__foundable/function-capabilities', origin).toString()
      : null;
  const visitCookie = secure ? '__Host-bw-visit' : 'bw-visit';
  const appUserCookie = secure ? '__Host-bw-app-user' : 'bw-app-user';
  const sameSiteOrigin = (request: FastifyRequest) => {
    try {
      return (
        request.headers.origin ===
        new URL(scheme + '//' + request.headers.host).origin
      );
    } catch {
      return false;
    }
  };
  const appRuntime = `(()=>{
    const endpoint='/__foundable/records';
    const queryFor=(root,cursor)=>{const query=new URLSearchParams({collection:root.dataset.foundableRecords||'records'});if(cursor){query.set('before',cursor.before);query.set('id',cursor.id)}return '?'+query.toString()};
    const request=async(path,options={})=>{const headers={...(options.headers||{})};if(options.body)headers['content-type']='application/json';const target=path.startsWith('/__foundable/')?path:endpoint+path;const response=await fetch(target,{...options,headers});if(response.status===204)return null;const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||'Could not save app data');return payload};
    const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node};
    const initializedRoots=new WeakSet();
    const recordFor=new WeakMap();
    const editorButton=root=>root.querySelector('button[data-foundable-create]');
    const clearEditor=root=>{delete root.dataset.foundableEditing;for(const field of root.querySelectorAll('[data-foundable-field]')){if(field.type==='checkbox')field.checked=false;else field.value=''}const save=editorButton(root);if(save){save.textContent=save.dataset.foundableLabel||save.textContent;delete save.dataset.foundableLabel}const status=root.querySelector('[data-foundable-status]');if(status)status.textContent='';root.querySelector('button[data-foundable-cancel]')?.remove()};
    const refresh=async(root,cursor)=>{const list=root.querySelector('[data-foundable-record-list]');if(!list)return;try{const result=await request(queryFor(root,cursor));if(!cursor)list.replaceChildren();root.querySelector('button[data-foundable-load-more]')?.remove();for(const record of result.records){const card=document.createElement('article');const fields=document.createElement('dl');for(const [key,value] of Object.entries(record.data)){fields.append(element('dt',key));fields.append(element('dd',typeof value==='string'?value:JSON.stringify(value)))}card.append(fields);for(const action of record.actions||[]){const run=element('button',action.label);run.type='button';run.dataset.foundableAction=action.name;run.dataset.recordId=record.id;card.append(run)}const edit=element('button','Edit');edit.type='button';edit.dataset.foundableEdit=record.id;recordFor.set(edit,record);card.append(edit);const remove=element('button','Delete');remove.type='button';remove.dataset.foundableDelete=record.id;card.append(remove);list.append(card)}if(result.next){const more=element('button','Load more');more.type='button';more.dataset.foundableLoadMore='';more.dataset.before=result.next.before;more.dataset.cursorId=result.next.id;list.after(more)}}catch(error){if(!cursor)list.replaceChildren();list.append(element('p',error.message))}};
    const initializeRoot=root=>{if(initializedRoots.has(root))return;initializedRoots.add(root);refresh(root)};
    document.addEventListener('click',async event=>{const button=event.target.closest('button[data-foundable-create],button[data-foundable-edit],button[data-foundable-delete],button[data-foundable-cancel],button[data-foundable-action],button[data-foundable-load-more]');if(!button)return;const root=button.closest('[data-foundable-records]');if(!root)return;try{if(button.dataset.foundableLoadMore!==undefined)return refresh(root,{before:button.dataset.before,id:button.dataset.cursorId});if(button.dataset.foundableAction){await request('/'+encodeURIComponent(button.dataset.recordId)+'/actions'+queryFor(root),{method:'POST',body:JSON.stringify({action:button.dataset.foundableAction})});return refresh(root)}if(button.dataset.foundableCancel){clearEditor(root);return}if(button.dataset.foundableEdit){const record=recordFor.get(button);if(!record)return;for(const field of root.querySelectorAll('[data-foundable-field]')){const value=record.data[field.name];if(field.type==='checkbox')field.checked=Boolean(value);else field.value=value==null?'':typeof value==='object'?JSON.stringify(value):String(value)}root.dataset.foundableEditing=record.id;const save=editorButton(root);if(save){save.dataset.foundableLabel||=save.textContent||'Save';save.textContent='Save changes'}if(!root.querySelector('button[data-foundable-cancel]')){const cancel=element('button','Cancel edit');cancel.type='button';cancel.dataset.foundableCancel='';root.append(cancel)}return}if(button.dataset.foundableDelete){await request('/'+encodeURIComponent(button.dataset.foundableDelete)+queryFor(root),{method:'DELETE'});return refresh(root)}const data={};for(const field of root.querySelectorAll('[data-foundable-field]')){if(!field.name)continue;data[field.name]=field.type==='checkbox'?field.checked:field.type==='number'&&field.value!==''?Number(field.value):field.value}const id=root.dataset.foundableEditing;await request((id?'/'+encodeURIComponent(id):'')+queryFor(root),{method:id?'PUT':'POST',body:JSON.stringify(data)});clearEditor(root);await refresh(root)}catch(error){let status=root.querySelector('[data-foundable-status]');if(!status){status=element('p','');status.dataset.foundableStatus='';root.append(status)}status.textContent=error.message}});
    const initializedAuthRoots=new WeakSet();
    const authRequest=async(path,body)=>{const response=await fetch('/__foundable/auth/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||'Sign-in is unavailable');return payload};
    const authStatus=(root,message)=>{let node=root.querySelector('[data-foundable-auth-status]');if(!node){node=element('p','');node.dataset.foundableAuthStatus='';root.append(node)}node.textContent=message};
    const inviteChallenge=new URLSearchParams(location.search).get('challenge');
    const initializeAuth=root=>{if(initializedAuthRoots.has(root))return;initializedAuthRoots.add(root);if(inviteChallenge&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inviteChallenge)){root.dataset.foundableChallenge=inviteChallenge;authStatus(root,'Enter the email sign-in code to accept your invitation.')}authRequest('me').then(({user})=>{window.foundableAppUser=user||null;root.dispatchEvent(new CustomEvent('foundable:auth',{detail:{user:user||null}}))}).catch(()=>{});};
    const scan=node=>{if(!(node instanceof Element))return;if(node.matches('[data-foundable-records]'))initializeRoot(node);for(const root of node.querySelectorAll('[data-foundable-records]'))initializeRoot(root);if(node.matches('[data-foundable-auth]'))initializeAuth(node);for(const root of node.querySelectorAll('[data-foundable-auth]'))initializeAuth(root)};
    scan(document.documentElement);
    new MutationObserver(changes=>{for(const change of changes)for(const node of change.addedNodes)scan(node)}).observe(document.documentElement,{childList:true,subtree:true});
    document.addEventListener('click',async event=>{const button=event.target.closest('button[data-foundable-auth-submit]');if(!button)return;const root=button.closest('[data-foundable-auth]');if(!root)return;const email=root.querySelector('[data-foundable-email]');const code=root.querySelector('[data-foundable-code]');try{if(code?.value){const {user}=await authRequest('verify',{challenge:root.dataset.foundableChallenge,code:code.value});window.foundableAppUser=user;authStatus(root,'Signed in as '+user.email);root.dispatchEvent(new CustomEvent('foundable:auth',{detail:{user}}))}else{const {challenge}=await authRequest('challenge',{email:email?.value||''});root.dataset.foundableChallenge=challenge;authStatus(root,'Check your email for a sign-in code.')}}catch(error){authStatus(root,error.message)}});
    document.addEventListener('click',async event=>{const button=event.target.closest('button[data-foundable-sign-out]');if(!button)return;const root=button.closest('[data-foundable-auth]');try{await authRequest('sign-out',{});window.foundableAppUser=null;authStatus(root,'Signed out');root?.dispatchEvent(new CustomEvent('foundable:auth',{detail:{user:null}}))}catch(error){if(root)authStatus(root,error.message)}});
    window.foundableStorage={list:async()=>request('/__foundable/storage'),put:async(name,mime,data)=>request('/__foundable/storage',{method:'POST',body:JSON.stringify({name,mime,data})}),get:async id=>request('/__foundable/storage/'+encodeURIComponent(id)),remove:async id=>request('/__foundable/storage/'+encodeURIComponent(id),{method:'DELETE'})};
    window.foundableJobs={list:async()=>request('/__foundable/jobs'),schedule:async(collection,recordId,action,runAt)=>request('/__foundable/jobs',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),collection,recordId,action,runAt})}),cancel:async id=>request('/__foundable/jobs/'+encodeURIComponent(id),{method:'DELETE'})};
    window.foundableFunctions={invoke:async(name,input={})=>{if(typeof name!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(name))throw new Error('Invalid server function name');const result=await request('/__foundable/functions/'+encodeURIComponent(name),{method:'POST',body:JSON.stringify({input})});return result.result}};
  })();`;

  app.addHook('onRequest', async (request, reply) => {
    if (!onSiteDomain(request.hostname.toLowerCase().replace(/\.$/u, '')))
      return;
    const route = request.routeOptions.url;
    if (storePublicRoute(request.method, route ?? '')) return;
    if (
      route === '/_foundable/runtime.js' &&
      ['GET', 'HEAD'].includes(request.method)
    )
      return;
    if (
      (route === '/__foundable/records' ||
        route === '/__foundable/records/:recordId' ||
        route === '/__foundable/records/:recordId/actions') &&
      ['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)
    )
      return;
    if (
      (route === '/__foundable/storage' ||
        route === '/__foundable/storage/:fileId') &&
      ['GET', 'POST', 'DELETE'].includes(request.method)
    )
      return;
    if (
      route === '/__foundable/functions/:functionName' &&
      request.method === 'POST'
    )
      return;
    if (
      (route === '/__foundable/jobs' || route === '/__foundable/jobs/:jobId') &&
      ['GET', 'POST', 'DELETE'].includes(request.method)
    )
      return;
    if (
      route?.startsWith('/__foundable/auth/') &&
      ['GET', 'POST'].includes(request.method)
    )
      return;
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      (route !== '/' && route !== '/:page')
    )
      return reply.code(404).send('Site route not found');
  });

  async function serveSite(
    request: FastifyRequest,
    reply: FastifyReply,
    slug: string,
  ) {
    const id = siteId(request.hostname);
    if (!id) return reply.code(404).send('Site not found');
    const page = await store.published(id);
    if (!page) return reply.code(404).send('Site not found');
    const document =
      page.runtimeMode === 'app' && page.sourceDocument
        ? page.pages?.some((item) => item.slug === slug) || !slug
          ? page.sourceDocument
          : null
        : websiteDocument(page.document, page.pages ?? [], slug);
    if (document === null) return reply.code(404).send('Page not found');
    const runtimeNonce = randomUUID();
    const hostedDocument =
      page.runtimeMode === 'app'
        ? document
            .replace(
              '<script type="module">',
              `<script type="module" nonce="${runtimeNonce}">`,
            )
            .replace(
              /<\/body>/iu,
              '<script src="/_foundable/runtime.js" defer></script></body>',
            )
        : document;
    if (request.method === 'GET') {
      const current = z
        .uuid()
        .safeParse(browserCookie(request.headers.cookie, visitCookie));
      const session = current.success ? current.data : randomUUID();
      const referrer = request.headers.referer;
      const referringUrl =
        !current.success &&
        referrer &&
        referrer.length <= 2048 &&
        URL.canParse(referrer)
          ? new URL(referrer)
          : null;
      const source =
        referringUrl &&
        ['https:', 'http:'].includes(referringUrl.protocol) &&
        referringUrl.hostname.length <= 253 &&
        !onSiteDomain(referringUrl.hostname)
          ? referringUrl.hostname
          : null;
      reply.header('Set-Cookie', cookie(visitCookie, session, secure, 30 * 60));
      await store
        .visit(id, session, '/' + slug, source)
        .catch(() => app.log.warn('Could not count a website view'));
    }
    return reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        page.runtimeMode === 'app'
          ? `sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'self' 'nonce-${runtimeNonce}'; connect-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
          : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .send(hostedDocument);
  }
  app.get('/', (request, reply) => serveSite(request, reply, ''));
  app.get('/:page', (request, reply) => {
    const slug = z.object({ page: websitePageSlug }).safeParse(request.params);
    if (!slug.success) return reply.code(404).send('Page not found');
    return serveSite(request, reply, slug.data.page);
  });
  app.get('/_foundable/runtime.js', async (request, reply) => {
    const id = siteId(request.hostname);
    const page = id ? await store.published(id) : null;
    if (!page || page.runtimeMode !== 'app') return reply.code(404).send();
    return reply
      .type('text/javascript; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(appRuntime);
  });
  app.get('/__foundable/records', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appRecords) return reply.code(404).send();
    const {
      collection,
      before,
      id: cursorId,
    } = generatedAppRecordsPageQuery.parse(request.query);
    const user = await appUsers?.user(id, appUserToken(request));
    const records = await appRecords.publicList(
      id,
      collection,
      user ?? undefined,
      undefined,
      101,
      before && cursorId ? { updatedAt: before, id: cursorId } : undefined,
      true,
    );
    if (!records) return reply.code(user ? 403 : 401).send();
    const pageRows = records.slice(0, 100);
    const last = pageRows.at(-1);
    const page = pageRows.map(
      ({ cursorUpdatedAt: _cursor, ...record }) => record,
    );
    return {
      records: page,
      next:
        records.length > 100 && last
          ? {
              before: last.cursorUpdatedAt,
              id: last.id,
            }
          : null,
    };
  });
  app.post('/__foundable/records', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appRecords || !sameSiteOrigin(request))
      return reply.code(404).send();
    await limitOrder('app-record:' + id + ':' + request.ip);
    const { collection } = z
      .object({ collection: z.string().optional() })
      .parse(request.query);
    const user = await appUsers?.user(id, appUserToken(request));
    let record;
    try {
      record = await appRecords.publicUpsert(
        id,
        undefined,
        request.body,
        collection,
        user ?? undefined,
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        return reply
          .code(400)
          .send({ message: 'Record does not match the collection schema.' });
      if (error instanceof GeneratedAppRecordQuotaExceeded)
        return reply.code(429).send({ message: error.message });
      throw error;
    }
    if (!record) return reply.code(404).send();
    return reply.code(201).send({ record });
  });
  app.put('/__foundable/records/:recordId', async (request, reply) => {
    const id = siteId(request.hostname);
    const { recordId } = z.object({ recordId: z.uuid() }).parse(request.params);
    if (!id || !appRecords || !sameSiteOrigin(request))
      return reply.code(404).send();
    await limitOrder('app-record:' + id + ':' + request.ip);
    const { collection } = z
      .object({ collection: z.string().optional() })
      .parse(request.query);
    const user = await appUsers?.user(id, appUserToken(request));
    let record;
    try {
      record = await appRecords.publicUpsert(
        id,
        recordId,
        request.body,
        collection,
        user ?? undefined,
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        return reply
          .code(400)
          .send({ message: 'Record does not match the collection schema.' });
      if (error instanceof GeneratedAppRecordQuotaExceeded)
        return reply.code(429).send({ message: error.message });
      throw error;
    }
    if (!record) return reply.code(404).send();
    return { record };
  });
  app.post('/__foundable/records/:recordId/actions', async (request, reply) => {
    const id = siteId(request.hostname);
    const { recordId } = z.object({ recordId: z.uuid() }).parse(request.params);
    if (!id || !appRecords || !sameSiteOrigin(request))
      return reply.code(404).send();
    await limitOrder('app-action:' + id + ':' + request.ip);
    const { collection } = z
      .object({ collection: z.string().optional() })
      .parse(request.query);
    const { action } = z
      .object({ action: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u) })
      .parse(request.body);
    const user = await appUsers?.user(id, appUserToken(request));
    try {
      const record = await appRecords.publicAction(
        id,
        recordId,
        action,
        collection,
        user ?? undefined,
      );
      if (!record) return reply.code(404).send();
      return { record };
    } catch (error) {
      if (error instanceof z.ZodError)
        return reply.code(400).send({
          message: 'Action result does not match the collection schema.',
        });
      throw error;
    }
  });
  app.delete('/__foundable/records/:recordId', async (request, reply) => {
    const id = siteId(request.hostname);
    const { recordId } = z.object({ recordId: z.uuid() }).parse(request.params);
    if (!id || !appRecords || !sameSiteOrigin(request))
      return reply.code(404).send();
    await limitOrder('app-record:' + id + ':' + request.ip);
    const { collection } = z
      .object({ collection: z.string().optional() })
      .parse(request.query);
    const user = await appUsers?.user(id, appUserToken(request));
    if (
      !(await appRecords.publicRemove(
        id,
        recordId,
        collection,
        user ?? undefined,
      ))
    )
      return reply.code(404).send();
    return reply.code(204).send();
  });
  app.get('/__foundable/storage', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appStorage || !appUsers) return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send();
    return { files: await appStorage.list(id, user) };
  });
  app.post(
    '/__foundable/storage',
    { bodyLimit: 1_500_000 },
    async (request, reply) => {
      const id = siteId(request.hostname);
      if (!id || !appStorage || !appUsers || !sameSiteOrigin(request))
        return reply.code(404).send();
      const page = await store.published(id);
      if (page?.runtimeMode !== 'app') return reply.code(404).send();
      const user = await appUsers.user(id, appUserToken(request));
      if (!user) return reply.code(401).send();
      await limitOrder('app-storage:' + id + ':' + request.ip);
      try {
        const file = await appStorage.put(id, user, request.body);
        if (!file)
          return reply
            .code(413)
            .send({ message: 'App storage quota reached.' });
        return reply.code(201).send({ file });
      } catch (error) {
        if (error instanceof AppStorageBillingUnavailable)
          return reply.code(503).send({ message: error.message });
        if (error instanceof AppStorageCreditsRequired)
          return reply.code(402).send({ message: error.message });
        if (error instanceof z.ZodError)
          return reply
            .code(400)
            .send({ message: 'Check the file name, type, and base64 data.' });
        throw error;
      }
    },
  );
  app.get('/__foundable/storage/:fileId', async (request, reply) => {
    const id = siteId(request.hostname);
    const { fileId } = z.object({ fileId: z.uuid() }).parse(request.params);
    if (!id || !appStorage || !appUsers) return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send();
    const file = await appStorage.read(id, fileId, user);
    if (!file) return reply.code(404).send();
    return { file };
  });
  app.delete('/__foundable/storage/:fileId', async (request, reply) => {
    const id = siteId(request.hostname);
    const { fileId } = z.object({ fileId: z.uuid() }).parse(request.params);
    if (!id || !appStorage || !appUsers || !sameSiteOrigin(request))
      return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send();
    if (!(await appStorage.remove(id, fileId, user)))
      return reply.code(404).send();
    return reply.code(204).send();
  });
  app.get('/__foundable/jobs', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appJobs || !appUsers) return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send();
    return { jobs: await appJobs.listForUser(id, user) };
  });
  app.post(
    '/__foundable/jobs',
    { bodyLimit: 16_000 },
    async (request, reply) => {
      const id = siteId(request.hostname);
      if (
        !id ||
        !appJobs ||
        !appUsers ||
        !appRecords ||
        !sameSiteOrigin(request)
      )
        return reply.code(404).send();
      const page = await store.published(id);
      if (page?.runtimeMode !== 'app') return reply.code(404).send();
      const user = await appUsers.user(id, appUserToken(request));
      if (!user) return reply.code(401).send();
      const parsed = appJobInput.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ message: 'Check the workflow and scheduled time.' });
      await limitOrder('app-job:' + id + ':' + request.ip);
      if (
        !(await appRecords.canPublicAction(
          id,
          parsed.data.recordId,
          parsed.data.action,
          parsed.data.collection,
          user,
        ))
      )
        return reply
          .code(409)
          .send({ message: 'This workflow action is unavailable.' });
      try {
        const job = await appJobs.enqueue(null, id, user, parsed.data);
        if (!job)
          return reply
            .code(409)
            .send({ message: 'The job limit was reached or the app changed.' });
        return reply.code(202).send({ job });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Schedule jobs'))
          return reply.code(400).send({ message: error.message });
        throw error;
      }
    },
  );
  app.delete('/__foundable/jobs/:jobId', async (request, reply) => {
    const id = siteId(request.hostname);
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.params);
    if (!id || !appJobs || !appUsers || !sameSiteOrigin(request))
      return reply.code(404).send();
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send();
    if (!(await appJobs.cancelForUser(id, jobId, user)))
      return reply.code(404).send();
    return reply.code(204).send();
  });
  app.post(
    '/__foundable/function-capabilities',
    { bodyLimit: 16_000 },
    async (request, reply) => {
      if (!functionCapabilitySecret || !appRecords)
        return reply
          .code(503)
          .send({ message: 'Record capabilities are not configured.' });
      reply.header('Cache-Control', 'no-store');
      const authorization = request.headers.authorization;
      const token = authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/u)?.[1];
      if (!token)
        return reply
          .code(401)
          .send({ message: 'Function capability is missing.' });
      const capability = await verifyGeneratedAppFunctionCapability(
        functionCapabilitySecret,
        token,
      );
      if (!capability)
        return reply
          .code(401)
          .send({ message: 'Function capability expired or invalid.' });
      const operation = generatedAppFunctionOperation.safeParse(request.body);
      if (!operation.success)
        return reply
          .code(400)
          .send({ message: 'Check the requested app data operation.' });
      await limitOrder(
        'app-function-capability:' +
          capability.siteId +
          ':' +
          capability.jti +
          ':' +
          request.ip,
      );
      let user = capability.user ?? undefined;
      if (capability.environment === 'live' && capability.user) {
        const currentUser = await appUsers?.byEmail(
          capability.siteId,
          capability.user.email,
        );
        if (!currentUser || currentUser.id !== capability.user.id)
          return reply
            .code(401)
            .send({ message: 'The app user is no longer active.' });
        user = currentUser;
      }
      const scope = {
        businessId: capability.businessId,
        revision: capability.revision,
        environment: capability.environment,
      } as const;
      if (
        operation.data.operation !== 'list' &&
        operation.data.operation !== 'page' &&
        !(await appRecords.claimFunctionMutation(
          capability.siteId,
          capability.jti,
        ))
      )
        return reply.code(409).send({
          message:
            'A server function can make one record change request per invocation. Use records.batch for related create, update, or delete operations.',
        });
      let result: unknown;
      try {
        switch (operation.data.operation) {
          case 'list':
            result = await appRecords.publicList(
              capability.siteId,
              operation.data.collection,
              user,
              scope,
              operation.data.limit,
            );
            break;
          case 'page': {
            const rows = await appRecords.publicList(
              capability.siteId,
              operation.data.collection,
              user,
              scope,
              operation.data.limit + 1,
              operation.data.cursor
                ? {
                    updatedAt: operation.data.cursor.before,
                    id: operation.data.cursor.id,
                  }
                : undefined,
              true,
            );
            if (!rows) result = null;
            else {
              const pageRows = rows.slice(0, operation.data.limit);
              const last = pageRows.at(-1);
              const records = pageRows.map(
                ({ cursorUpdatedAt: _cursor, ...record }) => record,
              );
              result = {
                records,
                next:
                  rows.length > operation.data.limit && last
                    ? {
                        before: last.cursorUpdatedAt,
                        id: last.id,
                      }
                    : null,
              };
            }
            break;
          }
          case 'create':
            result = await appRecords.publicUpsert(
              capability.siteId,
              undefined,
              operation.data.data,
              operation.data.collection,
              user,
              scope,
            );
            break;
          case 'update':
            result = await appRecords.publicUpsert(
              capability.siteId,
              operation.data.recordId,
              operation.data.data,
              operation.data.collection,
              user,
              scope,
            );
            break;
          case 'delete':
            result = await appRecords.publicRemove(
              capability.siteId,
              operation.data.recordId,
              operation.data.collection,
              user,
              scope,
            );
            break;
          case 'action':
            result = await appRecords.publicAction(
              capability.siteId,
              operation.data.recordId,
              operation.data.action,
              operation.data.collection,
              user,
              scope,
            );
            break;
          case 'batch':
            result = await appRecords.publicBatch(
              capability.siteId,
              operation.data.operations,
              user,
              scope,
            );
            break;
        }
      } catch (error) {
        if (error instanceof GeneratedAppUniqueFieldError)
          return reply.code(409).send({ message: error.message });
        if (error instanceof GeneratedAppRecordQuotaExceeded)
          return reply.code(429).send({ message: error.message });
        throw error;
      }
      if (result === null)
        return reply
          .code(403)
          .send({ message: 'The app user cannot access this collection.' });
      const payload = { result };
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 64 * 1024)
        return reply
          .code(413)
          .send({ message: 'The app data response exceeds 64 KiB.' });
      return payload;
    },
  );
  app.post(
    '/__foundable/functions/:functionName',
    { bodyLimit: 16_000 },
    async (request, reply) => {
      const id = siteId(request.hostname);
      const params = z
        .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/u) })
        .safeParse({
          name: (request.params as { functionName?: unknown })?.functionName,
        });
      const body = z
        .object({ input: z.unknown().optional() })
        .safeParse(request.body);
      if (!id || !params.success || !body.success || !sameSiteOrigin(request))
        return reply.code(404).send();
      const page = await store.published(id);
      if (
        page?.runtimeMode !== 'app' ||
        page.sourceBuildState !== 'passed' ||
        !Array.isArray(page.sourceFiles)
      )
        return reply.code(404).send();
      const functionFile = page.sourceFiles.find(
        (file) => file.path === `src/functions/${params.data.name}.mjs`,
      );
      if (!functionFile) return reply.code(404).send();
      await limitOrder('app-function:' + id + ':' + request.ip);
      const appUser = appUsers
        ? await appUsers.user(id, appUserToken(request))
        : null;
      try {
        const capability =
          functionCapabilitySecret && functionCapabilityUrl
            ? {
                url: functionCapabilityUrl,
                token: await signGeneratedAppFunctionCapability(
                  functionCapabilitySecret,
                  {
                    businessId: page.businessId,
                    siteId: id,
                    revision: page.revision,
                    environment: 'live',
                    user: appUser,
                  },
                ),
              }
            : undefined;
        const result = await runAppFunction(
          functionFile.content,
          {
            input: body.data.input ?? null,
            user: appUser,
          },
          undefined,
          capability,
        );
        return { result };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Generated server functions are not configured.'
        )
          return reply.code(503).send({ message: error.message });
        return reply.code(502).send({ message: 'The server function failed.' });
      }
    },
  );
  const appUserToken = (request: FastifyRequest) =>
    browserCookie(request.headers.cookie, appUserCookie);
  app.post('/__foundable/auth/challenge', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appUsers || !sameSiteOrigin(request))
      return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    if (!sendAppUserCode)
      return reply
        .code(503)
        .send({ message: 'Email sign-in is not configured.' });
    await limitOrder('app-auth:' + id + ':' + request.ip);
    const { email } = z
      .object({ email: z.email().trim().max(254) })
      .parse(request.body);
    const challenge = await appUsers.challenge(id, email);
    try {
      await sendAppUserCode(email, challenge.code, url(id));
    } catch (error) {
      await appUsers.discardChallenge(id, challenge.id);
      throw error;
    }
    return { challenge: challenge.id };
  });
  app.post('/__foundable/auth/verify', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appUsers || !sameSiteOrigin(request))
      return reply.code(404).send();
    await limitOrder('app-auth-verify:' + id + ':' + request.ip);
    const { challenge, code } = z
      .object({ challenge: z.uuid(), code: z.string().regex(/^\d{6}$/u) })
      .parse(request.body);
    const token = await appUsers.verify(
      id,
      challenge,
      code,
      appUserToken(request),
    );
    if (!token)
      return reply
        .code(422)
        .send({ message: 'The code is invalid or expired.' });
    const user = await appUsers.user(id, token);
    reply.header(
      'Set-Cookie',
      cookie(appUserCookie, token, secure, sessionLifetimeSeconds),
    );
    reply.header('Cache-Control', 'no-store');
    return { user };
  });
  app.get('/__foundable/auth/me', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appUsers) return reply.code(404).send();
    const page = await store.published(id);
    if (page?.runtimeMode !== 'app') return reply.code(404).send();
    reply.header('Cache-Control', 'no-store');
    const user = await appUsers.user(id, appUserToken(request));
    if (!user) return reply.code(401).send({ user: null });
    return { user };
  });
  app.post('/__foundable/auth/sign-out', async (request, reply) => {
    const id = siteId(request.hostname);
    if (!id || !appUsers || !sameSiteOrigin(request))
      return reply.code(404).send();
    await appUsers.signOut(id, appUserToken(request));
    reply.header('Set-Cookie', cookie(appUserCookie, '', secure, 0));
    reply.header('Cache-Control', 'no-store');
    return { signedOut: true };
  });
  registerStorefront(
    app,
    store.generatedStore,
    siteId,
    url,
    limitOrder,
    buyerAccess,
    payments,
  );
  return { url };
}
