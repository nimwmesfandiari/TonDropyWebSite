import { ok, nowSec } from '../lib/http.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';
import { str, isValidNationalId, isValidIsoDate, ageInYears, sniffImageType } from '../lib/validate.js';
import { rateLimit } from '../lib/ratelimit.js';
import { randomId } from '../lib/crypto.js';
import { encryptField, blindIndex } from '../lib/fieldcrypto.js';
import { audit, notify } from '../lib/ledger.js';
import { KYC } from '../config.js';

const view = (s) =>
  s && {
    id: s.id,
    status: s.status,
    rejectReason: s.reject_reason,
    createdAt: s.created_at,
    reviewedAt: s.reviewed_at,
  };

async function readImage(form, field) {
  const file = form.get(field);
  if (!file || typeof file === 'string') throw badRequest('missing_file', `${field} is required`, { field });
  if (file.size > KYC.maxFileBytes) throw new HttpError(413, 'file_too_large', `${field} exceeds 5 MB`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !KYC.allowedTypes.includes(type)) {
    throw badRequest('invalid_file_type', `${field} must be a JPEG, PNG or WebP image`, { field });
  }
  return { bytes, type };
}

export function register(r) {
  r.get('/verification', async (c) => {
    const last = await c.env.DB.prepare('SELECT * FROM kyc_submissions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1')
      .bind(c.user.id)
      .first();
    return ok({ kycLevel: c.user.kyc_level, submission: view(last) });
  }, { auth: true });

  r.post('/verification', async (c) => {
    if (!c.env.KYC_ENCRYPTION_KEY || !c.env.KYC_HASH_KEY) throw new HttpError(503, 'kyc_unavailable', 'Verification is not configured');
    await rateLimit(c.env, 'kyc', c.user.id, 5, 3600);
    if (c.user.kyc_level >= 1) throw conflict('already_verified', 'Account is already verified');

    const pending = await c.env.DB.prepare("SELECT id FROM kyc_submissions WHERE user_id = ?1 AND status = 'pending'")
      .bind(c.user.id)
      .first();
    if (pending) throw conflict('already_pending', 'A submission is already under review');

    let form;
    try {
      form = await c.request.formData();
    } catch {
      throw badRequest('invalid_form', 'Expected multipart/form-data');
    }
    const fullName = str(form.get('fullName'), 'fullName', { min: 3, max: 80 });
    const nationalId = str(form.get('nationalId'), 'nationalId', { min: 10, max: 10 });
    const birthDate = str(form.get('birthDate'), 'birthDate', { min: 10, max: 10 });
    if (!isValidNationalId(nationalId)) throw badRequest('invalid_national_id', 'Invalid national ID');
    if (!isValidIsoDate(birthDate) || ageInYears(birthDate) < 18 || ageInYears(birthDate) > 100) {
      throw badRequest('invalid_birth_date', 'You must be at least 18 years old');
    }

    const nidHash = await blindIndex(nationalId, c.env.KYC_HASH_KEY);
    const dup = await c.env.DB.prepare(
      "SELECT id FROM kyc_submissions WHERE national_id_hash = ?1 AND status = 'approved' AND user_id != ?2",
    )
      .bind(nidHash, c.user.id)
      .first();
    if (dup) throw conflict('national_id_in_use', 'This national ID is linked to another account');

    const front = await readImage(form, 'idCard');
    const selfie = await readImage(form, 'selfie');

    const id = randomId('kyc');
    const frontKey = `kyc/${c.user.id}/${id}/id-card`;
    const selfieKey = `kyc/${c.user.id}/${id}/selfie`;
    await Promise.all([
      c.env.KYC_BUCKET.put(frontKey, front.bytes, { httpMetadata: { contentType: front.type } }),
      c.env.KYC_BUCKET.put(selfieKey, selfie.bytes, { httpMetadata: { contentType: selfie.type } }),
    ]);

    const now = nowSec();
    const k = c.env.KYC_ENCRYPTION_KEY;
    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO kyc_submissions (id, user_id, full_name, national_id, national_id_hash, birth_date, doc_front_key, doc_selfie_key, status, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)`,
        )
        .bind(id, c.user.id, await encryptField(fullName, k), await encryptField(nationalId, k), nidHash, await encryptField(birthDate, k), frontKey, selfieKey, now),
      audit(c.env.DB, { actorId: c.user.id, action: 'kyc.submit', target: id, now }),
      notify(c.env.DB, c.user.id, 'مدارک دریافت شد', 'مدارک شما در صف بررسی قرار گرفت.', now),
    ]);
    return ok({ id, status: 'pending' }, 201);
  }, { auth: true });
}
