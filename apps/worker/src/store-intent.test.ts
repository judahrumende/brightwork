import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestsStore } from './store-intent';

test('store intent catches common ecommerce requests', () => {
  for (const prompt of [
    'Build an online store for handmade ceramics.',
    'Create a shop for my art prints.',
    'I want to sell handmade pottery on my website.',
    'Set up a shopping cart for my products.',
  ]) {
    assert.equal(requestsStore(prompt), true, prompt);
  }
});

test('store intent does not mistake storage or a product landing page for ecommerce', () => {
  for (const prompt of [
    'Store my photos in a private album.',
    'Make a product landing page with an email signup.',
    'Create a booking portal with checkout for appointments.',
  ]) {
    assert.equal(requestsStore(prompt), false, prompt);
  }
});
