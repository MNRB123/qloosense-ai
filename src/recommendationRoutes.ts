
import { Router } from "express";
import { z } from "zod";

const router = Router();

const requestSchema = z.object({
  interests: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(10).optional().default(5),
});

type QlooEntity = {
  name?: string;
  disambiguation?: string;
  properties?: {
    primary_genre?: {
      name?: string;
    };
    localities?: Array<{
      name?: string;
    }>;
  };
};

router.post("/", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Please provide valid interests and city.",
    });
  }

  const apiKey = process.env.QLOO_API_KEY;
  const baseUrl =
    process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";

  if (!apiKey) {
    return res.status(503).json({
      error: "Qloo API is not configured on the server.",
    });
  }

  try {
    const searchUrl = new URL("/search", baseUrl);
    const isArtsSearch =
  /art|gallery|galleries|museum|culture|cultural|heritage|exhibition/i.test(
    parsed.data.interests
  );

    const searchQuery = isArtsSearch
  ? `art gallery museum in ${parsed.data.city}, Gujarat, India`
  : `${parsed.data.interests} in ${parsed.data.city}, India`;

      searchUrl.searchParams.set("query", searchQuery);
      searchUrl.searchParams.set("types", "urn:entity:place");

    const searchResponse = await fetch(searchUrl, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!searchResponse.ok) {
      return res.status(502).json({
        error: "Qloo entity search failed.",
        upstreamStatus: searchResponse.status,
      });
    }

    const searchData = (await searchResponse.json()) as {
      results?: Array<{ entity_id?: string; name?: string }>;
    };

    console.log("Search query:", searchUrl.toString());
    console.log("Qloo search candidates:", JSON.stringify(searchData.results, null, 2));

    console.log(
    "Qloo search candidates:",
      searchData.results?.slice(0, 10).map((item) => ({
      name: item.name,
      entity_id: item.entity_id,
    }))
    );




const candidates = searchData.results ?? [];


const selectedEntity = isArtsSearch
  ? candidates.find((item) =>
      /art gallery|gallery|museum|cultural centre|cultural center|art centre|art center/i.test(
        item.name ?? ""
      )
    )
  : candidates[0];

console.log(
  "Qloo search candidates:",
  candidates.map((item) => ({
    name: item.name,
    entity_id: item.entity_id,
  }))
);

console.log(
  "Selected Qloo entity:",
  selectedEntity?.name ?? "No suitable entity found"
);

const entityId = selectedEntity?.entity_id;


console.log(
  "Selected Qloo entity:",
  selectedEntity?.name ?? "No suitable entity found",
  entityId ?? ""
);

    if (!entityId) {
      return res.status(200).json({
        status: "no_matches",
        recommendations: [],
        message: "No matching Qloo entities were found.",
      });
    }

const isVegetarianRequest =
  /vegetarian|vegan|pure veg|jain|à¤¶à¤¾à¤•à¤¾à¤¹à¤¾à¤°à¥€/i.test(
    parsed.data.interests
  );



const params = new URLSearchParams({
  "filter.type": "urn:entity:place",
  "filter.location.query": parsed.data.city,
  take: String(parsed.data.limit),
});

if (isArtsSearch) {
  const interests = parsed.data.interests.toLowerCase();

  const artsTag = /museum/i.test(interests)
    ? "urn:tag:genre:place:museum"
    : /culture|heritage/i.test(interests) &&
        !/gallery|galleries|art/i.test(interests)
      ? "urn:tag:category:place:culture"
      : "urn:tag:genre:place:art_gallery";

  params.set("filter.tags", artsTag);
} else {
  params.set("signal.interests.entities", entityId);
}



if (isVegetarianRequest) {
  params.set(
    "filter.tags",
    "urn:tag:genre:place:restaurant:vegetarian"
  );
}

    const insightsUrl = new URL("/v2/insights", baseUrl);
    insightsUrl.search = params.toString();

    console.log("Qloo Insights URL:", insightsUrl.toString());
    console.log("Qloo matched entity:", searchData.results?.[0]);

    const insightsResponse = await fetch(insightsUrl, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });

    const responseText = await insightsResponse.text();

    if (!insightsResponse.ok) {
      return res.status(502).json({
        error: "Qloo Insights request failed.",
        upstreamStatus: insightsResponse.status,
        details: responseText.slice(0, 500),
      });
    }

    const qlooData = JSON.parse(responseText);
    const entities: QlooEntity[] = qlooData?.results?.entities ?? [];
    console.log("Raw Qloo entity count:", entities.length);
    console.log(
  "Raw Qloo entities:",
  entities.map((entity) => {
    const properties = entity.properties as {
      address?: string;
      geocode?: { city?: string };
      primary_genre?: { id?: string; name?: string };
    } | undefined;

    return {
      name: entity.name,
      address: properties?.address,
      city: properties?.geocode?.city,
      genre: properties?.primary_genre?.name,
      genreId: properties?.primary_genre?.id,
    };
  })
);

    const cityName = parsed.data.city.toLowerCase();

    const isRestaurantRequest =
      /restaurant|restaurants|food|dining|vegetarian|vegan/i.test(
        parsed.data.interests
      );


