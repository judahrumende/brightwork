export type BuildStage = 'plan' | 'render' | 'source';

type BuiltInSkill = {
  applies: (context: { store: boolean; app: boolean }) => boolean;
  plan?: string[];
  render?: string[];
  source?: string[];
};

// Unslop principles adapted from Damir Sokolovsky, CC BY 4.0.
// These app-owned prompt programs are selected by the build pipeline.
const skills: BuiltInSkill[] = [
  {
    applies: () => true,
    plan: [
      'In the design brief, state the product and audience, then choose a character (two or three concrete traits), its natural world/material, one or two rich product moments, and one repeatable signature detail. Define named tokens for the palette, type scale, spacing, radii and surfaces, plus reusable navigation and action patterns, all grounded in those choices.',
      'Keep the same design language across routes. Make the product identity specific enough that replacing the name with another product would make the design feel wrong.',
    ],
    render: [
      'Use the shared design brief consistently. Define its color, type, spacing, radius and surface tokens as CSS custom properties and reuse them instead of scattering near-duplicate values. Align spacing to a 4px rhythm and use the Foundable brand tokens when supplied. Keep the chrome quiet and put color and detail into one or two real product moments. Never use gradient text, colored glows, blurred blobs, emoji icons, decorative badges, fake testimonials, generic metrics or stock AI marketing copy.',
      'Keep navigation and shared components consistent. Use one clear primary action per section, visible keyboard focus, readable contrast, useful loading, empty, success and failure states, and layouts that work on narrow screens.',
    ],
  },
  {
    applies: ({ store }) => store,
    plan: [
      'Plan a storefront around the supplied products, audience and brand. Make the product range, any supplied delivery expectations and the next step clear. Use Foundable’s managed catalog for product names, prices, variants, stock, cart and checkout; never invent product facts or embed prices, stock or payment forms in static page markup.',
      'Keep the public storefront and private merchant dashboard separate. A store build provisions the managed catalog and order backend automatically; do not imitate the dashboard or fabricate inventory inside public pages. The merchant adds real products after the store is created.',
    ],
    render: [
      'Link every shop or product action to /store/catalog. Keep product listings, prices, availability, variants, cart, checkout and order claims out of generated HTML because the managed storefront renders those from saved backend data. If the catalog has no products yet, make the path to the catalog clear without implying that products are already available.',
      'Use product-specific editorial structure: show the actual product context supplied in the request, explain useful distinctions, and keep delivery or returns claims out unless provided.',
    ],
  },
  {
    applies: ({ app }) => app,
    plan: [
      'Plan an interactive product around real user journeys and persistent entities. Name the data collections and relationships the workflows require. Use app mode when users need saved records or sign-in; describe permission boundaries for public, signed-in and admin actions.',
      'For each app collection, define lowercase field names, field types (text, number, boolean or date) and required fields. Mark identifiers such as account email, username, or slug unique when duplicates must be rejected. Use a type-matching defaultValue only for a genuine server-side default such as an initial status; defaults apply on create when omitted. Keep the schema aligned with the visible forms and user journeys.',
      'Set readAccess and writeAccess to public, authenticated or admin, plus ownerScoped. Prefer authenticated owner-scoped access; use public only when anonymous access is required, and admin for private management data. Add email sign-in wherever a workflow uses authenticated records. Never make an owner-scoped collection public.',
      'Keep the app owner dashboard separate from the customer-facing product. Foundable supplies managed records, email sign-in, user roles and collection access policies; do not present mock data or imply unconfigured integrations are live.',
    ],
    render: [
      'Use the Foundable app runtime for persisted data and email sign-in. Make each control perform the requested action through the managed record hooks; never claim a save, login, payment, invitation or integration succeeded unless the runtime confirms it.',
      'Build forms from the provisioned collection schema, use the correct input types, and show validation failures next to the affected form. Do not invent fields the backend does not define or pretend a default was saved before the server confirms it.',
      'For authenticated or admin-only collections, include the managed email sign-in controls and a useful signed-out state. Show admin-only controls only after the runtime reports an admin user; public anonymous flows must use collections explicitly configured for public access.',
      'Build clear loading, empty, success and failure states. Keep public, signed-in and admin actions visibly distinct, and do not expose another user’s private records or admin controls to regular users.',
    ],
    source: [
      'In the design brief, state the product and audience; carry its character, natural world or material, rich product moments, signature detail, palette, typography and spacing into the generated app source. Define the palette, type, spacing, radii and surfaces as reusable CSS custom properties in src/styles.css, then use those tokens throughout every component.',
      'Keep the source implementation consistent with the supplied design brief and existing app source. Use semantic React markup, accessible names and keyboard focus, responsive CSS, and explicit loading, empty, success and error states.',
      'For authenticated or admin-only collections, include the managed email sign-in controls and a useful signed-out state. Show admin-only controls only after the runtime reports an admin user; public anonymous flows must use collections explicitly configured for public access.',
      'For data interactions, render the Foundable app runtime attributes from the website build contract (data-foundable-records, data-foundable-record-list, data-foundable-field, data-foundable-create, data-foundable-auth). Do not call external services or invent an SDK. The platform mediates persisted records and sign-in.',
      'For private user files, use the platform window.foundableStorage runtime (list, put, get, remove) through a narrow TypeScript cast; files are private to the signed-in app user, limited to 1 MiB each, and must be saved only after a successful response.',
      'For delayed work, use (window as any).foundableJobs.schedule(collection, recordId, action, runAt) only for an existing configured collection action. Jobs run the same validated action later, can be listed or cancelled, and do not execute arbitrary server code.',
      'Use a named server function only when the workflow needs server-side validation that the declared collection actions cannot express. Use records.batch for up to 20 related create, update or delete operations that must succeed or fail together. Never imply external side effects or access to secrets.',
      'For server functions that read more than 20 records, use records.page(collection, limit, cursor). It returns { records, next }; pass next as cursor until it is null. Keep limits at 20 or less.',
      'Never include secrets, environment variables, payment credentials, fake records or fabricated claims of success in generated source.',
    ],
  },
];

export function builtInSkillInstructions(
  stage: BuildStage,
  context: { store: boolean; app: boolean },
) {
  return skills
    .filter((skill) => skill.applies(context))
    .flatMap((skill) => skill[stage] ?? []);
}
