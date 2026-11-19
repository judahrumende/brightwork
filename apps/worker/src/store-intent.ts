export function requestsStore(requirements: string) {
  return /\b(?:online\s+(?:store|shop)|e-?commerce|storefront|shop(?:ping)?\s+(?:site|website|store)|(?:build|make|create|launch|open)\s+(?:me\s+)?(?:an?\s+)?(?:online\s+)?(?:store|shop)|sell\b.{0,60}\b(?:products?|items?|online)|products?\s+(?:store|shop))\b/iu.test(
    requirements,
  );
}
