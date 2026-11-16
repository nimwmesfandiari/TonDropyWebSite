import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, formatAmount, priceToE8, applySpread, computeQuote, mulE8, MAX_MINOR,
} from '../src/lib/money.js';

test('parseAmount handles decimals per asset scale', () => {
  assert.equal(parseAmount('1', 'TON'), 1_000_000_000);
  assert.equal(parseAmount('0.000000001', 'TON'), 1);
  assert.equal(parseAmount('12.5', 'USDT'), 12_500_000);
  assert.equal(parseAmount('150000', 'IRT'), 150000);
});

test('parseAmount rejects bad input', () => {
  assert.throws(() => parseAmount('1.0000000001', 'TON'), /decimals/);
  assert.throws(() => parseAmount('1.5', 'IRT'), /decimals/);
  assert.throws(() => parseAmount('-1', 'TON'));
  assert.throws(() => parseAmount('1e9', 'TON'));
  assert.throws(() => parseAmount('abc', 'USDT'));
  assert.throws(() => parseAmount('99999999999', 'TON'), /range/);
});

test('formatAmount round-trips', () => {
  assert.equal(formatAmount(1_500_000_000, 'TON'), '1.5');
  assert.equal(formatAmount(1_000_000_000, 'TON'), '1');
  assert.equal(formatAmount(1, 'TON'), '0.000000001');
  assert.equal(formatAmount(250000, 'IRT'), '250000');
  assert.equal(formatAmount(parseAmount('3.141592', 'USDT'), 'USDT'), '3.141592');
});

test('buy quote rounds up and adds fee; sell rounds down and subtracts fee', () => {
  // 1 TON at 3.2 USDT, fee 0.5%
  const priceE8 = priceToE8('3.2');
  const buy = computeQuote({
    side: 'buy', baseAmount: parseAmount('1', 'TON'), priceE8,
    baseAsset: 'TON', quoteAsset: 'USDT', feeBps: 50,
  });
  assert.equal(buy.quoteAmount, 3_200_000);
  assert.equal(buy.fee, 16_000);
  assert.equal(buy.total, 3_216_000);

  const sell = computeQuote({
    side: 'sell', baseAmount: parseAmount('1', 'TON'), priceE8,
    baseAsset: 'TON', quoteAsset: 'USDT', feeBps: 50,
  });
  assert.equal(sell.total, 3_200_000 - 16_000);
});

test('rounding always favours the house', () => {
  const priceE8 = priceToE8('0.333333333');
  const base = 1; // 1 nanoTON
  const buy = computeQuote({
    side: 'buy', baseAmount: base, priceE8, baseAsset: 'TON', quoteAsset: 'USDT', feeBps: 0,
  });
  assert.ok(buy.quoteAmount >= 1); // rounded up, never 0
  assert.throws(() => computeQuote({
    side: 'sell', baseAmount: base, priceE8, baseAsset: 'TON', quoteAsset: 'USDT', feeBps: 0,
  }), /too small/i);
});

test('spread widens buy and narrows sell', () => {
  const mid = priceToE8('100');
  assert.equal(applySpread(mid, 'buy', 30), priceToE8('100.3'));
  assert.equal(applySpread(mid, 'sell', 30), priceToE8('99.7'));
});

test('cross rate TON/IRT from TON/USDT and USDT/IRT', () => {
  const tonUsdt = priceToE8('3.2');
  const usdtIrt = priceToE8('60000');
  assert.equal(mulE8(tonUsdt, usdtIrt), priceToE8('192000'));
});

test('IRT pair math has no decimals', () => {
  const q = computeQuote({
    side: 'buy', baseAmount: parseAmount('2.5', 'TON'), priceE8: priceToE8('192000'),
    baseAsset: 'TON', quoteAsset: 'IRT', feeBps: 50,
  });
  assert.equal(q.quoteAmount, 480000);
  assert.equal(q.fee, 2400);
  assert.ok(Number.isSafeInteger(q.total));
});

test('amounts never exceed the safe range', () => {
  assert.ok(MAX_MINOR < Number.MAX_SAFE_INTEGER);
  assert.throws(() => computeQuote({
    side: 'buy', baseAmount: MAX_MINOR, priceE8: priceToE8('10000000000'),
    baseAsset: 'TON', quoteAsset: 'IRT', feeBps: 50,
  }), /range/);
});
