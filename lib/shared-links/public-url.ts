import "server-only";

import { isIP } from "node:net";

import {
  normalizeInstagramUrl,
  type NormalizedInstagramLink,
  SHARED_URL_MAX_BYTES,
} from "@/lib/shared-links/instagram";

export type NormalizedWebsiteLink = {
  provider: "website";
  contentKind: "link";
  url: string;
  host: string;
};

export type NormalizedSharedLink =
  | NormalizedInstagramLink
  | NormalizedWebsiteLink;

const RESERVED_HOST_SUFFIXES = new Set([
  "localhost",
  "local",
  "localdomain",
  "internal",
  "lan",
  "home",
  "test",
  "invalid",
  "example",
  "arpa",
]);

const IPV4_NON_PUBLIC_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

const IPV6_NON_PUBLIC_RANGES = [
  ["2001:db8:0:0:0:0:0:0", 32],
  ["2002:0:0:0:0:0:0:0", 16],
  ["3fff:0:0:0:0:0:0:0", 20],
] as const;

const IPV6_IETF_PUBLIC_EXCEPTIONS = [
  ["2001:1:0:0:0:0:0:1", 128],
  ["2001:1:0:0:0:0:0:2", 128],
  ["2001:1:0:0:0:0:0:3", 128],
  ["2001:3:0:0:0:0:0:0", 32],
  ["2001:4:112:0:0:0:0:0", 48],
  ["2001:20:0:0:0:0:0:0", 28],
  ["2001:30:0:0:0:0:0:0", 28],
] as const;

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function ipv4ToNumber(value: string): number | undefined {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part))
  ) {
    return undefined;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return undefined;
  return octets.reduce((result, octet) => result * 256 + octet, 0) >>> 0;
}

function isInIpv4Range(value: number, base: string, prefix: number) {
  const baseValue = ipv4ToNumber(base);
  if (baseValue === undefined) return false;
  const shift = 32 - prefix;
  return shift === 32
    ? true
    : Math.floor(value / 2 ** shift) === Math.floor(baseValue / 2 ** shift);
}

function expandIpv6(value: string): number[] | undefined {
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return undefined;

  const parseHalf = (half: string) => {
    if (!half) return [] as number[];
    const pieces = half.split(":");
    const result: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const ipv4 = ipv4ToNumber(piece);
        if (ipv4 === undefined) return undefined;
        result.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        result.push(Number.parseInt(piece, 16));
      } else {
        return undefined;
      }
    }
    return result;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }
  const groups = [...left, ...Array(missing).fill(0), ...right];
  if (groups.length !== 8) return undefined;
  return groups;
}

function isInIpv6Range(value: number[], base: string, prefix: number) {
  const baseValue = expandIpv6(base);
  if (baseValue === undefined) return false;
  const wholeGroups = Math.floor(prefix / 16);
  for (let index = 0; index < wholeGroups; index += 1) {
    if (value[index] !== baseValue[index]) return false;
  }
  const remainingBits = prefix % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (value[wholeGroups] & mask) === (baseValue[wholeGroups] & mask);
}

function assertPublicIpLiteral(hostname: string, rawHostname: string) {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (rawHostname !== hostname) {
      throw new Error("url must use a canonical IP address");
    }
    const value = ipv4ToNumber(hostname);
    if (
      value === undefined ||
      (!["192.0.0.9", "192.0.0.10"].includes(hostname) &&
        IPV4_NON_PUBLIC_RANGES.some(([base, prefix]) =>
          isInIpv4Range(value, base, prefix)
        ))
    ) {
      throw new Error("url hostname must be public");
    }
    return;
  }

  if (ipVersion === 6) {
    const value = expandIpv6(hostname);
    if (
      value === undefined ||
      !isInIpv6Range(value, "2000:0:0:0:0:0:0:0", 3) ||
      (isInIpv6Range(value, "2001:0:0:0:0:0:0:0", 23) &&
        !IPV6_IETF_PUBLIC_EXCEPTIONS.some(([base, prefix]) =>
          isInIpv6Range(value, base, prefix)
        )) ||
      IPV6_NON_PUBLIC_RANGES.some(([base, prefix]) =>
        isInIpv6Range(value, base, prefix)
      )
    ) {
      throw new Error("url hostname must be public");
    }
  }
}

