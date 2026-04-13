import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  pro: {
    name:        'PitchForge Pro',
    description: 'Unlimited emails, A/B variants, follow-up sequences',
    amount:      1900, // $19.00 in cents
  },
  team: {
    name:        'PitchForge Team',
    description: 'Everything in Pro, up to 10 seats, CRM integrations',
    amount:      7900, // $79.00 in cents
  },
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const plan = (req.query.plan || '').toLowerCase();

  if (!PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Use ?plan=pro or ?plan=team' });
  }

  const { name, description, amount } = PLANS[plan];
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency:   'usd',
            product_data: { name, description },
            unit_amount: amount,
            recurring:  { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url:  `${baseUrl}/#pricing-section`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    // Redirect straight to Stripe checkout
    return res.redirect(303, session.url);

  } catch (e) {
    console.error('Stripe error:', e);
    return res.status(500).json({ error: e.message || 'Could not create checkout session.' });
  }
}
