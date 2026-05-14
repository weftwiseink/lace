// IMPLEMENTATION_VALIDATION
//
// Sub-check: scans resolved feature metadata for ports declaring
// `portlessAlias: true`, cross-references those declarations against
// the live port allocations, runs a generic host-port-availability
// probe, and emits a forward-looking informational pointer.
//
// v1 semantics: the check is purely diagnostic. It makes no system
// changes. The presence of the flag does not alter `lace up` runtime
// behaviour. The follow-up RFP
// `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md`
// will introduce host-side consumers that act on the flag.
import {
  type FeatureMetadata,
  extractLaceCustomizations,
} from "./feature-metadata";
import {
  type PortAllocation,
  isPortAvailable,
} from "./port-allocator";
import { extractFeatureShortId } from "./template-resolver";

export interface PortlessAliasFinding {
  /** Allocation label (e.g., `portless/proxyPort`). */
  label: string;
  /** Lace-allocated host port (22425-22499). */
  port: number;
  /** Whether the port is currently free or held by the project's own container. */
  available: boolean;
  /** Project name used for the alias URL hint. */
  projectName: string;
}

export interface PortlessAliasCheckResult {
  findings: PortlessAliasFinding[];
  /** Human-readable lines, in emission order. */
  messages: string[];
}

/**
 * Run the portlessAlias sub-check.
 *
 * For each feature port declaring `portlessAlias: true`:
 *   1. Locate the corresponding live allocation by label
 *      (`${featureShortId}/${optionName}`).
 *   2. Probe whether the host port is bound by something other than
 *      this project's own running container.
 *   3. Emit a one-line informational pointer to the follow-up RFP so
 *      the user is not surprised by port-suffix URLs.
 *
 * Returns the findings and a list of messages (info + warn) intended
 * for stdout. Callers decide how to surface them.
 */
export async function checkPortlessAliases(opts: {
  metadataMap: Map<string, FeatureMetadata | null>;
  allocations: PortAllocation[];
  ownedPorts: Set<number>;
  projectName: string;
}): Promise<PortlessAliasCheckResult> {
  const { metadataMap, allocations, ownedPorts, projectName } = opts;
  const findings: PortlessAliasFinding[] = [];
  const messages: string[] = [];

  const allocationsByLabel = new Map<string, PortAllocation>();
  for (const a of allocations) {
    allocationsByLabel.set(a.label, a);
  }

  for (const [fullRef, metadata] of metadataMap) {
    if (!metadata) continue;
    const shortId = extractFeatureShortId(fullRef);
    const laceCustom = extractLaceCustomizations(metadata);
    if (!laceCustom?.ports) continue;

    for (const [optionName, decl] of Object.entries(laceCustom.ports)) {
      if (decl.portlessAlias !== true) continue;
      const label = `${shortId}/${optionName}`;
      const allocation = allocationsByLabel.get(label);
      if (!allocation) {
        // The flag was declared but no allocation exists. This can
        // happen if the feature is declared but `${lace.port()}`
        // injection did not fire. Surface a soft warning rather than
        // a hard error.
        messages.push(
          `warn: portlessAlias declared on ${label} but no host-port allocation was made; skipping availability check.`,
        );
        continue;
      }

      const available =
        ownedPorts.has(allocation.port) ||
        (await isPortAvailable(allocation.port));
      findings.push({
        label,
        port: allocation.port,
        available,
        projectName,
      });

      messages.push(
        `info: portless feature detected (alias=${projectName}); URLs include the host port suffix in v1.`,
      );
      messages.push(
        `info: see cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md for clean-URL routing.`,
      );
      if (available) {
        messages.push(
          `info: host port ${allocation.port} is free (or held by this project's container).`,
        );
      } else {
        messages.push(
          `warn: host port ${allocation.port} is held by an unrelated process; ` +
            `lace up may re-allocate, or you can free the port and retry.`,
        );
      }
    }
  }

  return { findings, messages };
}