const filteredEntities = entities.filter((entity) => {
  const properties = entity.properties as {
    address?: string;
    geocode?: {
      city?: string;
      country?: string;
    };
    primary_genre?: {
      name?: string;
      id?: string;
    };
  } | undefined;

  const genre =
    properties?.primary_genre?.name?.toLowerCase() ?? "";

  const address =
    properties?.address?.toLowerCase() ?? "";

  const geocodeCity =
    properties?.geocode?.city?.toLowerCase() ?? "";

  const isIndianPlace =
    properties?.geocode?.country?.toLowerCase() === "india" ||
    address.includes("india");

  const matchesCity =
    geocodeCity === cityName ||
    address.includes(cityName);

  const matchesRestaurant =
    /restaurant|food|dining|cafe|fast food|eatery|pizza|breakfast|sweets|ice cream/i.test(
      genre
    );

  const description =
  (properties as { description?: string } | undefined)
    ?.description?.toLowerCase() ?? "";

const matchesVegetarian =
  properties?.primary_genre?.id ===
    "urn:tag:genre:place:restaurant:vegetarian" ||
  /vegetarian|vegan|pure.?veg|jain/i.test(
    `${genre} ${description}`
  );

  return (
    isIndianPlace &&
    matchesCity &&
    (!isRestaurantRequest || matchesRestaurant) &&
    (!isVegetarianRequest || matchesVegetarian)
  );
});


const interestText = parsed.data.interests.toLowerCase();

const isArtsRequest =
  /art|gallery|galleries|museum|cultural|culture|heritage|exhibition|theatre|theater|craft/i.test(
    interestText
  );

const relevantEntities = entities.filter((entity) => {
  const properties = entity.properties as {
    address?: string;
    geocode?: { city?: string; country?: string };
    primary_genre?: { name?: string; id?: string };
  } | undefined;

  const name = entity.name?.toLowerCase() ?? "";
  const genre = properties?.primary_genre?.name?.toLowerCase() ?? "";
  const address = properties?.address?.toLowerCase() ?? "";
  const geocodeCity = properties?.geocode?.city?.toLowerCase() ?? "";

  const matchesCity =
    geocodeCity.includes(cityName) || address.includes(cityName);

  const matchesRestaurant =
    /restaurant|food|dining|cafe|fast food|eatery|pizza|breakfast|sweets|ice cream|khaman|khichdi/i.test(
      `${name} ${genre}`
    );

  const matchesArts =
    /art gallery|gallery|museum|cultural centre|cultural center|heritage site|art museum|exhibition space|art centre|art center|theatre|theater/i.test(
      `${name} ${genre}`
    );

  const matchesRequestedCategory = isRestaurantRequest
    ? matchesRestaurant
    : isArtsRequest
      ? matchesArts
      : true;

  return matchesCity && matchesRequestedCategory;
});

const finalEntities = isArtsRequest
  ? relevantEntities
  : relevantEntities.length > 0
    ? relevantEntities
    : filteredEntities;



    return res.status(200).json({
      status: finalEntities.length > 0 ? "success" : "no_matches",
      city: parsed.data.city,
      interests: parsed.data.interests,
      dietaryPreferenceVerified: isVegetarianRequest
  ? false
  : null,
      matchedEntity: searchData.results?.[0]?.name,
      recommendations: {
        ...qlooData,
        results: {
          ...qlooData.results,
          entities: finalEntities,
        },
      },
    });
  } catch (error) {
    console.error(
      "Qloo recommendation error:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return res.status(502).json({
      error: "Unable to retrieve recommendations from Qloo.",
    });
  }
});

export default router;
