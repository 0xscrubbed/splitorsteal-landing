/**
 * webhook-worker.js — Tally → Notion CRM webhook
 *
 * Handles POST /webhook/tally
 * - Validates Tally form submission (formId: 7RDLEP)
 * - Extracts email from submission fields
 * - Creates a Lead entry in Notion (Temperature=Converted, Signed Up=true)
 * - Increments Signups count on matching Active campaign entries
 *
 * Secrets required (set via wrangler secret put):
 *   NOTION_API_KEY — Notion integration token
 *   TALLY_SIGNING_SECRET — optional, for payload verification
 *
 * Deploy: wrangler deploy --config wrangler.toml (or separate worker toml)
 */

const NOTION_VERSION = "2025-09-03";
const TALLY_FORM_ID = "7RDLEP";

// IDs from crm_config.json
const CAMPAIGNS_DB_ID = "be0318f0-0ec6-4974-ba2e-64787c1ba12b";
const LEADS_DB_ID = "847273f0-712e-408d-b54d-71f12502fa7e";
const INTERACTIONS_DB_ID = "dca42ad8-503b-4318-8dc3-2669c2ce9f07";

// ── Notion helpers ────────────────────────────────────────────────────────────

async function notionRequest(method, path, body, notionKey) {
  const resp = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    console.error(`[Notion] ${method} ${path} → ${resp.status}:`, text);
  }
  return data;
}

async function queryDatabase(dbId, filter, notionKey) {
  const resp = await notionRequest("POST", `databases/${dbId}/query`, { filter }, notionKey);
  return resp?.results || [];
}

// ── Extract email from Tally payload ─────────────────────────────────────────

function extractFromTally(payload) {
  /**
   * Tally webhook payload shape:
   * {
   *   formId: "7RDLEP",
   *   submissionId: "...",
   *   createdAt: "...",
   *   data: {
   *     fields: [
   *       { key: "question_...", label: "Email", value: "user@example.com" },
   *       ...
   *     ]
   *   }
   * }
   */
  const fields = payload?.data?.fields || payload?.fields || [];
  let email = null;
  let name = null;

  for (const field of fields) {
    const label = (field.label || field.title || "").toLowerCase();
    const key = (field.key || "").toLowerCase();
    const value = field.value || field.answer || "";

    if (label.includes("email") || key.includes("email")) {
      email = typeof value === "string" ? value.trim() : null;
    }
    if (label.includes("name") || key.includes("name")) {
      name = typeof value === "string" ? value.trim() : null;
    }
  }

  // Fallback: look for email-shaped string in any field
  if (!email) {
    for (const field of fields) {
      const value = String(field.value || "");
      if (value.includes("@") && value.includes(".")) {
        email = value.trim();
        break;
      }
    }
  }

  return { email, name };
}

// ── Create Lead ───────────────────────────────────────────────────────────────

async function createOrUpdateLead(email, name, notionKey, submissionId) {
  const today = new Date().toISOString().split("T")[0];

  // Check if lead already exists (by email)
  let existingLead = null;
  if (email) {
    const existing = await queryDatabase(LEADS_DB_ID, {
      property: "Email",
      email: { equals: email }
    }, notionKey);
    if (existing.length > 0) {
      existingLead = existing[0];
    }
  }

  if (existingLead) {
    // Update existing lead to Converted
    const currentCount = existingLead.properties?.["Interaction Count"]?.number || 0;
    await notionRequest("PATCH", `pages/${existingLead.id}`, {
      properties: {
        "Temperature": { select: { name: "Converted" } },
        "Signed Up": { checkbox: true },
        "Last Interaction": { date: { start: today } },
        "Interaction Count": { number: currentCount + 1 },
        "Contact Method": { select: { name: "Email" } },
      }
    }, notionKey);
    console.log(`[CRM] Updated existing lead ${email} → Converted`);
    return existingLead.id;
  }

  // Create new lead
  const handle = name ? name : (email ? email.split("@")[0] : "Tally Signup");
  const props = {
    "Handle": { title: [{ text: { content: handle } }] },
    "Platform": { select: { name: "Email" } },
    "Temperature": { select: { name: "Converted" } },
    "Signed Up": { checkbox: true },
    "First Interaction": { date: { start: today } },
    "Last Interaction": { date: { start: today } },
    "Interaction Count": { number: 1 },
    "Contact Method": { select: { name: "Email" } },
    "Notes": { rich_text: [{ text: { content: `Tally signup via splitsteal.app. Submission: ${submissionId || "unknown"}` } }] },
  };

  if (email) {
    props["Email"] = { email };
  }

  const resp = await notionRequest("POST", "pages", {
    parent: { database_id: LEADS_DB_ID },
    properties: props,
  }, notionKey);

  console.log(`[CRM] Created new lead for ${email || handle}`);
  return resp?.id;
}

