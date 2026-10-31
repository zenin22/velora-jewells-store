import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const validPhone = (s: unknown) => typeof s === "string" && /^[6-9][0-9]{9}$/.test(s);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  // COD is handled by create-cod-order and must never depend on Razorpay.
  // Reject COD here before reading gateway secrets so a stale/misrouted COD
  // request cannot show the Razorpay configuration error.
  let requestedMethod: string | undefined;
  try {
    const incoming = await req.clone().json();
    requestedMethod = incoming?.payment_method;
  } catch {
    return reply({ error: "Invalid checkout request." }, 400);
  }
  if (requestedMethod === "cod") {
    return reply({ error: "COD checkout uses the separate COD order flow. Refresh checkout and choose Cash on Delivery again." }, 400);
  }

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!keyId || !keySecret || !supabaseUrl || !serviceKey) {
    return reply({ error: "Checkout is not configured yet. The store owner must configure Razorpay secrets in Supabase Edge Function secrets." }, 503);
  }

  try {
    const body = await req.json();
    const customer = body?.customer;
    const items = body?.items;
    const method = body?.payment_method;
    if (!customer || typeof customer.name !== "string" || customer.name.trim().length < 2 || customer.name.length > 120) return reply({ error: "Enter your full name." }, 400);
    if (!validPhone(customer.phone)) return reply({ error: "Enter a valid 10-digit Indian mobile number." }, 400);
    if (!customer.address || typeof customer.address !== "object") return reply({ error: "Shipping address is required." }, 400);
    const a = customer.address;
    if (typeof a.line1 !== "string" || a.line1.trim().length < 5 || typeof a.city !== "string" || a.city.trim().length < 2 || typeof a.state !== "string" || a.state.trim().length < 2 || !/^[0-9]{6}$/.test(String(a.pincode || ""))) return reply({ error: "Complete the address, city, state and 6-digit pincode." }, 400);
    if (method !== "cod" && method !== "prepaid") return reply({ error: "Choose COD or prepaid." }, 400);
    if (!Array.isArray(items) || items.length < 1 || items.length > 40) return reply({ error: "Your bag is empty or invalid." }, 400);
    const merged = new Map<string, number>();
    for (const item of items) {
      if (typeof item?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) return reply({ error: "Invalid item in bag." }, 400);
      merged.set(item.id, (merged.get(item.id) || 0) + item.quantity);
    }
    if ([...merged.values()].some(q => q > 20)) return reply({ error: "Maximum 20 of each item per order." }, 400);
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const ids = [...merged.keys()];
    const { data: products, error } = await supabase.from("products").select("id,name,price_inr,stock_quantity,is_active,is_sold_out").in("id", ids);
    if (error) throw error;
    if (!products || products.length !== ids.length) return reply({ error: "One or more products are no longer available." }, 409);
    let subtotal = 0;
    for (const p of products) {
      const quantity = merged.get(p.id)!;
      if (!p.is_active || p.is_sold_out || p.stock_quantity < quantity) return reply({ error: p.name + " is sold out or unavailable." }, 409);
      subtotal += p.price_inr * quantity;
    }
    if (subtotal < 500) return reply({ error: "Minimum product subtotal is ₹500 (shipping is free)." }, 400);
    const amountInr = method === "cod" ? 70 : subtotal;
    const receipt = "vj_" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Authorization": "Basic " + btoa(keyId + ":" + keySecret), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountInr * 100, currency: "INR", receipt, notes: { store: "Velora Jewells", payment_method: method, product_subtotal_inr: String(subtotal) } }),
    });
    const gateway = await response.json();
    if (!response.ok || !gateway.id) return reply({ error: "Payment provider could not start checkout. Please try again." }, 502);
    return reply({ key_id: keyId, razorpay_order_id: gateway.id, amount: gateway.amount, currency: gateway.currency, payment_method: method, subtotal_inr: subtotal, amount_due_inr: method === "cod" ? subtotal - 70 : 0 });
  } catch (error) {
    console.error("create-checkout failed", error);
    return reply({ error: "Unable to start checkout. Please try again." }, 500);
  }
});