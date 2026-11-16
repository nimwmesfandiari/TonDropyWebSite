import { ok, readJson, nowSec, pageParams } from '../lib/http.js';
import { HttpError, badRequest, notFound, conflict } from '../lib/errors.js';
import { str, oneOf } from '../lib/validate.js';
import { requireKyc } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { randomId } from '../lib/crypto.js';
import { move, notify, constraintReason, HOUSE_ID } from '../lib/ledger.js';
import { loadRates, tradePriceE8 } from '../lib/pricing.js';
import {
  PAIRS, MoneyError, parseAmount, formatAmount, formatPriceE8, computeQuote, wholeToMinor,
} from '../lib/money.js';
import { TRADE_LIMITS, envInt } from '../config.js';
import { sendMessage } from '../services/telegram.js';

function moneyToHttp(err) {
  if (err instanceof MoneyError) return badRequest(err.code, err.message);
  return err;
}

function quoteView(q) {
  const buy = q.side === 'buy';
  return {
    id: q.id,
    pair: q.pair,
    side: q.side,
    baseAsset: q.base_asset,
    quoteAsset: q.quote_asset,
    baseAmount: formatAmount(q.base_amount, q.base_asset),
    quoteAmount: formatAmount(q.quote_amount, q.quote_asset),
    fee: formatAmount(q.fee, q.quote_asset),
    // What leaves / enters the user's wallet in the quote asset.
    total: formatAmount(buy ? q.quote_amount + q.fee : q.quote_amount - q.fee, q.quote_asset),
    price: formatPriceE8(q.price_e8),
    expiresAt: q.expires_at,
  };
}

function orderView(o) {
  return {
    id: o.id,
    pair: o.pair,
    side: o.side,
    baseAsset: o.base_asset,
    quoteAsset: o.quote_asset,
    baseAmount: formatAmount(o.base_amount, o.base_asset),
    quoteAmount: formatAmount(o.quote_amount, o.quote_asset),
    fee: formatAmount(o.fee, o.quote_asset),
    price: formatPriceE8(o.price_e8),
    status: o.status,
    createdAt: o.created_at,
  };
}

