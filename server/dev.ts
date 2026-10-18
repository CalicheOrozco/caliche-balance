import { mkdirSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "./app.ts";
import { connect } from "./db.ts";

/**
 * Local API on port 3001. Uses MONGODB_URI when set (for example your Atlas cluster);
 * otherwise starts an embedded MongoDB that keeps its data in .data/ between runs.
 */
let uri = process.env.MONGODB_URI;
if (!uri) {
  mkdirSync(".data/mongo", { recursive: true });
  const mongo = await MongoMemoryServer.create({
    instance: { dbPath: ".data/mongo", storageEngine: "wiredTiger", port: 27027 },
  });
  uri = mongo.getUri();
  const stop = () => mongo.stop({ doCleanup: false }).finally(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const app = createApp({ getCollections: () => connect(uri), secureCookies: false });
app.listen(3001, () => console.log("API lista en http://localhost:3001/api"));
