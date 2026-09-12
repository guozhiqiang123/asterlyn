export function compileDemoGlobs(
  kind: "include" | "exclude",
  sources: string[],
  encoder: TextEncoder,
): RegExp[] {
  if (sources.length > 32) {
    throw { kind: "invalidSearch", message: `Search accepts at most 32 ${kind} path patterns.` };
  }
  return sources.map((source) => {
    const invalidComponent = source.split("/").some((part) => part === "." || part === "..");
    if (
      source.length === 0 ||
      encoder.encode(source).length > 256 ||
      source.startsWith("/") ||
      /[\0\r\n\\{}]/u.test(source) ||
      source.includes("//") ||
      invalidComponent
    ) {
      throw {
        kind: "invalidSearch",
        message: `${kind} path patterns must be relative '/'-separated globs of at most 256 bytes.`,
      };
    }
    return new RegExp(`^${demoGlobSource(source)}$`, "u");
  });
}

function demoGlobSource(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing < 0) {
        throw { kind: "invalidSearch", message: `Invalid path pattern '${pattern}'.` };
      }
      const body = pattern.slice(index + 1, closing);
      const negated = body.startsWith("!");
      result += `[${negated ? "^" : ""}${body.slice(negated ? 1 : 0).replaceAll("/", "\\/")}]`;
      index = closing;
    } else {
      result += character.replace(/[.+^$()|]/gu, "\\$&");
    }
  }
  return result;
}
