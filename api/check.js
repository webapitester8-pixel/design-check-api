export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  const origin = req.headers.get("origin") || "*";

  const corsHeaders = {
    "Access-Control-Allow-Origin": origin, 
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl)
      return new Response(
        JSON.stringify({ error: "URL missing" }),
        { status: 400, headers: corsHeaders }
      );

    const response = await fetch(targetUrl);
    const text = await response.text();

    const data = {
      url: targetUrl,
      status: "success",
      length: text.length,
      sample: text.substring(0, 200),
    };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch external site" }),
      { status: 500, headers: corsHeaders }
    );
  }
}
