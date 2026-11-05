// Sends a fictional bill from the app's Sandbox business account to the payer's Sandbox account,
// so the "pay a payment request" journey can be shown. Sandbox only, play money.
//   npm run demo:invoice -- 45.00 EUR "Électricité, novembre"
import { createPayPalClient } from '../src/paypal.js';

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PAYER_EMAIL } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_PAYER_EMAIL) {
  console.error('Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_PAYER_EMAIL (the Personal Sandbox account) in .env');
  process.exit(1);
}
const [amount = '45.00', currency = 'EUR', itemName = 'Électricité, facture de novembre'] = process.argv.slice(2);
const due = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);

const paypal = createPayPalClient({
  clientId: PAYPAL_CLIENT_ID,
  secret: PAYPAL_CLIENT_SECRET,
  baseUrl: process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com',
});

try {
  const inv = await paypal.createAndSendInvoice({
    recipientEmail: PAYPAL_PAYER_EMAIL,
    businessName: 'Électricité Démo (Sandbox)',
    itemName,
    amount,
    currency,
    dueDate: due,
    note: 'Facture fictive pour la démonstration de Kapyiŋi.',
  });
  console.log(`Invoice ${inv.id} sent to ${PAYPAL_PAYER_EMAIL}: ${inv.amount} ${inv.currency}, due ${inv.dueDate}`);
} catch (err) {
  console.error('Could not create the invoice:', err.status, err.issue || err.message, err.debugId || '');
  if (err.status === 403) console.error('Check that "Invoicing" is enabled in your Sandbox app features.');
  process.exit(1);
}
