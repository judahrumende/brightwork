export type BuildStage = 'plan' | 'render';

type BuiltInSkill = {
  applies: (context: { store: boolean }) => boolean;
  plan?: string[];
  render?: string[];
};

// These are app-owned prompt programs. They are selected by the build pipeline,
// not installed as user-facing Codex skills.
const skills: BuiltInSkill[] = [
  {
    applies: () => true,
    plan: [
      'Set a clear audience, product-specific visual direction, palette, type scale, spacing rhythm, surface treatment, navigation and reusable actions. Choose one memorable visual moment and one small signature detail.',
      'Keep the same design language across routes and make the hierarchy easy to scan. Let the requested brand and product category shape the choices.',
    ],
    render: [
      'Use the shared design brief consistently. Align spacing to a 4px rhythm, keep surfaces quiet and focus attention on one meaningful product detail, image or illustration. Avoid generic gradient hero sections, colored glows, decorative labels and stock marketing phrases.',
      'Keep navigation and shared components consistent. Use one clear primary action per section, visible keyboard focus, readable contrast, useful empty states and layouts that work on narrow screens.',
    ],
  },
  {
    applies: ({ store }) => store,
    plan: [
      'Plan a storefront that makes the product range, delivery expectations and next step clear. Use Foundable’s managed catalog for product names, prices, variants, stock, cart and checkout; never invent product facts or embed prices, stock or payment forms in static page markup.',
      'Keep the public storefront and private merchant dashboard separate. The store build provisions the managed catalog and order backend automatically; do not imitate the dashboard inside public pages.',
    ],
    render: [
      'Link every shop or product action to /store/catalog. Keep product prices, availability, variants, cart, checkout and order claims out of generated HTML because the managed storefront renders those from saved backend data.',
      'Use product-specific editorial structure: show the actual product context supplied in the request, explain useful distinctions, and keep delivery or returns claims out unless provided.',
    ],
  },
];

export function builtInSkillInstructions(
  stage: BuildStage,
  context: { store: boolean },
) {
  return skills
    .filter((skill) => skill.applies(context))
    .flatMap((skill) => skill[stage] ?? []);
}
