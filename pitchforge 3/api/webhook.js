import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId  = session.metadata?.user_id;
    const plan    = session.metadata?.plan || 'pro';
    const customerId     = session.customer;
    const subscriptionId = session.subscription;

    if (!userId) {
      console.error('No user_id in session metadata');
      return res.status(400).json({ error: 'Missing user_id in metadata' });
    }

    const { error } = await supabase
      .from('pf_profiles')
      .update({
        plan,
        stripe_customer_id:     customerId,
        stripe_subscription_id: subscriptionId,
        subscription_status:    'active',
        updated_at:             new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('Supabase update error:', error);
      return res.status(500).json({ error: 'Failed to update user plan' });
    }

    console.log(`User ${userId} upgraded to ${plan}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const { error } = await supabase
      .from('pf_profiles')
      .update({
        plan:                'free',
        subscription_status: 'cancelled',
        stripe_subscription_id: null,
        updated_at:          new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) console.error('Downgrade error:', error);
  }

  return res.status(200).json({ received: true });
}
