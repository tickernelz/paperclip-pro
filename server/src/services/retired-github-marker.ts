export const RETIRED_GITHUB_MARKER_PREFIX = "<!-- paperclip-";

export function withRetiredGitHubMarker(marker: string): string[] {
  return [marker, marker.replace(/^<!-- wardmote-/, RETIRED_GITHUB_MARKER_PREFIX)];
}
