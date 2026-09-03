import { MAX_OUTPUT_FILE_NAME_BYTES } from "../../../contracts/native-messages.js";

const OUTPUT_FILE_EXTENSION = ".mp4";
const encoder = new TextEncoder();

function formatTimestamp(date: Date): string | undefined {
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    byteLength += characterBytes;
  }
  return result;
}

function replaceDisallowedCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f
      ? "_"
      : character;
  }).join("");
}

function normalizePageTitle(title: string, maximumBytes: number): string | undefined {
  const sanitized = replaceDisallowedCharacters(title.normalize("NFC"))
    .trim()
    .replace(/^\.+/, "")
    .trim();
  const truncated = truncateUtf8(sanitized, maximumBytes).trim();
  return truncated === "" ? undefined : truncated;
}

export function createDefaultOutputFileName(
  pageTitle: string | undefined,
  savedAt: Date = new Date(),
): string | undefined {
  if (pageTitle === undefined) {
    return undefined;
  }
  const timestamp = formatTimestamp(savedAt);
  if (timestamp === undefined) {
    return undefined;
  }
  const suffix = `_${timestamp}${OUTPUT_FILE_EXTENSION}`;
  const title = normalizePageTitle(
    pageTitle,
    MAX_OUTPUT_FILE_NAME_BYTES - encoder.encode(suffix).byteLength,
  );
  return title === undefined ? undefined : `${title}${suffix}`;
}