// ── Create Interaction ────────────────────────────────────────────────────────

async function createSignupInteraction(email, name, notionKey, submissionId) {
  const today = new Date().toISOString().split("T")[0];
  const desc = `Tally signup: ${name || email || "unknown"}`;

  await notionRequest("POST", "pages", {
    parent: { database_id: INTERACTIONS_DB_ID },
    properties: {
      "Description": { title: [{ text: { content: desc } }] },
      "Date": { date: { start: today } },
      "Type": { select: { name: "Signup" } },
      "Platform": { select: { name: "Email" } },
      "Sentiment": { select: { name: "Positive" } },
      "Post URL": { url: "https://splitsteal.app" },
      "Content": { rich_text: [{ text: { content: `Email: ${email || "not provided"} | Name: ${name || "not provided"} | Submission: ${submissionId || "unknown"}` } }] },
      "Converted": { checkbox: true },
    }
  }, notionKey);
  console.log(`[CRM] Created signup interaction for ${email}`);
}

// ── Increment Campaign Signups ────────────────────────────────────────────────

async function incrementCampaignSignups(notionKey) {
  // Find all Active campaigns for Split or Steal
  const active = await queryDatabase(CAMPAIGNS_DB_ID, {
    property: "Status",
    select: { equals: "Active" }
  }, notionKey);

  for (const campaign of active) {
    const current = campaign.properties?.["Signups"]?.number || 0;
    await notionRequest("PATCH", `pages/${campaign.id}`, {
      properties: {
        "Signups": { number: current + 1 }
      }
    }, notionKey);
    console.log(`[CRM] Incremented signups on campaign ${campaign.id}: ${current} → ${current + 1}`);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

// ── PostHog reverse proxy ────────────────────────────────────────────────────

const POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_ASSETS_HOST = "https://us-assets.i.posthog.com";

async function handlePostHogProxy(request, pathname) {
  // Determine target: static assets go to assets host, everything else to main host
  const isAsset = pathname.startsWith("/ingest/static/");
  const targetHost = isAsset ? POSTHOG_ASSETS_HOST : POSTHOG_HOST;

  // Strip the /ingest prefix to get the real PostHog path
  const posthogPath = pathname.replace(/^\/ingest/, "");

  const targetUrl = new URL(posthogPath, targetHost);
  // Forward query params
  const origUrl = new URL(request.url);
  targetUrl.search = origUrl.search;

  // Clone headers, override host
  const headers = new Headers(request.headers);
  headers.set("Host", new URL(targetHost).host);
  headers.delete("cookie"); // Don't leak cookies

  const proxyReq = new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    redirect: "follow",
  });

  const resp = await fetch(proxyReq);

  // Clone response, add CORS headers
  const respHeaders = new Headers(resp.headers);
  respHeaders.set("Access-Control-Allow-Origin", "*");
  respHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  respHeaders.set("Access-Control-Allow-Headers", "Content-Type");
  // Cache static assets for 1 day
  if (isAsset) {
    respHeaders.set("Cache-Control", "public, max-age=86400");
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}

// ── A/B test helpers ──────────────────────────────────────────────────────────

const AB_VARIANTS = ["A", "B", "C"];
const AB_COOKIE_NAME = "ab_variant";
const AB_COOKIE_MAX_AGE = 2592000; // 30 days

function getVariantFromCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AB_COOKIE_NAME}=([ABC])`));
  return match ? match[1] : null;
}

function assignVariant() {
  const rand = Math.random();
  if (rand < 0.34) return "A";
  if (rand < 0.67) return "B";
  return "C";
}

function variantToAssetPath(variant) {
  switch (variant) {
    case "B": return "/variant-b.html";
    case "C": return "/variant-c.html";
    default:  return "/index.html";
  }
}

async function handleABTest(request, env) {
  let variant = getVariantFromCookie(request);
  const isNewVisitor = !variant;

  if (!variant) {
    variant = assignVariant();
  }

  const assetPath = variantToAssetPath(variant);
  const assetUrl = new URL(assetPath, request.url);
  const assetResp = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));

  // Clone response so we can modify headers
  const resp = new Response(assetResp.body, {
    status: assetResp.status,
    headers: new Headers(assetResp.headers),
  });

  // Set the variant cookie for new visitors
  if (isNewVisitor) {
    resp.headers.append(
      "Set-Cookie",
      `${AB_COOKIE_NAME}=${variant}; Max-Age=${AB_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`
    );
  }

  // Prevent CDN caching (A/B needs cookie) — but allow browser to cache for 2 min for repeat visits
  resp.headers.set("Cache-Control", "private, max-age=120");
  resp.headers.set("Vary", "Cookie");

  return resp;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── PostHog reverse proxy (/ingest/*) ──
    if (url.pathname.startsWith("/ingest")) {
      // Handle CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      return handlePostHogProxy(request, url.pathname);
    }

    // ── OG A/B test variants ──────────────────────────────────────────────────────

const OG_VARIANTS = {
  a: {
    title: "Someone in your group always underpays. Prove it.",
    description: "Dinner, rent, road trips, concert tickets — someone's getting away with it. Split or Steal reveals who. Join the waitlist.",
    image: "https://splitsteal.app/og-image-va.webp?v=5",
  },
  b: {
    title: "Would you steal from your friends?",
    description: "Every group has a freeloader. Split or Steal is the game that exposes them — bills, trips, rent, groceries. Coming soon.",
    image: "https://splitsteal.app/og-image-vb.webp?v=5",
  },
  c: {
    title: "Stop splitting bills with freeloaders.",
    description: "Rent, dinners, Ubers, group gifts — one person always underpays. Split or Steal makes it a game. Join the waitlist.",
    image: "https://splitsteal.app/og-image-vc.webp?v=5",
  },
};

const OG_ACTIVE_VARIANTS = ["a", "b", "c"];

function getRandomOGVariant() {
  return OG_ACTIVE_VARIANTS[Math.floor(Math.random() * OG_ACTIVE_VARIANTS.length)];
}

function injectOGTags(html, variant) {
  const v = OG_VARIANTS[variant] || OG_VARIANTS["a"];
  const utmSuffix = `?utm_source=twitter&utm_medium=social&utm_content=og-${variant}`;
  const ogUrl = `https://splitsteal.app${utmSuffix}`;

  const ogBlock = `
  <meta property="og:title" content="${v.title}" />
  <meta property="og:description" content="${v.description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${ogUrl}" />
  <meta property="og:image" content="${v.image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${v.title}" />
  <meta name="twitter:description" content="${v.description}" />
  <meta name="twitter:image" content="${v.image}" />
  <meta name="twitter:site" content="@0xscrubbed" />
  <meta name="twitter:creator" content="@0xscrubbed" />`;

  // Replace existing OG/Twitter meta tags block
  return html
    .replace(/<meta property="og:title"[^>]*\/>/g, "")
    .replace(/<meta property="og:description"[^>]*\/>/g, "")
    .replace(/<meta property="og:type"[^>]*\/>/g, "")
    .replace(/<meta property="og:url"[^>]*\/>/g, "")
    .replace(/<meta property="og:image"[^>]*\/>/g, "")
    .replace(/<meta property="og:image:width"[^>]*\/>/g, "")
    .replace(/<meta property="og:image:height"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:card"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:title"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:description"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:image"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:site"[^>]*\/>/g, "")
    .replace(/<meta name="twitter:creator"[^>]*\/>/g, "")
    .replace("</head>", `${ogBlock}\n</head>`);
}

// ── Social/bot crawlers: inject OG variant tags dynamically ──────────────────
    const ua = request.headers.get("User-Agent") || "";
    const isCrawler = /Twitterbot|facebookexternalhit|LinkedInBot|Googlebot|Slackbot|WhatsApp|TelegramBot|Discordbot|iMessage|iframely|Applebot|PinterestBot|redditbot/i.test(ua);
    if (isCrawler && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "")) {
      // Determine OG variant: use ?og= param if present, otherwise pick one inline (no redirect — bots handle redirects poorly)
      let ogVariant = url.searchParams.get("og");
      if (!ogVariant || !OG_ACTIVE_VARIANTS.includes(ogVariant)) {
        ogVariant = getRandomOGVariant();
      }

      // Fetch the base HTML and inject OG tags inline — never redirect crawlers
      const assetUrl = new URL("/index.html", request.url);
      const assetResp = await env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: request.headers }));
      const html = await assetResp.text();
      const modifiedHtml = injectOGTags(html, ogVariant);

      const resp = new Response(modifiedHtml, {
        status: 200,
        headers: new Headers(assetResp.headers),
      });
      resp.headers.set("Content-Type", "text/html; charset=UTF-8");
      resp.headers.set("Cache-Control", "public, max-age=3600");
      resp.headers.delete("Vary");
      return resp;
    }

    // ── IndexNow verification key ──
    if (url.pathname === "/c18a7c1605c7479284f1beb772108c7e.txt") {
      return new Response("c18a7c1605c7479284f1beb772108c7e", {
        headers: { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "public, max-age=86400" }
      });
    }

    // ── Sitemap and robots.txt — correct content types ──
    if (url.pathname === "/sitemap.xml") {
      const asset = await env.ASSETS.fetch(new Request(new URL("/sitemap.xml", request.url).toString(), request));
      const resp = new Response(asset.body, { status: asset.status, headers: new Headers(asset.headers) });
      resp.headers.set("Content-Type", "application/xml; charset=UTF-8");
      resp.headers.set("Cache-Control", "public, max-age=86400");
      return resp;
    }
    if (url.pathname === "/robots.txt") {
      const asset = await env.ASSETS.fetch(new Request(new URL("/robots.txt", request.url).toString(), request));
      const resp = new Response(asset.body, { status: asset.status, headers: new Headers(asset.headers) });
      resp.headers.set("Content-Type", "text/plain; charset=UTF-8");
      resp.headers.set("Cache-Control", "public, max-age=86400");
      return resp;
    }

    // ── A/B testing for root landing page ──
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return handleABTest(request, env);
    }

    // ── HTML extension fallback (since html_handling=none) ──
    if (!url.pathname.includes(".") && url.pathname !== "/") {
      const htmlPath = url.pathname + ".html";
      const htmlUrl = new URL(htmlPath, request.url);
      const htmlResp = await env.ASSETS.fetch(new Request(htmlUrl.toString(), request));
      if (htmlResp.status === 200) return htmlResp;
    }

    // Health check
    if (url.pathname === "/webhook/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", ts: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // ── Tally webhook endpoint ──
    if (url.pathname === "/webhook/tally") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      // Validate form ID
      const formId = payload?.formId || payload?.form_id || "";
      if (formId && formId !== TALLY_FORM_ID) {
        console.log(`[CRM] Ignoring submission for form ${formId} (expected ${TALLY_FORM_ID})`);
        return new Response(JSON.stringify({ ignored: true, reason: "wrong_form_id" }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      const notionKey = env.NOTION_API_KEY;
      if (!notionKey) {
        console.error("[CRM] NOTION_API_KEY secret not set");
        return new Response("Server misconfigured", { status: 500 });
      }

      const submissionId = payload?.submissionId || payload?.id || null;
      const { email, name } = extractFromTally(payload);

      console.log(`[CRM] Tally submission: email=${email}, name=${name}, id=${submissionId}`);

      try {
        // 1. Create or update Lead
        await createOrUpdateLead(email, name, notionKey, submissionId);

        // 2. Create Interaction entry
        await createSignupInteraction(email, name, notionKey, submissionId);

        // 3. Increment signups on active campaigns
        await incrementCampaignSignups(notionKey);

        return new Response(JSON.stringify({ success: true, email }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        console.error("[CRM] Error processing submission:", err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ── All other paths: pass through to static assets ──
    const assetResponse = await env.ASSETS.fetch(request);

    const contentType = assetResponse.headers.get("content-type") || "";
    const pathname = url.pathname;

    // For video files, add Content-Length header so external services (e.g. SchedPilot) can extract metadata
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      const body = await assetResponse.arrayBuffer();
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set("content-length", String(body.byteLength));
      newHeaders.set("accept-ranges", "bytes");
      // Videos: cache for 7 days — they don't change often
      newHeaders.set("Cache-Control", "public, max-age=604800, immutable");
      return new Response(body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: newHeaders,
      });
    }

    // Images and fonts: cache aggressively (30 days)
    const isImage = /\.(webp|png|jpg|jpeg|gif|svg|ico)$/i.test(pathname);
    const isFont = /\.(woff2|woff|ttf|eot)$/i.test(pathname);
    if (isImage || isFont) {
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set("Cache-Control", "public, max-age=2592000, immutable");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: newHeaders,
      });
    }

    // JS/CSS: cache for 7 days
    const isAsset = /\.(js|css|webmanifest)$/i.test(pathname);
    if (isAsset) {
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set("Cache-Control", "public, max-age=604800");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: newHeaders,
      });
    }

    return assetResponse;
  }
};
