const DEFAULT_MAX_CANDIDATES_PER_TAB = 100;

export interface Candidate {
  url: string;
  detectedAt: number;
}

export function isHlsPlaylistUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

export class CandidateStore {
  private readonly candidatesByTab = new Map<number, Map<string, Candidate>>();

  constructor(private readonly maxCandidatesPerTab = DEFAULT_MAX_CANDIDATES_PER_TAB) {
    if (!Number.isInteger(maxCandidatesPerTab) || maxCandidatesPerTab < 1) {
      throw new RangeError("maxCandidatesPerTab must be a positive integer");
    }
  }

  add(tabId: number, url: string, detectedAt = Date.now()): void {
    let candidates = this.candidatesByTab.get(tabId);
    if (!candidates) {
      candidates = new Map();
      this.candidatesByTab.set(tabId, candidates);
    }

    const existing = candidates.get(url);
    if (existing) {
      existing.detectedAt = detectedAt;
      return;
    }

    if (candidates.size >= this.maxCandidatesPerTab) {
      const oldestUrl = candidates.keys().next().value;
      if (oldestUrl !== undefined) {
        candidates.delete(oldestUrl);
      }
    }

    candidates.set(url, { url, detectedAt });
  }

  list(tabId: number): Candidate[] {
    return Array.from(this.candidatesByTab.get(tabId)?.values() ?? []);
  }

  deleteTab(tabId: number): void {
    this.candidatesByTab.delete(tabId);
  }
}
