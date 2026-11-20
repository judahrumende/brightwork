export function requestsStore(requirements: string) {
  return /\b(?:online\s+(?:store|shop)|e-?commerce|storefront|shopping\s+cart|shop(?:ping)?\s+(?:site|website|store)|(?:build|make|create|launch|open)\s+(?:me\s+)?(?:an?\s+)?(?:online\s+)?(?:store|shop)|sell(?:ing)?\b.{0,80}\b(?:products?|items?|goods?|merchandise?|online|(?:(?:on|through|via|from)\s+(?:my|the)\s+)?(?:website|site|store|shop))|products?\s+(?:store|shop))\b/iu.test(
    requirements,
  );
}

export function requestsApp(requirements: string) {
  return /\b(?:web\s*app|web\s*application|saas|dashboard|(?:customer\s+)?portal|booking\s+(?:system|portal)|crm|tracker|interactive\s+app|(?:build|create|make|launch)\s+(?:me\s+)?(?:an?\s+)?(?:web\s+)?app)\b/iu.test(
    requirements,
  );
}
