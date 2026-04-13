import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICES = {
  pro:  'price_1TLrWrHqCn6sHMD7T1VZIF34',
  team: 'price_1TLrWvHqCn6sHMD7Bu4FQ7aH',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const plan = (req.query.plan || 'pro').toLowerCase();
  if (!PRICES[plan]) return res.status(400).json({ error: 'Invalid plan' });

  // Get auth token from query param (passed from dashboard)
  const token = req.query.token;
  if (!token) return res.redirect(302, '/login.html?redirect=upgrade');

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.redirect(302, '/login.html?redirect=upgrade');

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://pitchforge.co';

  try {
    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from('pf_profiles')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer:             customerId,
      payment_method_types: ['card'],
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      metadata:   { user_id: user.id, plan },
      allow_promotion_codes:      true,
      billing_address_collection: 'auto',
      success_url: `${baseUrl}/success/?plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/dashboard.html#upgrade`,
    });

    return res.redirect(303, session.url);

  } catch (e) {
    console.error('Checkout error:', e);
    return res.status(500).json({ error: e.message });
  }
}
