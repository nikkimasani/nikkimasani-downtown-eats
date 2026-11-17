// Vercel serverless function: lets the web version use Claude for "Ask" and "What should I order here?".
// Set ANTHROPIC_API_KEY in the Vercel project's environment variables to turn it on.
// GET -> { ready } so the page can hide the Ask tab when no key is set.
export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (req.method === 'GET') return res.status(200).json({ ready: Boolean(key) });
  if (req.method !== 'POST') return res.status(405).end();
  if (!key) return res.status(501).json({ error: 'ANTHROPIC_API_KEY is not set' });
  const { prompt } = req.body || {};
  if (typeof prompt !== 'string' || !prompt || prompt.length > 60000) return res.status(400).json({ error: 'bad prompt' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status });
  const j = await r.json();
  res.status(200).json({ text: (j.content || []).map((c) => c.text || '').join('') });
}
