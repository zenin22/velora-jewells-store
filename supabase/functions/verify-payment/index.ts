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

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]!));
const money = (value: unknown) => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const safeImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

async function claimOrderEmail(supabase: any, orderId: string): Promise<boolean> {
  const table = supabase.from("order_email_notifications");
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: existing, error: readError } = await table
    .select("order_id,status,attempts,updated_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.status === "sent") return false;
  if (existing?.status === "sending" && Date.parse(existing.updated_at) > Date.now() - 5 * 60 * 1000) return false;

  if (!existing) {
    const { error: insertError } = await table.insert({
      order_id: orderId, status: "sending", attempts: 1, updated_at: now, last_error: null,
    });
    if (!insertError) return true;
    if (insertError.code !== "23505") throw insertError;
    // Another simultaneous verification claimed the same order; the caller that won will send it.
    return false;
  }

  let update = table.update({
    status: "sending",
    attempts: Number(existing.attempts || 0) + 1,
    updated_at: now,
    last_error: null,
  }).eq("order_id", orderId).eq("status", existing.status);
  if (existing.status === "sending") update = update.lt("updated_at", staleBefore);
  const { data, error } = await update.select("order_id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function sendOrderNotification(supabase: any, orderId: string): Promise<string> {
  let claimed = false;
  const markFailed = async (message: string) => {
    const safeMessage = String(message || "Unknown email error").slice(0, 700);
    await supabase.from("order_email_notifications").update({
      status: "failed", last_error: safeMessage, updated_at: new Date().toISOString(),
    }).eq("order_id", orderId);
    console.error("Order email notification failed", { orderId, message: safeMessage });
    return "failed";
  };

  try {
    claimed = await claimOrderEmail(supabase, orderId);
    if (!claimed) {
      const { data } = await supabase.from("order_email_notifications")
        .select("status").eq("order_id", orderId).maybeSingle();
      return data?.status === "sent" ? "already_sent" : "in_progress";
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return await markFailed("Missing RESEND_API_KEY Edge Function secret.");
    const from = Deno.env.get("ORDER_EMAIL_FROM") || "Velora Jewells <orders@velorajewells.in>";

    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id,order_number,customer_name,customer_email,customer_phone,shipping_address,subtotal_inr,paid_amount_inr,amount_due_inr,payment_method,payment_status,order_status,created_at,order_items(id,product_name,product_image_url,unit_price_inr,quantity,line_total_inr)")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error("Confirmed order could not be loaded for notification.");

    const { data: adminData, error: adminError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (adminError) throw adminError;
    const recipients = [...new Set((adminData?.users || [])
      .filter((user: any) => user?.app_metadata?.role === "admin" && typeof user.email === "string" && user.email.includes("@"))
      .map((user: any) => user.email.trim().toLowerCase()))];
    if (!recipients.length) throw new Error("No authorised admin email was found in Supabase Auth.");

    const address = order.shipping_address && typeof order.shipping_address === "object" ? order.shipping_address : {};
    const addressLine = [address.line1, address.line2, address.city, address.state, address.pincode, address.country || "India"]
      .filter((part) => typeof part === "string" && part.trim()).join(", ");
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    if (!items.length) throw new Error("Order has no saved item rows.");

    const productRows = items.map((item: any) => {
      const name = escapeHtml(item.product_name || "Jewellery product");
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price_inr || 0);
      const lineTotal = Number(item.line_total_inr ?? unitPrice * quantity);
      const imageUrl = safeImageUrl(item.product_image_url);
      const imageCell = imageUrl
        ? '<img src="' + escapeHtml(imageUrl) + '" width="72" height="72" alt="' + name + '" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid #eadce5;background:#f7f1f5">'
        : '<div style="width:72px;height:72px;line-height:72px;text-align:center;background:#f7f1f5;border-radius:10px;color:#887486;font-size:11px">No photo</div>';
      return '<tr><td style="padding:14px 10px;border-bottom:1px solid #eee5eb">' + imageCell + '</td><td style="padding:14px 10px;border-bottom:1px solid #eee5eb;color:#281b2a;font-weight:700">' + name + '<div style="font-size:12px;color:#807182;font-weight:400;margin-top:5px">' + money(unitPrice) + ' each</div></td><td style="padding:14px 10px;border-bottom:1px solid #eee5eb;color:#554858;text-align:center">' + quantity + '</td><td style="padding:14px 10px;border-bottom:1px solid #eee5eb;color:#281b2a;text-align:right;font-weight:700">' + money(lineTotal) + '</td></tr>';
    }).join("");

    const orderNumber = escapeHtml(order.order_number || order.id);
    const customerName = escapeHtml(order.customer_name || "Customer");
    const customerEmail = escapeHtml(order.customer_email || "Not provided");
    const customerPhone = escapeHtml(order.customer_phone || "Not provided");
    const paymentMethod = String(order.payment_method || "").toLowerCase() === "cod" ? "Cash on Delivery (₹70 advance paid)" : "Prepaid";
    const paymentStatus = escapeHtml(order.payment_status || "paid");
    const createdAt = order.created_at
      ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))
      : new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const subtotal = Number(order.subtotal_inr || 0);
    const paid = Number(order.paid_amount_inr || 0);
    const due = Number(order.amount_due_inr || 0);
    const adminUrl = "https://zenin22.github.io/velora-jewells-store/manage.html?view=orders#section-orders";

    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:0;background:#f7f2f6;font-family:Arial,Helvetica,sans-serif;color:#281b2a"><div style="max-width:760px;margin:0 auto;padding:24px 12px"><div style="background:#17101c;padding:25px 28px;border-radius:16px 16px 0 0;color:#fff"><div style="color:#e99ac0;font-size:11px;letter-spacing:3px;font-weight:700">VELORA JEWELLS</div><h1 style="font-size:25px;line-height:1.25;margin:14px 0 6px">New order received</h1><p style="margin:0;color:#d5c7d8;font-size:13px">A customer has placed an order on your store.</p></div><div style="background:#fff;padding:26px 28px;border:1px solid #eadfe8;border-top:0;border-radius:0 0 16px 16px"><div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:22px"><div style="flex:1;min-width:160px;background:#faf6fa;padding:14px;border-radius:10px"><div style="font-size:10px;letter-spacing:1px;color:#806d83;text-transform:uppercase">Order number</div><div style="font-size:18px;font-weight:700;margin-top:7px">' + orderNumber + '</div></div><div style="flex:1;min-width:160px;background:#faf6fa;padding:14px;border-radius:10px"><div style="font-size:10px;letter-spacing:1px;color:#806d83;text-transform:uppercase">Order time (IST)</div><div style="font-size:14px;font-weight:700;margin-top:9px">' + escapeHtml(createdAt) + '</div></div></div><h2 style="font-size:16px;margin:22px 0 8px">Products ordered</h2><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:9px 10px;font-size:10px;color:#806d83;text-transform:uppercase">Photo</th><th style="text-align:left;padding:9px 10px;font-size:10px;color:#806d83;text-transform:uppercase">Product</th><th style="text-align:center;padding:9px 10px;font-size:10px;color:#806d83;text-transform:uppercase">Qty</th><th style="text-align:right;padding:9px 10px;font-size:10px;color:#806d83;text-transform:uppercase">Total</th></tr></thead><tbody>' + productRows + '</tbody></table><h2 style="font-size:16px;margin:26px 0 12px">Customer details</h2><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;border-collapse:collapse"><tr><td style="padding:8px 0;color:#806d83;width:130px">Name</td><td style="padding:8px 0;font-weight:700">' + customerName + '</td></tr><tr><td style="padding:8px 0;color:#806d83">Phone</td><td style="padding:8px 0">' + customerPhone + '</td></tr><tr><td style="padding:8px 0;color:#806d83">Email</td><td style="padding:8px 0">' + customerEmail + '</td></tr><tr><td style="padding:8px 0;color:#806d83;vertical-align:top">Delivery address</td><td style="padding:8px 0;line-height:1.6">' + escapeHtml(addressLine || "Not saved") + '</td></tr></table><h2 style="font-size:16px;margin:26px 0 12px">Payment summary</h2><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;border-collapse:collapse"><tr><td style="padding:8px 0;color:#806d83">Product subtotal</td><td style="padding:8px 0;text-align:right;font-weight:700">' + money(subtotal) + '</td></tr><tr><td style="padding:8px 0;color:#806d83">Paid now · ' + escapeHtml(paymentMethod) + '</td><td style="padding:8px 0;text-align:right">' + money(paid) + '</td></tr><tr><td style="padding:8px 0;color:#806d83">Due at delivery</td><td style="padding:8px 0;text-align:right">' + money(due) + '</td></tr><tr><td style="padding:13px 0;border-top:1px solid #eadfe8;font-weight:700">Payment status</td><td style="padding:13px 0;border-top:1px solid #eadfe8;text-align:right;font-weight:700">' + paymentStatus + '</td></tr></table><p style="margin:26px 0 0"><a href="' + adminUrl + '" style="display:inline-block;background:#d98aaa;color:#25111c;border-radius:9px;padding:13px 18px;font-weight:700;font-size:12px;text-decoration:none">Open order in admin panel →</a></p><p style="margin:24px 0 0;font-size:11px;line-height:1.6;color:#938596">This automated alert was generated after the store confirmed the order. Product images are loaded from the product image URLs saved with the order.</p></div></div></body></html>';

    const textItems = items.map((item: any) => "- " + String(item.product_name || "Jewellery product") + " × " + Number(item.quantity || 0) + " — " + money(Number(item.line_total_inr ?? Number(item.unit_price_inr || 0) * Number(item.quantity || 0)))).join("\n");
    const textBody = [
      "VELORA JEWELLS — NEW ORDER RECEIVED",
      "Order: " + String(order.order_number || order.id),
      "Order time (IST): " + createdAt,
      "",
      "PRODUCTS",
      textItems,
      "",
      "CUSTOMER",
      "Name: " + String(order.customer_name || "Customer"),
      "Phone: " + String(order.customer_phone || "Not provided"),
      "Email: " + String(order.customer_email || "Not provided"),
      "Delivery address: " + (addressLine || "Not saved"),
      "",
      "PAYMENT SUMMARY",
      "Product subtotal: " + money(subtotal),
      "Payment method: " + paymentMethod,
      "Paid now: " + money(paid),
      "Due at delivery: " + money(due),
      "Payment status: " + String(order.payment_status || "paid"),
      "",
      "Manage order: " + adminUrl,
    ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "velora-order-notification/" + order.id,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: "New order " + String(order.order_number || order.id) + " — Velora Jewells",
        html,
        text: textBody,
        tags: [{ name: "category", value: "order-notification" }],
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok || !responseBody?.id) {
      throw new Error("Resend API returned " + response.status + ": " + String(responseBody?.message || responseBody?.name || "Email was not accepted"));
    }
    const { error: updateError } = await supabase.from("order_email_notifications").update({
      status: "sent", resend_email_id: responseBody.id, last_error: null,
      sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("order_id", order.id);
    if (updateError) console.error("Email was accepted but notification status update failed", { orderId, message: updateError.message });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email notification error";
    if (claimed) return await markFailed(message);
    console.error("Could not claim order email notification", { orderId, message });
    return "failed";
  }
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
      // A parallel retry may have completed the same payment first. Return that order instead of refunding it.
      const { data: existing } = await supabase.from("orders")
        .select("id,order_number,subtotal_inr,paid_amount_inr,amount_due_inr,payment_method")
        .eq("payment_reference", paymentId).maybeSingle();
      if (existing) {
        const notification_status = await sendOrderNotification(supabase, String(existing.id));
        return reply({ success: true, order: existing, notification_status });
      }
      // If stock or validation changed after payment, ask the gateway for a refund and verify its response.
      try {
        const refundResponse = await fetch("https://api.razorpay.com/v1/payments/" + encodeURIComponent(paymentId) + "/refund", {
          method: "POST",
          headers: { "Authorization": "Basic " + btoa(keyId + ":" + keySecret), "Content-Type": "application/json" },
          body: JSON.stringify({ amount: payment.amount, notes: { reason: "Velora order could not be fulfilled", order_id: orderId } }),
        });
        if (!refundResponse.ok) {
          console.error("Gateway refund request was rejected", await refundResponse.text());
          return reply({ error: "We could not confirm the order and the automatic refund request failed. Contact support with payment ID " + paymentId + "." }, 409);
        }
      } catch (refundError) {
        console.error("Refund request failed; manual refund may be required", refundError);
        return reply({ error: "We could not confirm the order and could not request an automatic refund. Contact support with payment ID " + paymentId + "." }, 409);
      }
      return reply({ error: "We could not confirm the order because stock or details changed. A refund request was accepted; keep payment ID " + paymentId + " for reference." }, 409);
    }
    const notification_status = await sendOrderNotification(supabase, String(data.id));
    return reply({ success: true, order: data, notification_status });
  } catch (error) {
    console.error("verify-payment failed", error);
    return reply({ error: "Payment verification failed. Do not retry payment blindly; contact support if money was deducted." }, 500);
  }
});