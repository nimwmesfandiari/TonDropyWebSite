// Refreshes the TON/USD price into KV. On failure the old value is kept and
// simply ages out, which pauses trading once it is older than TON_PRICE_MAX_AGE_SECONDS.

const URL_ =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd&include_24hr_change=true';

export async function refreshPrices(env) {
  try {
    const res = await fetch(URL_, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 30 } });
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const data = await res.json();
    const entry = data && data['the-open-network'];
    const usd = entry && Number(entry.usd);
    if (!Number.isFinite(usd) || usd <= 0 || usd > 10_000) throw new Error('bad price payload');

    // Reject absurd jumps (> 25% in one minute) so a bad feed cannot move the market.
    const prev = await env.KV.get('rates:ton', 'json');
    if (prev && Math.abs(usd - prev.usd) / prev.usd > 0.25) {
      console.error('price jump rejected', prev.usd, usd);
      return;
    }
    await env.KV.put(
      'rates:ton',
      JSON.stringify({
        usd,
        change24h: Number.isFinite(entry.usd_24h_change) ? Number(entry.usd_24h_change.toFixed(2)) : null,
        updatedAt: Math.floor(Date.now() / 1000),
        source: 'coingecko',
      }),
    );
  } catch (err) {
    console.error('price refresh failed', err && err.message);
  }
}