function rawHostAndPortFromUrl(value: string) {
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  const withoutCredentials = authority.slice(authority.lastIndexOf("@") + 1);
  if (withoutCredentials.startsWith("[")) {
    const closingBracket = withoutCredentials.indexOf("]");
    if (closingBracket < 0) {
      return { hostname: withoutCredentials, port: undefined };
    }
    const remainder = withoutCredentials.slice(closingBracket + 1);
    return {
      hostname: withoutCredentials.slice(1, closingBracket),
      port: remainder.startsWith(":") ? remainder.slice(1) : undefined,
    };
  }
  const colon = withoutCredentials.lastIndexOf(":");
  return colon < 0
    ? { hostname: withoutCredentials, port: undefined }
    : {
        hostname: withoutCredentials.slice(0, colon),
        port: withoutCredentials.slice(colon + 1),
      };
}

function normalizeAndValidatePublicUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("url is required");
  }
  if (utf8Length(value) > SHARED_URL_MAX_BYTES) {
    throw new Error("url must be 4,096 UTF-8 bytes or fewer");
  }
  if (
    value !== value.trim() ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("url must be a valid absolute HTTPS URL");
  }
  if (!/^https:\/\//i.test(value)) {
    throw new Error("url must use HTTPS");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("url must be a valid absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:") throw new Error("url must use HTTPS");
  if (parsed.username || parsed.password) {
    throw new Error("url must not contain credentials");
  }

  const { hostname: rawHostname, port: rawPort } = rawHostAndPortFromUrl(value);
  if (!rawHostname || rawHostname.includes("%")) {
    throw new Error("url must contain a valid hostname");
  }
  if (
    rawPort !== undefined &&
    (!/^[0-9]+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
  ) {
    throw new Error("url must contain a valid port");
  }
  let hostname = parsed.hostname.toLowerCase();
  const bracketedIpv6 = hostname.startsWith("[") && hostname.endsWith("]");
  if (bracketedIpv6) hostname = hostname.slice(1, -1);

  const ipVersion = isIP(hostname);
  if (ipVersion > 0) {
    assertPublicIpLiteral(hostname, rawHostname.toLowerCase());
  } else {
    hostname = hostname.replace(/\.$/, "");
    const labels = hostname.split(".");
    if (
      labels.length < 2 ||
      hostname.length > 253 ||
      labels.some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
      )
    ) {
      throw new Error("url must contain a valid public hostname");
    }
    if (
      [...RESERVED_HOST_SUFFIXES].some(
        (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
      )
    ) {
      throw new Error("url hostname must be public");
    }
  }

  parsed.hostname = hostname;
  const normalizedPort = rawPort === undefined ? parsed.port : String(Number(rawPort));
  const urlHostname = ipVersion === 6 ? `[${hostname}]` : hostname;
  const normalizedUrl = `https://${urlHostname}${
    normalizedPort ? `:${normalizedPort}` : ""
  }${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (utf8Length(normalizedUrl) > SHARED_URL_MAX_BYTES) {
    throw new Error("url must be 4,096 UTF-8 bytes or fewer");
  }
  return { parsed, hostname, normalizedUrl };
}

export function normalizeSharedUrl(value: unknown): NormalizedSharedLink {
  const { hostname, normalizedUrl } = normalizeAndValidatePublicUrl(value);
  if (hostname === "instagram.com" || hostname === "www.instagram.com") {
    return normalizeInstagramUrl(normalizedUrl);
  }
  return {
    provider: "website",
    contentKind: "link",
    url: normalizedUrl,
    host: hostname,
  };
}
