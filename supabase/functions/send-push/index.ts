// Sends a web push when a message row is inserted.
// Deploy with: supabase functions deploy send-push
// Secrets (names only): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to hosted functions.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectPushTargets, isExpiredPush } = require("./targets.cjs");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET") || "";
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:summitlog@localhost";
  if (!publicKey || !privateKey) return new Response("not configured", { status: 503 });

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
    blocks: (blocks.data || []),
    subscriptions: subs.data || []
  });
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const body = JSON.stringify({
    title: "SummitLog",
    body: String(record.body || "New message").slice(0, 140),
    conversationId: record.conversation_id
  });
  let sent = 0;
  let removed = 0;
  for (const sub of targets) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_secret }
      }, body);
      sent += 1;
    } catch (err) {
      const status = err && (err.statusCode || err.status);
      if (isExpiredPush(status)) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        removed += 1;
      }
    }
  }
  return Response.json({ sent, removed });
});
