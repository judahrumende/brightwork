---
name: foundable-store-design
description: Plan or review a Foundable generated storefront, including use of the /unslop design pass and consistency across store pages.
---

Give the store a visual direction based on its products, customers and existing brand. Choose one distinctive product detail, a neutral surface palette, one accent and reusable components for navigation, product highlights and actions. Use a 4px spacing rhythm and keep keyboard focus visible. Give each section a clear primary action.

Use the worker's design rules in `apps/worker/src/design-skills.ts` as the runtime counterpart of this skill. Point the shop action to the managed catalog at `/store/catalog`. Catalog prices, stock and ordering come from the store backend. Use only supplied product and contact details in generated pages. Check the page at mobile and desktop widths, including navigation to the catalog.

The polish pass adapts [Unslop by Damir Sokolovsky](https://heydamir.design/unslop) under CC BY 4.0. The shared tokens and reusable components follow the approach documented in [Lovable design systems](https://docs.lovable.dev/features/design-systems.md).
