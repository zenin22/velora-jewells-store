import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!keyId || !keySecret || !supabaseUrl || !serviceKey) return reply({ error: "Checkout is not configured yet." }, 503);
  try {
    const body = await req.json();
    const orderId = body?.razorpay_order_id;
    const paymentId = body?.razorpay_payment_id;
    const signature = body?.razorpay_signature;
    if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") return reply({ error: "Payment verification details are missing." }, 400);
    const expected = await hmac(keySecret, orderId + "|" + paymentId);
    if (!equal(expected, signature)) return reply({ error: "Payment signature verification failed." }, 400);

    const gatewayResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId), {
      headers: { "Authorization": "Basic " + btoa(keyId + ":" + keySecret) },
    });
    const payment = await gatewayResponse.json();
    if (!gatewayResponse.ok || payment.order_id !== orderId || payment.currency !== "INR" || payment.status !== "captured") {
      return reply({ error: "Payment is not confirmed as captured. If money was deducted, contact support with payment ID " + paymentId + "." }, 409);
    }
    const method = body?.payment_method;
    if (method !== "cod" && method !== "prepaid") return reply({ error: "Invalid payment method." }, 400);
    const customer = body?.customer;
    const items = body?.items;
    if (!customer || !Array.isArray(items)) return reply({ error: "Order details are incomplete." }, 400);
    const paidAmount = payment.amount / 100;
    if (!Number.isInteger(paidAmount)) return reply({ error: "Invalid payment amount." }, 400);
    const expectedAmount = method === "cod" ? 70 : null;
    if (expectedAmount !== null && paidAmount !== expectedAmount) return reply({ error: "COD advance amount did not match." }, 400);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("create_paid_order", {
      p_customer_name: customer.name,
      p_customer_email: customer.email || null,
      p_customer_phone: customer.phone,
      p_shipping_address: customer.address,
      p_payment_method: method,
      p_payment_id: paymentId,
      p_provider_order_id: orderId,
      p_paid_amount_inr: paidAmount,
      p_items: items,
    });
    if (error) {
      console.error("Could not create paid order", error);
      // If the payment succeeded but stock or validation changed, initiate a refund rather than leave the customer charged without an order.
      try {
        await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/refund", {
          method: "POST",
          headers: { "Authorization": "Basic " + btoa(keyId + ":" + keySecret), "Content-Type": "application/json" },
          body: JSON.stringify({ amount: payment.amount, notes: { reason: "Velora order could not be fulfilled", order_id: orderId } }),
        });
      } catch (refundError) { console.error("Refund request failed; manual refund may be required", refundError); }
      return reply({ error: "We could not confirm the order because stock or details changed. A refund request was initiated; keep payment ID " + paymentId + " for reference." }, 409);
    }
    return reply({ success: true, order: data });
  } catch (error) {
    console.error("verify-payment failed", error);
    return reply({ error: "Payment verification failed. Do not retry payment blindly; contact support if money was deducted." }, 500);
  }
});