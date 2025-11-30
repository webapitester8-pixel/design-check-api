export const config = {
  runtime: "edge", // required by Vercel for Edge functions
};

export default async function handler(req) {
  const headers = {
    "Access-Control-Allow-Origin": "*", // allow requests from anywhere
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // handle preflight requests for CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");

    if (!url) {
      return new Response(
        JSON.stringify({ status: "error", message: "URL is required" }),
        { headers, status: 400 }
      );
    }

    // Fetch website HTML
    const response = await fetch(url);
    const html = await response.text();

    // Minimal analysis (you can expand later)
    const result = {
      url,
      status: "success",
      length: html.length,
      sample: html.slice(0, 200), // first 200 chars
    };

    return new Response(JSON.stringify(result), { headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ status: "error", message: error.message }),
      { headers, status: 500 }
    );
  }
}
