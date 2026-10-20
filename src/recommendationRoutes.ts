import { Router } from "express";
import { z } from "zod";

const router = Router();

const requestSchema = z.object({
  interests: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(10).optional().default(5),
});

type AgentLog = {
  step: string;
  status: "success" | "info" | "warning" | "error";
  message: string;
  count?: number;
  durationMs?: number;
};

type QlooEntity = {
  entity_id?: string;
  name?: string;
  disambiguation?: string;
  properties?: {
    address?: string;
    description?: string;
    geocode?: { city?: string; country?: string; country_code?: string };
    primary_genre?: { id?: string; name?: string };
    localities?: Array<{ name?: string }>;
  };
};

type QlooSearchResponse = { results?: Array<{ entity_id?: string; name?: string }> };
type QlooInsightsResponse = {
  results?: { entities?: QlooEntity[]; [key: string]: unknown };
  [key: string]: unknown;
};

type Input = z.infer<typeof requestSchema>;
type QlooRunResult = {
  status: "success" | "no_matches";
  city: string;
  interests: string;
  matchedEntity: string | null;
  recommendationCount: number;
  recommendations: QlooEntity[];
  logs: AgentLog[];
};

function uniqueByName(entities: QlooEntity[]): QlooEntity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = entity.name?.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addLog(
  logs: AgentLog[],
  step: string,
  status: AgentLog["status"],
  message: string,
  extras: Pick<AgentLog, "count" | "durationMs"> = {}
) {
  logs.push({ step, status, message, ...extras });
}

/** A transparent, deterministic baseline. It does not call an LLM or invent venue names. */
function buildBaseline(input: Input) {
  const text = input.interests.toLowerCase();
  let category = "local experiences matching your interest";
  if (/gallery|galleries|art|museum|culture|heritage|exhibition/.test(text)) {
    category = "art galleries, museums, and cultural spaces";
  } else if (/restaurant|food|dining|vegetarian|vegan|cafe|eatery/.test(text)) {
    category = "restaurants and cafes matching your food preference";
  } else if (/park|nature|garden|outdoor/.test(text)) {
    category = "parks, gardens, and outdoor spaces";
  } else if (/music|concert|theatre|theater|show/.test(text)) {
    category = "music, theatre, and live-event venues";
  }

  return {
    mode: "without_qloo_baseline",
    source: "Deterministic keyword baseline; no Qloo lookup and no LLM call",
    status: "baseline_only",
    city: input.city,
    interests: input.interests,
    recommendations: [],
    explanation: `A generic baseline would suggest exploring ${category} in ${input.city}. It cannot verify specific venues, current entity metadata, or city-level matches without a data source.`,
  };
}

