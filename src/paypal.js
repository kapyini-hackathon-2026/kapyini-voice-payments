// PayPal REST client — runs on the server only. The secret never reaches the browser.
//
// Three calls are enough for the "send money" flow:
//   1. createOrder  → PayPal returns a link where the payer approves the payment
//   2. captureOrder → after approval, the server collects the money
//   3. getOrder     → read the real state of an order at any time
//
// Every call that moves money carries a PayPal-Request-Id header, so a retry
// (network cut, double click) can never create a second payment.

export class PayPalError extends Error {
  constructor({ status, name, issue, description, debugId }) {
    super(description || issue || name || `PayPal error ${status}`);
    this.status = status;
    this.paypalName = name;
    this.issue = issue;
    this.debugId = debugId;
  }
}

export function createPayPalClient({ clientId, secret, baseUrl, fetchImpl = fetch }) {
  let cachedToken = null;

  async function getAccessToken() {
    // Reuse the token until one minute before it expires (tokens last up to ~8 hours).
    if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new PayPalError({
        status: res.status,
        name: data.error,
        description: data.error_description || 'Could not get a PayPal access token. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
      });
    }
    cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cachedToken.value;
  }

  async function call(method, path, { body, requestId, mockResponse } = {}) {
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    // Sandbox-only negative testing: PayPal returns the named error instead of processing.
    if (mockResponse) headers['PayPal-Mock-Response'] = JSON.stringify({ mock_application_codes: mockResponse });

    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.details) ? data.details[0] : undefined;
      throw new PayPalError({
        status: res.status,
        name: data.name,
        issue: detail?.issue,
        description: detail?.description || data.message,
        debugId: data.debug_id,
      });
    }
    return data;
  }

  return {
    async createOrder({ amount, currency, payeeEmail, description, returnUrl, cancelUrl, requestId, locale }) {
      const order = await call('POST', '/v2/checkout/orders', {
        requestId,
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: requestId,
              description,
              amount: { currency_code: currency, value: amount },
              // The money goes to the recipient, not to the owner of this app.
              payee: { email_address: payeeEmail },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Kapyini (Sandbox demo)',
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                return_url: returnUrl,
                cancel_url: cancelUrl,
                ...(locale ? { locale } : {}),
              },
            },
          },
        },
      });
      const link = (order.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
      if (!link) throw new PayPalError({ status: 502, description: 'PayPal did not return an approval link.' });
      return { orderId: order.id, status: order.status, approveUrl: link.href };
    },

    async captureOrder(orderId, { requestId, mockResponse } = {}) {
      const order = await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        body: {},
        requestId,
        mockResponse,
      });
      return summarizeOrder(order);
    },

    async getOrder(orderId) {
      const order = await call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      return summarizeOrder(order);
    },

    // ----- Invoicing v2: payment requests a merchant sent to the user -----
    // The search result has no payer link, so each open invoice is read in full.
    async listOpenInvoices({ recipientEmail }) {
      const found = await call('POST', '/v2/invoicing/search-invoices?page=1&page_size=10', {
        body: { recipient_email: recipientEmail, status: ['SENT', 'UNPAID', 'PARTIALLY_PAID'] },
      });
      const items = found.items || [];
      return Promise.all(items.map((i) => this.getInvoice(i.id)));
    },

    async getInvoice(invoiceId) {
      const inv = await call('GET', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
      return summarizeInvoice(inv);
    },

    // Used only by the demo script: the app's own Sandbox business account issues a bill to the payer.
    async createAndSendInvoice({
      recipientEmail,
      businessName,
      itemName,
      amount,
      currency,
      dueDate,
      note,
      requestId,
    }) {
      const draft = await call('POST', '/v2/invoicing/invoices', {
        requestId,
        body: {
          detail: {
            currency_code: currency,
            note,
            payment_term: { due_date: dueDate },
          },
          invoicer: { business_name: businessName },
          primary_recipients: [
            { billing_info: { email_address: recipientEmail } },
          ],
          items: [
            {
              name: itemName,
              quantity: '1',
              unit_amount: { currency_code: currency, value: amount },
            },
          ],
        },
      });

      const id = draft.id || draft.href?.split('/').pop();

      if (typeof id !== 'string' || !id.trim()) {
        throw new PayPalError({
          status: 502,
          description: 'PayPal did not return a valid invoice ID.',
        });
      }

      await call(
        'POST',
        `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`,
        { body: { send_to_invoicer: false } },
      );

      return this.getInvoice(id);
    },
  };
}

// Reduce an invoice to what Kapyiŋi reads aloud before the user pays it.
export function summarizeInvoice(inv) {
  const due = inv.due_amount || inv.amount || {};
  return {
    id: inv.id,
    status: inv.status, // SENT, UNPAID, PAID, MARKED_AS_PAID, PAYMENT_PENDING, CANCELLED…
    number: inv.detail?.invoice_number ?? null,
    merchant: inv.invoicer?.business_name || inv.invoicer?.email_address || null,
    amount: due.value ?? null,
    currency: due.currency_code ?? inv.detail?.currency_code ?? null,
    dueDate: inv.detail?.payment_term?.due_date ?? null,
    note: inv.detail?.note ?? null,
    items: (inv.items || []).map((it) => ({ name: it.name, quantity: it.quantity, value: it.unit_amount?.value ?? null })),
    payUrl: inv.detail?.metadata?.recipient_view_url ?? null,
  };
}

export function invoiceState(status) {
  if (status === 'PAID' || status === 'MARKED_AS_PAID') return 'completed';
  if (status === 'PAYMENT_PENDING' || status === 'PARTIALLY_PAID') return 'pending';
  if (status === 'CANCELLED') return 'cancelled';
  return 'awaiting_approval';
}

// Reduce a PayPal order to the few facts the app is allowed to announce.
export function summarizeOrder(order) {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id,
    orderStatus: order.status, // CREATED, PAYER_ACTION_REQUIRED, APPROVED, COMPLETED…
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null, // COMPLETED, PENDING, DECLINED…
    captureReason: capture?.status_details?.reason ?? null,
    capturedAt: capture?.create_time ?? null,
  };
}
