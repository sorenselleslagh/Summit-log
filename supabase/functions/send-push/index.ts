// Sends a web push when a message row is inserted.
// Entrypoint: supabase/functions/send-push/index.ts
// Deploy with verify_jwt disabled (see supabase/config.toml). The caller is
// the database, which sends x-webhook-secret rather than a user JWT.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import postgres from "postgres";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectPushTargets, isExpiredPush } = require("./targets.cjs");

type PushSecrets = {
  vapidPrivate: string;
  vapidPublic: string;
  subject: string;
  webhook: string;
};

let cached: PushSecrets | null = null;

function sameSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function secretsFromVault(): Promise<PushSecrets> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
  if (!dbUrl) throw new Error("SUPABASE_DB_URL missing");
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const rows = await sql`select private.push_runtime_secrets() as secrets`;
    const bag = (rows[0] && rows[0].secrets) || {};
    return {
      vapidPrivate: String(bag.summitlog_vapid_private || ""),
      vapidPublic: String(bag.summitlog_vapid_public || ""),
      subject: String(bag.summitlog_vapid_subject || ""),
      webhook: String(bag.summitlog_push_webhook_secret || ""),
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function loadSecrets(): Promise<PushSecrets> {
  if (cached && cached.webhook && cached.vapidPrivate && cached.vapidPublic) return cached;
  const fromEnv: PushSecrets = {
    vapidPrivate: Deno.env.get("VAPID_PRIVATE_KEY") || "",
    vapidPublic: Deno.env.get("VAPID_PUBLIC_KEY") || "",
    subject: Deno.env.get("VAPID_SUBJECT") || "",
    webhook: Deno.env.get("PUSH_WEBHOOK_SECRET") || "",
  };
  if (fromEnv.vapidPrivate && fromEnv.vapidPublic && fromEnv.webhook) {
    if (!fromEnv.subject) fromEnv.subject = "mailto:sorenselleslagh@gmail.com";
    cached = fromEnv;
    return cached;
  }
  const fromVault = await secretsFromVault();
  cached = {
    vapidPrivate: fromEnv.vapidPrivate || fromVault.vapidPrivate,
    vapidPublic: fromEnv.vapidPublic || fromVault.vapidPublic,
    subject: fromEnv.subject || fromVault.subject || "mailto:sorenselleslagh@gmail.com",
    webhook: fromEnv.webhook || fromVault.webhook,
  };
  return cached;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let secrets: PushSecrets;
  try {
    secrets = await loadSecrets();
  } catch (_err) {
    return new Response("not configured", { status: 503 });
  }
  const header = req.headers.get("x-webhook-secret") || "";
  if (!secrets.webhook || !header || !sameSecret(header, secrets.webhook)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!secrets.vapidPublic || !secrets.vapidPrivate) {
    return new Response("not configured", { status: 503 });
  }

  const payload = await req.json();
  const record = payload.record || payload;
  if (!record || !record.conversation_id || !record.sender_id) {
    return new Response("ignored", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  );
  const members = await supabase.from("conversation_members")
    .select("user_id, muted_until, left_at")
    .eq("conversation_id", record.conversation_id);
  const blocks = await supabase.from("blocks").select("blocker_id, blocked_id");
  const subs = await supabase.from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_secret");
  if (members.error || subs.error) return new Response("lookup failed", { status: 500 });

  const targets = selectPushTargets({
    message: record,
    members: members.data || [],
    blocks: blocks.data || [],
    subscriptions: subs.data || [],
  });
  webpush.setVapidDetails(secrets.subject, secrets.vapidPublic, secrets.vapidPrivate);
  const body = JSON.stringify({
    title: "SummitLog",
    body: String(record.body || "New message").slice(0, 140),
    conversationId: record.conversation_id,
  });
  let sent = 0;
  let removed = 0;
  for (const sub of targets) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
      }, body);
      sent += 1;
    } catch (err) {
      const status = err && ((err as { statusCode?: number }).statusCode || (err as { status?: number }).status);
      if (isExpiredPush(status)) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        removed += 1;
      }
    }
  }
  return Response.json({ sent, removed });
});
