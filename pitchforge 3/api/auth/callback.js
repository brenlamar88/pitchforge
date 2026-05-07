export default function handler(req, res) {
  // Supabase handles the token exchange client-side via the JS SDK.
  // This endpoint just redirects to the dashboard where the SDK
  // picks up the session from the URL fragment automatically.
  return res.redirect(302, '/dashboard.html');
}
