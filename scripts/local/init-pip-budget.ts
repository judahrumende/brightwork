import {
  initializePipBudget,
  setPipBudgetCap,
} from '../../apps/api/src/pip-budget';

const key = process.env.BRIGHTWORK_OPENROUTER_KEY ?? '';
const cap = process.env.BRIGHTWORK_PIP_NEW_CAP_USD;
const operation =
  cap !== undefined
    ? setPipBudgetCap(key, Number(cap))
    : initializePipBudget(key);

void operation
  .then(() => {
    console.log(
      cap
        ? 'Brightwork updated the weekly cap. No inference was sent.'
        : 'Brightwork enrolled the weekly budget. No inference was sent.',
    );
  })
  .catch(() => {
    console.error(
      'Brightwork could not change the weekly budget. Check the dedicated key and preserve any existing ledger.',
    );
    process.exitCode = 1;
  });
