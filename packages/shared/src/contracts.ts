import type { z } from 'zod';
import type { observedContracts } from './api-contracts.gen';

export { observedContracts, referencedPaths } from './api-contracts.gen';

type ObservedContracts = typeof observedContracts;
export type ContractKey = keyof ObservedContracts;
export type ContractRequest<Key extends ContractKey> = z.input<
  ObservedContracts[Key]['request']
>;
export type ContractResponse<Key extends ContractKey> = z.output<
  ObservedContracts[Key]['response']
>;
