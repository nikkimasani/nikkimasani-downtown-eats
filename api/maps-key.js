// Vercel serverless function: hands the browser the Google Maps Platform key for the realistic 3D street view.
// Add GOOGLE_MAPS_KEY (a Google key restricted to the Map Tiles API and this site) or CESIUM_ION_TOKEN (a free
// Cesium ion token with Google Photorealistic 3D Tiles in its assets) to the Vercel project's environment variables. GET -> { ready:false } until then, and the app keeps its own drawn city.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const g = process.env.GOOGLE_MAPS_KEY, c = process.env.CESIUM_ION_TOKEN;   // either works: a Google key, or a free Cesium ion token (no billing)
  res.status(200).json(g ? { ready: true, provider: 'google', key: g } : c ? { ready: true, provider: 'cesium', key: c } : { ready: false });
}
