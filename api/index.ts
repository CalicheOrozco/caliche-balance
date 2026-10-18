import { createApp } from "../server/app.ts";
import { connect } from "../server/db.ts";

// Vercel routes every /api/* request here (see vercel.json); Express handles the rest.
export default createApp({ getCollections: () => connect(), secureCookies: true, cronSecret: process.env.CRON_SECRET });