export function register(r) {
  // Create a short-lived locked-price quote.
  r.post('/orders/quote', async (c) => {
    requireKyc(c.user, 1);
    await rateLimit(c.env, 'quote', c.user.id, 30, 60);
    const body = await readJson(c.request);
    const pair = oneOf(str(body.pair, 'pair', { max: 12 }), 'pair', Object.keys(PAIRS));
    const side = oneOf(body.side, 'side', ['buy', 'sell']);
    const { base, quote } = PAIRS[pair];

    let baseAmount;
    try {
      baseAmount = parseAmount(body.amount, base);
    } catch (e) {
      throw moneyToHttp(e);
    }
    if (baseAmount <= 0) throw badRequest('invalid_amount', 'Amount must be positive');

    const rates = await loadRates(c.env);
    const priceE8 = tradePriceE8(c.env, rates, pair, side);
    let calc;
    try {
      calc = computeQuote({
        side, baseAmount, priceE8, baseAsset: base, quoteAsset: quote,
        feeBps: envInt(c.env, 'FEE_BPS', 50),
      });
    } catch (e) {
      throw moneyToHttp(e);
    }

    const limits = TRADE_LIMITS[quote];
    const min = wholeToMinor(limits.min, quote);
    const max = wholeToMinor(limits.max[c.user.kyc_level] ?? limits.max[1], quote);
    if (calc.quoteAmount < min) throw badRequest('below_minimum', 'Order is below the minimum size', { min: String(limits.min), asset: quote });
    if (calc.quoteAmount > max) throw badRequest('above_maximum', 'Order exceeds your limit', { max: String(limits.max[c.user.kyc_level] ?? limits.max[1]), asset: quote });

    const now = nowSec();
    const q = {
      id: randomId('qt'),
      pair, side, base_asset: base, quote_asset: quote,
      base_amount: baseAmount, quote_amount: calc.quoteAmount, fee: calc.fee,
      price_e8: Number(priceE8), expires_at: now + envInt(c.env, 'QUOTE_TTL_SECONDS', 30),
    };
    await c.env.DB.prepare(
      `INSERT INTO quotes (id, user_id, pair, side, base_asset, quote_asset, base_amount, quote_amount, fee, price_e8, expires_at, created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
      .bind(q.id, c.user.id, pair, side, base, quote, q.base_amount, q.quote_amount, q.fee, q.price_e8, q.expires_at, now)
      .run();
    return ok({ quote: quoteView(q) });
  }, { auth: true });

  // Execute a quote atomically against the user's wallet.
  r.post('/orders', async (c) => {
    requireKyc(c.user, 1);
    await rateLimit(c.env, 'order', c.user.id, 20, 60);
    const body = await readJson(c.request);
    const quoteId = str(body.quoteId, 'quoteId', { max: 64, pattern: /^qt_[0-9a-f]{24}$/ });

    const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?1 AND user_id = ?2')
      .bind(quoteId, c.user.id)
      .first();
    if (!q) throw notFound('Quote not found');
    const now = nowSec();
    if (now > q.expires_at) throw new HttpError(410, 'quote_expired', 'Quote expired, request a new one');

    const buy = q.side === 'buy';
    const orderId = randomId('ord');
    let reward = 0;
    let referrerId = null;
    if (c.user.referred_by) {
      const referrer = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?1 AND status = 'active'")
        .bind(c.user.referred_by)
        .first();
      if (referrer) {
        referrerId = referrer.id;
        reward = Math.floor((q.fee * envInt(c.env, 'REFERRAL_BPS', 2000)) / 10000);
      }
    }

    const db = c.env.DB;
    const ref = { refType: 'order', refId: orderId, now };
    const stmts = [
      // UNIQUE(quote_id) makes the quote single-use even under concurrent requests.
      db
        .prepare(
          `INSERT INTO orders (id, user_id, quote_id, pair, side, base_asset, quote_asset, base_amount, quote_amount, fee, price_e8, status, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'filled',?12)`,
        )
        .bind(orderId, c.user.id, q.id, q.pair, q.side, q.base_asset, q.quote_asset, q.base_amount, q.quote_amount, q.fee, q.price_e8, now),
      ...(buy
        ? [
            ...move(db, { userId: c.user.id, asset: q.quote_asset, available: -(q.quote_amount + q.fee), kind: 'trade_debit', ...ref }),
            ...move(db, { userId: c.user.id, asset: q.base_asset, available: q.base_amount, kind: 'trade_credit', ...ref }),
            ...move(db, { userId: HOUSE_ID, asset: q.quote_asset, available: q.quote_amount + q.fee, kind: 'trade_house', ...ref }),
            ...move(db, { userId: HOUSE_ID, asset: q.base_asset, available: -q.base_amount, kind: 'trade_house', ...ref }),
          ]
        : [
            ...move(db, { userId: c.user.id, asset: q.base_asset, available: -q.base_amount, kind: 'trade_debit', ...ref }),
            ...move(db, { userId: c.user.id, asset: q.quote_asset, available: q.quote_amount - q.fee, kind: 'trade_credit', ...ref }),
            ...move(db, { userId: HOUSE_ID, asset: q.base_asset, available: q.base_amount, kind: 'trade_house', ...ref }),
            ...move(db, { userId: HOUSE_ID, asset: q.quote_asset, available: -(q.quote_amount - q.fee), kind: 'trade_house', ...ref }),
          ]),
    ];
    if (reward > 0) {
      stmts.push(
        ...move(db, { userId: referrerId, asset: q.quote_asset, available: reward, kind: 'referral_reward', ...ref }),
        ...move(db, { userId: HOUSE_ID, asset: q.quote_asset, available: -reward, kind: 'referral_reward', ...ref }),
        db
          .prepare('INSERT INTO referral_rewards (referrer_id, referee_id, order_id, asset, amount, created_at) VALUES (?1,?2,?3,?4,?5,?6)')
          .bind(referrerId, c.user.id, orderId, q.quote_asset, reward, now),
        notify(db, referrerId, 'پاداش دعوت', `${formatAmount(reward, q.quote_asset)} ${q.quote_asset} از معامله دوست شما دریافت شد.`, now),
      );
    }
    stmts.push(
      notify(
        db,
        c.user.id,
        'معامله انجام شد',
        `${buy ? 'خرید' : 'فروش'} ${formatAmount(q.base_amount, q.base_asset)} ${q.base_asset} با موفقیت انجام شد.`,
        now,
      ),
    );

    try {
      await db.batch(stmts);
    } catch (err) {
      const reason = constraintReason(err);
      if (reason === 'insufficient_funds') throw conflict('insufficient_funds', 'Insufficient balance');
      if (reason === 'duplicate') throw conflict('quote_used', 'This quote was already used');
      throw err;
    }

    c.ectx.waitUntil(
      sendMessage(
        c.env,
        c.user.telegram_id,
        `✅ ${buy ? 'خرید' : 'فروش'} <b>${formatAmount(q.base_amount, q.base_asset)} ${q.base_asset}</b> انجام شد.`,
      ),
    );
    const order = await db.prepare('SELECT * FROM orders WHERE id = ?1').bind(orderId).first();
    return ok({ order: orderView(order) }, 201);
  }, { auth: true });

  r.get('/orders', async (c) => {
    const { limit, before } = pageParams(c.url);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM orders WHERE user_id = ?1 AND (?2 IS NULL OR created_at < ?2)
       ORDER BY created_at DESC, id DESC LIMIT ?3`,
    )
      .bind(c.user.id, before, limit)
      .all();
    return ok({ orders: rows.results.map(orderView) });
  }, { auth: true });

  r.get('/orders/:id', async (c) => {
    const o = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?1 AND user_id = ?2')
      .bind(c.params.id, c.user.id)
      .first();
    if (!o) throw notFound('Order not found');
    return ok({ order: orderView(o) });
  }, { auth: true });
}
