// Prints ready-to-run commands with freshly generated random secrets.
// Nothing is stored or sent anywhere; copy the commands you need.
import { randomBytes } from "node:crypto";

const b64 = (n) => randomBytes(n).toString("base64");
const hex = (n) => randomBytes(n).toString("hex");

console.log(`# Run each command and paste the value when asked.
# Generated values (shown once, keep them in a password manager):

JWT_SECRET               ${hex(32)}
TELEGRAM_WEBHOOK_SECRET  ${hex(24)}
KYC_ENCRYPTION_KEY       ${b64(32)}
KYC_HASH_KEY             ${hex(32)}

npx wrangler secret put JWT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN        # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put KYC_ENCRYPTION_KEY
npx wrangler secret put KYC_HASH_KEY
npx wrangler secret put TONCENTER_API_KEY         # optional

WARNING: losing KYC_ENCRYPTION_KEY makes stored KYC data unreadable. Back it up.
`);
