export const config = {
  runtime: "nodejs"
};

import * as cheerio from "cheerio";

/**
 * Helper: safe fetch with timeout
 */
async function safeFetch(url, opts = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

/**
 * Count words, sentences, approximate syllables for a readability score
 */
function countWords(text) {
  const words = text
    .replace(/\n/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}
function countSentences(text) {
  const matches = text.match(/[\.!?]+/g);
  return matches ? Math.max(matches.length, 1) : 1;
}
function countSyllablesInWord(word) {
  // Very naive heuristic for syllable counting
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  const vowels = "aeiouy";
  let syllables = 0;
  let prevWasVowel = false;
  for (let i = 0; i < word.length; i++) {
    const isVowel = vowels.includes(word[i]);
    if (isVowel && !prevWasVowel) {
      syllables++;
      prevWasVowel = true;
    } else if (!isVowel) {
      prevWasVowel = false;
    }
  }
  // subtract silent 'e'
  if (word.endsWith("e") && syllables > 1) syllables--;
  if (syllables === 0) syllables = 1;
  return syllables;
}
function countSyllables(text) {
  const words = text
    .replace(/\n/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 1000); // limit for speed
  let total = 0;
  for (const w of words) total += countSyllablesInWord(w);
  return total;
}
function fleschReadingEase(words, sentences, syllables) {
  // 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
  if (words === 0 || sentences === 0) return null;
  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return Math.round(score * 10) / 10;
}

/**
 * Basic link status check (HEAD then GET fallback)
 */
async function checkLinkStatus(url) {
  try {
    const res = await safeFetch(url, { method: "HEAD" }, 5000);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    // fallback to GET
    try {
      const res2 = await safeFetch(url, { method: "GET" }, 5000);
      return { ok: res2.ok, status: res2.status };
    } catch (err) {
      return { ok: false, status: null, error: err.message };
    }
  }
}

/**
 * Entry point
 */
export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  // normalize URL
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  try {
    // 1) fetch HTML
    const fetchResp = await safeFetch(parsedUrl.href, {}, 10000);
    const html = await fetchResp.text();
    const $ = cheerio.load(html);

    // 2) basic meta & headings
    const title = $("title").first().text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr("content") || null;

    const h1s = $("h1").map((i, el) => $(el).text().trim()).get();
    const h2s = $("h2").map((i, el) => $(el).text().trim()).get();

    // 3) design detectors (flexible heuristics)
    const header =
      $("header").length > 0 ||
      $("[class*='header']").length > 0 ||
      /<nav/i.test($.html().slice(0, 4000));
    const footer =
      $("footer").length > 0 ||
      $("[class*='footer']").length > 0 ||
      /\u00A9|copyright|©/i.test($.text().slice(-1000));
    const banner =
      $("[class*='hero']").length > 0 ||
      $("[class*='banner']").length > 0 ||
      $("[class*='slider']").length > 0 ||
      $("section").first().find("img").length > 0;
    const logo =
      $("img[alt*='logo']").length > 0 ||
      $("img[id*='logo']").length > 0 ||
      $("img[class*='logo']").length > 0 ||
      $("svg[aria-label*='logo'], svg[id*='logo'], svg[class*='logo']").length > 0;
    const navMenu =
      $("nav").length > 0 ||
      $("[class*='nav']").length > 0 ||
      $("ul li").length >= 3;
    const ctaFound =
      $("a:contains('call')").length > 0 ||
      $("a:contains('quote')").length > 0 ||
      $("a:contains('contact')").length > 0 ||
      $("button:contains('call')").length > 0 ||
      $("button:contains('quote')").length > 0 ||
      $("button:contains('contact')").length > 0 ||
      $("[class*='cta']").length > 0;

    // 4) images & alt
    const images = $("img").map((i, el) => ({
      src: $(el).attr("src") || $(el).attr("data-src") || null,
      alt: ($(el).attr("alt") || "").trim()
    })).get();
    const imagesMissingAlt = images.filter(img => !img.alt);

    // 5) contact info
    const text = $("body").text();
    const emails = Array.from(new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []).map(s=>s.toLowerCase())
    ));
    const phones = Array.from(new Set(
      (text.match(/(?:\+?\d{1,3})?[\s\-\(]*\d{2,4}[\s\-\)]*\d{3,4}[\s\-]*\d{3,4}/g) || []).map(s=>s.trim())
    ));

    // 6) links & broken link checks (limited)
    const anchors = $("a[href]").map((i, el) => $(el).attr("href")).get();
    // normalize and dedupe
    let links = Array.from(new Set(anchors))
      .filter(Boolean)
      .map(href => {
        try { return new URL(href, parsedUrl.href).href; } catch(e) { return null; }
      })
      .filter(Boolean);

    const MAX_LINK_CHECK = 20; // keep small to avoid timeouts
    const linksToCheck = links.slice(0, MAX_LINK_CHECK);

    const linkStatuses = {};
    await Promise.all(linksToCheck.map(async (lnk) => {
      try {
        const st = await checkLinkStatus(lnk);
        linkStatuses[lnk] = st;
      } catch (e) {
        linkStatuses[lnk] = { ok: false, status: null, error: e.message };
      }
    }));

    const brokenLinks = Object.entries(linkStatuses)
      .filter(([u, s]) => !s.ok)
      .map(([u, s]) => ({ url: u, ...s }));

    // 7) content metrics & readability
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const words = countWords(bodyText);
    const sentences = countSentences(bodyText);
    const syllables = countSyllables(bodyText);
    const flesch = fleschReadingEase(words, sentences, syllables);

    // 8) PageSpeed Insights (optional) using env var PAGESPEED_API_KEY
    let pagespeed = null;
    const PS_KEY = process.env.PAGESPEED_API_KEY;
    if (PS_KEY) {
      try {
        const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(parsedUrl.href)}&key=${PS_KEY}&strategy=mobile`;
        const pResp = await safeFetch(apiUrl, {}, 10000);
        pagespeed = await pResp.json();
      } catch (e) {
        pagespeed = { error: "PageSpeed fetch failed", details: e.message };
      }
    }

    // 9) aggregate issues & suggestions
    const issues = [];
    const suggestions = [];

    if (!header) { issues.push("Header not detected"); suggestions.push("Confirm the site has a distinct header section (<header> or .header)."); }
    if (!footer) { issues.push("Footer not detected"); suggestions.push("Add a footer with contact info and copyright text."); }
    if (!banner) { issues.push("Banner/Hero not detected"); suggestions.push("Consider a hero/banner for the main message on landing pages."); }
    if (!logo) { issues.push("Logo not detected"); suggestions.push("Add a visible logo image with alt text or an SVG labelled 'logo'."); }
    if (!navMenu) { issues.push("Navigation menu not detected"); suggestions.push("Add a main navigation (nav/ul) to help users find pages."); }
    if (!ctaFound) { issues.push("CTA not detected"); suggestions.push("Ensure primary CTAs like 'Call', 'Get Quote' or 'Contact' are visible."); }

    if (!metaDescription) { issues.push("Missing meta description"); suggestions.push("Add a concise meta description (120-160 chars)."); }
    if (!title) { issues.push("Missing title tag"); suggestions.push("Add a page title (between 30-60 characters)."); }

    if (imagesMissingAlt.length > 0) {
      issues.push(`${imagesMissingAlt.length} images missing alt attributes`);
      suggestions.push("Add descriptive alt attributes to decorative and content images.");
    }
    if (brokenLinks.length > 0) {
      issues.push(`${brokenLinks.length} potentially broken links (checked up to ${MAX_LINK_CHECK})`);
      suggestions.push("Fix or remove broken links; consider expanding link checks in a background job.");
    }
    if (words < 150) {
      suggestions.push("Low word count - consider adding more helpful, original content (aim 300+ words).");
    }

    // quick summary
    const summary = [
      `${title ? `Title: ${title}` : "No title"}`,
      `${metaDescription ? "Meta description present" : "No meta description"}`,
      `${h1s.length} H1(s), ${h2s.length} H2(s)`,
      `${words} words`,
      flesch ? `Readability (Flesch): ${flesch}` : "Readability score: N/A"
    ].join(" · ");

    // 10) response object
    const output = {
      url: parsedUrl.href,
      status: "success",
      meta: {
        title,
        metaDescription
      },
      headings: { h1: h1s, h2: h2s },
      design: {
        header, footer, banner, logo, navMenu, ctaFound
      },
      contact: { emails, phones },
      images: {
        total: images.length,
        missingAlt: imagesMissingAlt.slice(0, 30) // sample
      },
      links: {
        totalFound: links.length,
        checked: Object.keys(linkStatuses).length,
        brokenSample: brokenLinks.slice(0, 20)
      },
      content: {
        words,
        sentences,
        syllables,
        fleschReadingEase: flesch
      },
      pageSpeed: pagespeed,
      issues,
      suggestions,
      summary
    };

    return res.status(200).json(output);

  } catch (err) {
    return res.status(500).json({
      error: "Internal error fetching or processing URL",
      details: err.message
    });
  }
}
