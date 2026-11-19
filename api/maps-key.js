// Vercel serverless function: hands the browser the Google Maps Platform key for the realistic 3D street view.
// Add GOOGLE_MAPS_KEY to the Vercel project's environment variables (a key restricted to the Map Tiles API and
// to this site's address). GET -> { ready:false } until then, and the app keeps its own drawn city.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.GOOGLE_MAPS_KEY;
  res.status(200).json(key ? { ready: true, key } : { ready: false });
}
