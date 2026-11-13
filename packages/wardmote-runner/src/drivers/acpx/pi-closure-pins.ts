/**
 * Candidate closure pins from the isolated npm lock and official Node 24.21.0.
 * The non-Node graph is identical across targets, including platform resources.
 * Pi 1.0.0 dependency graphs were independently installed for all three targets.
 * Native platform execution and paid qualification remain separately required.
 * Changing any package, helper, extension or bootstrap requires regenerating all
 * three pins. Never accept a digest supplied only by an installed manifest.
 */
export const PI_DISTRIBUTION_CLOSURE_SHA256 = Object.freeze({
  "darwin-arm64": "806bfaf8f69bae8fe6804567335d0ed5df1cb7b89f1120f557e419a7b69e70ff",
  "darwin-x64": "820985dfcc92e387b7d13ba67d219dfa9e0c2dcea126fd7dbf1022fe158662eb",
  "linux-x64": "afb6d58a0ae42da1896827117104f6153ab3d5fa1cff91f37f58838a382f1967",
});
