export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ status: "error", message: "Missing URL" });
  }

  try {
    const response = await fetch(url);
    const text = await response.text();

    return res.status(200).json({
      status: "success",
      url,
      length: text.length,
      sample: text.substring(0, 500)
    });
  } catch (e) {
    return res.status(500).json({ status: "error", message: "Failed to fetch website" });
  }
}
