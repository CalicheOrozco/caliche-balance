import { createApp } from "../server/app.ts";
import { connect } from "../server/db.ts";
import { webPushSetup } from "../server/push.ts";

// Vercel routes every /api/* request here (see vercel.json); Express handles the rest.
// Notification settings that are missing or malformed turn notifications off, never the API.
const push = webPushSetup();
export default createApp({
  getCollections: () => connect(),
  secureCookies: true,
  cronSecret: process.env.CRON_SECRET,
  push: push.sender,
  pushProblem: push.problem,
});
