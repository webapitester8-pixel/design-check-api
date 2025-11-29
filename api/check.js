export const config = {
  runtime: "nodejs"
};

export default async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  try {
    const response = await fetch(targetUrl);
    const html = await response.text();

    return res.json({
      status: "success",
      length: html.length,
      sample: html.substring(0, 200)
    });

  } catch (err) {
    return res.status(500).json({
      error: "Failed to fetch website",
      details: err.message
    });
  }
}
