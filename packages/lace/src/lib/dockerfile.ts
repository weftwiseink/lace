// IMPLEMENTATION_VALIDATION
import { DockerfileParser } from "dockerfile-ast";

/**
 * Parse the USER directive from the final stage of a Dockerfile.
 * Scans instructions bottom-up: returns the first USER found before hitting
 * a FROM boundary, which corresponds to the last USER in the final stage.
 * Returns null if no USER directive exists in the final stage, if the content
 * is empty, or if the USER value contains an ARG/ENV reference ($).
 */
export function parseDockerfileUser(content: string): string | null {
  const dockerfile = DockerfileParser.parse(content);
  const instructions = dockerfile.getInstructions();

  for (let i = instructions.length - 1; i >= 0; i--) {
    const keyword = instructions[i].getKeyword();
    if (keyword === "USER") {
      const args = instructions[i].getArguments();
      if (args.length === 0) return null;
      // Extract the username (first argument token).
      // USER supports "user:group" format — take just the user part.
      const rawValue = args[0].getValue();
      const username = rawValue.split(":")[0];
      if (!username) return null;
      // If it contains a $ prefix, it's an ARG/ENV reference — treat as unresolvable.
      if (username.includes("$")) return null;
      return username;
    }
    if (keyword === "FROM") {
      // Reached the start of the final stage without finding USER
      return null;
    }
  }

  return null;
}
