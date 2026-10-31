import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const orderNumber = String(body?.order_number || "").trim().toUpperCase();
    const phone = String(body?.phone || "").replace(/\D/g, "");
    if (!/^VJ-[A-F0-9]{10}$/.test(orderNumber) || !/^[6-9]\d{9}$/.test(phone)) {
      return reply({ error: "Enter a valid Velora order number and the 10-digit mobile number used at checkout." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("Track order is missing server database configuration.");
      return reply({ error: "Order tracking is temporarily unavailable. Please contact Velora support." }, 503);
    }

    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.from("orders")
      .select("order_number,order_status,payment_status,payment_method,tracking_company,tracking_number,tracking_url,created_at,upi_reference,payment_submitted_at,payment_verified_at")
      .eq("order_number", orderNumber)
      .eq("customer_phone", phone)
      .maybeSingle();

    if (error) {
      console.error("Track order lookup failed:", error.message);
      return reply({ error: "Could not retrieve the order right now. Please try again shortly." }, 500);
    }
    if (!data) return reply({ error: "We couldn't find an order matching those details. Check the order number and mobile number." }, 404);

    let trackingUrl: string | null = null;
    if (typeof data.tracking_url === "string" && data.tracking_url.trim()) {
      try {
        const parsed = new URL(data.tracking_url);
        if (parsed.protocol === "https:") trackingUrl = parsed.toString();
      } catch { /* Invalid tracking links are omitted. */ }
    }

    return reply({
      order: {
        order_number: data.order_number,
        order_status: data.order_status,
        payment_status: data.payment_status,
        payment_method: data.payment_method,
        tracking_company: data.tracking_company,
        tracking_number: data.tracking_number,
        tracking_url: trackingUrl,
        created_at: data.created_at,
        upi_reference: data.upi_reference,
        payment_submitted_at: data.payment_submitted_at,
        payment_verified_at: data.payment_verified_at,
      },
    });
  } catch (error) {
    console.error("Track order request failed:", error instanceof Error ? error.message : "Unknown error");
    return reply({ error: "Something went wrong. Please try again." }, 500);
  }
});
