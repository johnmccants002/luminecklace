import "server-only";

export const INSTAGRAM_URL_MAX_LENGTH = 2048;

export const INSTAGRAM_CONTENT_KINDS = [
  "post",
  "reel",
  "story",
  "profile",
  "instagram_link",
] as const;

export type InstagramContentKind = (typeof INSTAGRAM_CONTENT_KINDS)[number];

export type NormalizedInstagramLink = {
  provider: "instagram";
  contentKind: InstagramContentKind;
  url: string;
  host: "instagram.com";
};

const TRACKING_PARAMETERS = new Set([
  "igsh",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
]);

const NON_PROFILE_PATHS = new Set([
  "about",
  "accounts",
  "challenge",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "oauth",
  "privacy",
  "reels",
  "stories",
  "terms",
  "tv",
  "web",
]);

function classifyInstagramPath(pathname: string): InstagramContentKind {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0]?.toLowerCase();

  if (first === "p" && segments.length >= 2) return "post";
  if ((first === "reel" || first === "tv") && segments.length >= 2) {
    return "reel";
  }
  if (first === "stories" && segments.length >= 2) return "story";
  if (
    segments.length === 1 &&
    first &&
    !NON_PROFILE_PATHS.has(first) &&
    !first.startsWith(".")
  ) {
    return "profile";
  }
  return "instagram_link";
}

export function normalizeInstagramUrl(value: unknown): NormalizedInstagramLink {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("url is required");
  }
  if (value.length > INSTAGRAM_URL_MAX_LENGTH) {
    throw new Error("url must be 2,048 characters or fewer");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("url must be a valid Instagram URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("url must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("url must not contain credentials");
  }
  if (
    parsed.hostname !== "instagram.com" &&
    parsed.hostname !== "www.instagram.com"
  ) {
    throw new Error("url must use instagram.com");
  }
  if (parsed.port) {
    throw new Error("url must not specify a port");
  }

  parsed.hostname = "instagram.com";
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }

  const normalizedPath = parsed.pathname.replace(/\/{2,}/g, "/");
  parsed.pathname =
    normalizedPath === "/"
      ? "/"
      : `${normalizedPath.replace(/\/+$/, "")}/`;

  const normalizedUrl = parsed.toString();
  if (normalizedUrl.length > INSTAGRAM_URL_MAX_LENGTH) {
    throw new Error("url must be 2,048 characters or fewer");
  }

  return {
    provider: "instagram",
    contentKind: classifyInstagramPath(parsed.pathname),
    url: normalizedUrl,
    host: "instagram.com",
  };
}