async function runQloo(input: Input): Promise<QlooRunResult> {
  const logs: AgentLog[] = [];
  const startedAt = Date.now();
  const apiKey = process.env.QLOO_API_KEY;
  const baseUrl = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
  const interests = input.interests;
  const city = input.city;
  const normalizedInterests = interests.toLowerCase();
  const cityName = city.trim().toLocaleLowerCase();

  addLog(logs, "query_received", "success", `Received interest '${interests}' for ${city}.`);
  if (!apiKey) {
    addLog(logs, "qloo_configuration", "error", "Qloo API key is not configured.");
    throw Object.assign(new Error("Qloo API is not configured on the server."), { logs, statusCode: 503 });
  }
  addLog(logs, "qloo_configuration", "success", "Qloo API key is configured; key value is never logged.");

  const isArtsSearch = /art|gallery|galleries|museum|culture|cultural|heritage|exhibition|theatre|theater|craft/i.test(interests);
  const isGalleryRequest = /gallery|galleries/i.test(interests);
  const isRestaurantRequest = /restaurant|restaurants|food|dining|vegetarian|vegan|cafe|eatery/i.test(interests);
  const isVegetarianRequest = /vegetarian|vegan|pure\s*veg|jain|शाकाहारी/i.test(interests);
  addLog(logs, "intent_classification", "success", `Classified request as ${isArtsSearch ? "arts/culture" : isRestaurantRequest ? "food/dining" : "general place discovery"}.`);

  let entityId: string | undefined;
  if (!isArtsSearch) {
    const searchStarted = Date.now();
    const searchUrl = new URL("/search", baseUrl);
    searchUrl.searchParams.set("query", `${interests} in ${city}, India`);
    searchUrl.searchParams.set("types", "urn:entity:place");
    addLog(logs, "qloo_search", "info", "Searching Qloo for a place entity to use as a relevance signal.");
    const searchResponse = await fetch(searchUrl, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!searchResponse.ok) {
      addLog(logs, "qloo_search", "error", `Qloo Search returned HTTP ${searchResponse.status}.`, { durationMs: Date.now() - searchStarted });
      throw Object.assign(new Error("Qloo entity search failed."), { logs, statusCode: 502 });
    }
    const searchData = (await searchResponse.json()) as QlooSearchResponse;
    const selectedEntity = searchData.results?.find((item) => item.entity_id);
    entityId = selectedEntity?.entity_id;
    addLog(logs, "qloo_search", entityId ? "success" : "warning", entityId ? `Selected entity signal: ${selectedEntity?.name ?? "unnamed entity"}.` : "No entity signal was found.", { count: searchData.results?.length ?? 0, durationMs: Date.now() - searchStarted });
    if (!entityId) {
      addLog(logs, "result", "warning", "No matching Qloo entity was found for the interest query.");
      return { status: "no_matches", city, interests, matchedEntity: null, recommendationCount: 0, recommendations: [], logs };
    }
  } else {
    addLog(logs, "qloo_search", "info", "Skipped text-entity signal for arts searches; using explicit category tags to reduce wrong-city matches.");
  }

  const params = new URLSearchParams({
    "filter.type": "urn:entity:place",
    "filter.location.query": city,
    take: String(input.limit),
  });
  if (isArtsSearch) {
    let artsTag: string;
    if (/museum/i.test(normalizedInterests)) artsTag = "urn:tag:genre:place:art_museum";
    else if (/culture|heritage/i.test(normalizedInterests) && !/gallery|galleries|art/i.test(normalizedInterests)) artsTag = "urn:tag:category:place:culture";
    else artsTag = "urn:tag:genre:place:art_gallery";
    params.set("filter.tags", artsTag);
    addLog(logs, "query_planning", "success", `Using Qloo category tag ${artsTag}.`);
  } else if (entityId) {
    params.set("signal.interests.entities", entityId);
    addLog(logs, "query_planning", "success", "Using the selected Qloo entity as an interest signal.");
  }
  if (isVegetarianRequest) {
    params.set("filter.tags", "urn:tag:genre:place:restaurant:vegetarian");
    addLog(logs, "dietary_filter", "info", "Applied the Qloo vegetarian restaurant tag. Returned data is not treated as a dietary guarantee.");
  }

  const insightsStarted = Date.now();
  addLog(logs, "qloo_insights", "info", "Requesting location-aware recommendations from Qloo Insights.");
  const insightsUrl = new URL("/v2/insights", baseUrl);
  insightsUrl.search = params.toString();
  const insightsResponse = await fetch(insightsUrl, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const responseText = await insightsResponse.text();
  if (!insightsResponse.ok) {
    addLog(logs, "qloo_insights", "error", `Qloo Insights returned HTTP ${insightsResponse.status}.`, { durationMs: Date.now() - insightsStarted });
    throw Object.assign(new Error("Qloo Insights request failed."), { logs, statusCode: 502 });
  }
  const qlooData = JSON.parse(responseText) as QlooInsightsResponse;
  let entities: QlooEntity[] = qlooData.results?.entities ?? [];
  addLog(logs, "qloo_insights", "success", "Received Qloo Insights response.", { count: entities.length, durationMs: Date.now() - insightsStarted });

  if (isArtsSearch && isGalleryRequest && entities.length < input.limit) {
    const fallbackStarted = Date.now();
    const fallbackParams = new URLSearchParams(params);
    fallbackParams.set("filter.tags", "urn:tag:genre:place:art_museum");
    const fallbackUrl = new URL("/v2/insights", baseUrl);
    fallbackUrl.search = fallbackParams.toString();
    addLog(logs, "category_fallback", "info", "Gallery results are limited; trying the related art-museum category.");
    const fallbackResponse = await fetch(fallbackUrl, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (fallbackResponse.ok) {
      const fallbackData = (await fallbackResponse.json()) as QlooInsightsResponse;
      const fallbackEntities = fallbackData.results?.entities ?? [];
      entities = uniqueByName([...entities, ...fallbackEntities]);
      addLog(logs, "category_fallback", "success", "Merged unique results from the related museum category.", { count: fallbackEntities.length, durationMs: Date.now() - fallbackStarted });
    } else {
      addLog(logs, "category_fallback", "warning", `Fallback returned HTTP ${fallbackResponse.status}; continuing with primary results.`, { durationMs: Date.now() - fallbackStarted });
    }
  }

  const beforeFiltering = uniqueByName(entities);
  addLog(logs, "deduplication", "success", "Removed duplicate or unnamed entities.", { count: beforeFiltering.length });
  const finalEntities = beforeFiltering.filter((entity) => {
    const properties = entity.properties;
    const name = entity.name?.toLowerCase() ?? "";
    const genre = properties?.primary_genre?.name?.toLowerCase() ?? "";
    const genreId = properties?.primary_genre?.id?.toLowerCase() ?? "";
    const address = properties?.address?.toLowerCase() ?? "";
    const geocodeCity = properties?.geocode?.city?.toLowerCase() ?? "";
    const country = properties?.geocode?.country?.toLowerCase() ?? "";
    const countryCode = properties?.geocode?.country_code?.toLowerCase() ?? "";
    const matchesCity = geocodeCity === cityName || address.includes(`${cityName},`) || address.includes(`${cityName} `) || address.startsWith(`${cityName} `);
    const isIndianPlace = country === "india" || countryCode === "in" || address.includes("india");
    const matchesRestaurant = /restaurant|food|dining|cafe|fast food|eatery|pizza|breakfast|sweets|ice cream|khaman|khichdi/i.test(`${name} ${genre}`);
    const matchesArts = /art gallery|gallery|museum|cultural centre|cultural center|art centre|art center|exhibition|theatre|theater/i.test(`${name} ${genre}`) || genreId.includes("art_gallery") || genreId.includes("art_museum") || genreId.includes(":museum");
    const matchesVegetarian = genreId === "urn:tag:genre:place:restaurant:vegetarian" || /vegetarian|vegan|pure\s*veg|jain|शाकाहारी/i.test(`${genre} ${properties?.description ?? ""}`);
    if (!matchesCity || !isIndianPlace) return false;
    if (isRestaurantRequest && !matchesRestaurant) return false;
    if (isVegetarianRequest && !matchesVegetarian) return false;
    if (isArtsSearch && !matchesArts) return false;
    return true;
  });
  addLog(logs, "location_category_validation", "success", "Applied city, India, and relevant-category checks.", { count: finalEntities.length });
  const limitedEntities = finalEntities.slice(0, input.limit);
  addLog(logs, "result", limitedEntities.length ? "success" : "warning", limitedEntities.length ? "Final recommendations are ready." : "Qloo returned data, but no results passed the strict validation checks.", { count: limitedEntities.length, durationMs: Date.now() - startedAt });

  return {
    status: limitedEntities.length > 0 ? "success" : "no_matches",
    city,
    interests,
    matchedEntity: limitedEntities[0]?.name ?? null,
    recommendationCount: limitedEntities.length,
    recommendations: limitedEntities,
    logs,
  } satisfies QlooRunResult;
}

// Existing endpoint: retains the existing /api/recommendations contract, with added trace metadata.
router.post("/", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please provide valid interests and city." });

  try {
    const result = await runQloo(parsed.data);
    return res.status(200).json({
      status: result.status,
      city: result.city,
      interests: result.interests,
      matchedEntity: result.matchedEntity,
      dietaryPreferenceVerified: /vegetarian|vegan|pure\s*veg|jain|शाकाहारी/i.test(result.interests) ? false : null,
      recommendations: { results: { entities: result.recommendations } },
      agent: { recommendationCount: result.recommendationCount, logs: result.logs },
      message: result.status === "no_matches" ? "No recommendations passed the current matching and validation rules." : undefined,
    });
  } catch (error) {
    const err = error as Error & { statusCode?: number; logs?: AgentLog[] };
    console.error("Qloo recommendation error:", err.message);
    return res.status(err.statusCode ?? 502).json({ error: err.message || "Unable to retrieve recommendations from Qloo.", agent: { logs: err.logs ?? [] } });
  }
});

// Comparison endpoint: POST /api/recommendations/compare
// Baseline is deliberately transparent and does not pretend to be a ChatGPT/LLM call.
router.post("/compare", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please provide valid interests and city." });

  const baseline = buildBaseline(parsed.data);
  const baselineLogs: AgentLog[] = [
    { step: "query_received", status: "success", message: "Same user input received for baseline comparison." },
    { step: "baseline_generation", status: "success", message: "Created a generic keyword-based suggestion; no named venues were invented." },
    { step: "data_limitations", status: "info", message: "Baseline does not verify real venue names, city metadata, or category tags." },
  ];

  try {
    const qloo = await runQloo(parsed.data);
    return res.status(200).json({
      query: { interests: parsed.data.interests, city: parsed.data.city, limit: parsed.data.limit },
      comparison: {
        withoutQloo: { ...baseline, logs: baselineLogs },
        withQloo: {
          mode: "with_qloo",
          source: "Qloo Search/Insights API plus application-side validation",
          status: qloo.status,
          city: qloo.city,
          interests: qloo.interests,
          matchedEntity: qloo.matchedEntity,
          recommendationCount: qloo.recommendationCount,
          recommendations: qloo.recommendations,
          explanation: "These are Qloo-returned entities that passed the app's current city, country, and category filters. A result count of zero is reported honestly.",
          logs: qloo.logs,
        },
      },
      summary: {
        baselineHasVerifiedVenueData: false,
        qlooVerifiedResultCount: qloo.recommendationCount,
        note: "The baseline is a deterministic non-Qloo comparison, not a ChatGPT model response. No model API is called by this endpoint.",
      },
    });
  } catch (error) {
    const err = error as Error & { statusCode?: number; logs?: AgentLog[] };
    console.error("Qloo comparison error:", err.message);
    return res.status(err.statusCode ?? 502).json({
      query: { interests: parsed.data.interests, city: parsed.data.city, limit: parsed.data.limit },
      comparison: { withoutQloo: { ...baseline, logs: baselineLogs }, withQloo: { status: "error", recommendations: [], logs: err.logs ?? [] } },
      error: err.message || "Unable to complete Qloo comparison.",
    });
  }
});

export default router;
