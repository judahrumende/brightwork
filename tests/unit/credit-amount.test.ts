import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  creditDecimal,
  creditUnits,
} from '../../apps/api/src/workspace/credit-amount.ts';

test('sums credits and deductions exactly to ten decimal places', () => {
  assert.equal(
    creditDecimal(
      creditUnits('10') -
        creditUnits('0.1111111111') -
        creditUnits('0.0000000001'),
    ),
    '9.8888888888',
  );
  assert.equal(creditDecimal(-creditUnits('0.01')), '-0.0100000000');
  assert.equal(
    creditDecimal(creditUnits('90071992547409.0000000001') + 1n),
    '90071992547409.0000000002',
  );
});

test('rejects excess precision, exponent notation, and malformed amounts', () => {
  for (const value of [
    '0.00000000001',
    '1e-5',
    '',
    '1.',
    'Infinity',
    '10 credits',
  ]) {
    assert.throws(() => creditUnits(value), RangeError);
  }
});
