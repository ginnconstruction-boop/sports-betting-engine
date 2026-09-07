export const PAPER_SETTLEMENT_VERSION = 'football-paper-settlement-v2';
export const PAPER_APPLICATION_RELEASE = 'college-phase2-settlement-15';

export type PaperResult = 'PENDING' | 'WIN' | 'LOSS' | 'PUSH' | 'VOID' | 'UNABLE_TO_GRADE' | 'REVIEW';
export type CurrentPaperResult = Exclude<PaperResult, 'REVIEW'>;

export const ELIGIBLE_FINAL_STATUSES = ['STATUS_FINAL', 'STATUS_FINAL_OVERTIME'] as const;
export const PENDING_EVENT_STATUSES = [
  'STATUS_SCHEDULED', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_DELAYED', 'STATUS_POSTPONED',
] as const;
export const VOID_EVENT_STATUSES = ['STATUS_CANCELED', 'STATUS_CANCELLED', 'STATUS_ABANDONED'] as const;

export interface SavedFullGameSelection {
  canonicalEventId: string;
  homeCanonicalId: string;
  awayCanonicalId: string;
  market: 'spreads' | 'totals';
  selectedSide: string;
  selectedTeamCanonicalId?: string;
  line: number;
  americanPrice: number;
}

export interface GameResultEvidence {
  sourceProvider: string;
  providerEventId: string | null;
  canonicalEventId: string | null;
  homeCanonicalId: string | null;
  awayCanonicalId: string | null;
  homeFinalScore: number | null;
  awayFinalScore: number | null;
  explicitStatus: string | null;
  statusCompleted: boolean | null;
  statusState: string | null;
  eventCompletionTimestamp: string | null;
  sourceRetrievalTimestamp: string;
  gradingTimestamp: string;
}

export interface DeterministicSettlement {
  result: CurrentPaperResult;
  note: string;
  actual?: number;
}

const includes = (values: readonly string[], value: string | null) => value !== null && values.includes(value);
const validScore = (value: number | null) => value !== null && Number.isInteger(value) && value >= 0;

/** Pure full-game settlement. It never reads a market, model, network source,
 * or mutable line. The caller must supply the archived selection and archived
 * result evidence. Full-game scores include overtime when the provider marks
 * the event STATUS_FINAL_OVERTIME. */
export function settleFullGame(selection: SavedFullGameSelection, evidence: GameResultEvidence): DeterministicSettlement {
  if (!selection.canonicalEventId || !selection.homeCanonicalId || !selection.awayCanonicalId
    || selection.homeCanonicalId === selection.awayCanonicalId
    || evidence.canonicalEventId !== selection.canonicalEventId
    || evidence.providerEventId !== selection.canonicalEventId
    || evidence.homeCanonicalId !== selection.homeCanonicalId
    || evidence.awayCanonicalId !== selection.awayCanonicalId) {
    return { result: 'UNABLE_TO_GRADE', note: 'Canonical event or home/away identity could not be established from the saved evidence.' };
  }

  if (includes(VOID_EVENT_STATUSES, evidence.explicitStatus)) {
    return { result: 'VOID', note: `Event has explicit invalidating status ${evidence.explicitStatus}; paper selection is void.` };
  }
  if (includes(PENDING_EVENT_STATUSES, evidence.explicitStatus)) {
    return { result: 'PENDING', note: `Event is not an eligible final (${evidence.explicitStatus}).` };
  }
  if (!includes(ELIGIBLE_FINAL_STATUSES, evidence.explicitStatus)
    || evidence.statusCompleted !== true || evidence.statusState !== 'post') {
    return { result: 'UNABLE_TO_GRADE', note: 'Result status is missing, unknown, or inconsistent with an approved explicit final.' };
  }
  if (!validScore(evidence.homeFinalScore) || !validScore(evidence.awayFinalScore)) {
    return { result: 'UNABLE_TO_GRADE', note: 'Verified final scores are missing or invalid; no loss was assumed.' };
  }
  if (!Number.isFinite(selection.line) || !Number.isFinite(selection.americanPrice) || Math.abs(selection.americanPrice) < 100) {
    return { result: 'UNABLE_TO_GRADE', note: 'The original saved line or American price is missing or invalid.' };
  }

  const homeScore = evidence.homeFinalScore as number;
  const awayScore = evidence.awayFinalScore as number;
  let actual: number;
  if (selection.market === 'totals') {
    if (!['Over', 'Under'].includes(selection.selectedSide)) {
      return { result: 'UNABLE_TO_GRADE', note: 'The original saved total side is invalid.' };
    }
    actual = homeScore + awayScore;
    return { result: actual === selection.line ? 'PUSH'
      : (selection.selectedSide === 'Over' ? actual > selection.line : actual < selection.line) ? 'WIN' : 'LOSS',
      actual, note: 'Deterministic full-game paper settlement against the original saved total; overtime included.' };
  }

  if (!selection.selectedTeamCanonicalId
    || ![selection.homeCanonicalId, selection.awayCanonicalId].includes(selection.selectedTeamCanonicalId)) {
    return { result: 'UNABLE_TO_GRADE', note: 'The selected team could not be tied to a saved canonical team ID.' };
  }
  const selectedMargin = selection.selectedTeamCanonicalId === selection.homeCanonicalId
    ? homeScore - awayScore : awayScore - homeScore;
  actual = selectedMargin + selection.line;
  return { result: actual === 0 ? 'PUSH' : actual > 0 ? 'WIN' : 'LOSS', actual,
    note: 'Deterministic full-game paper settlement against the original saved spread; overtime included.' };
}
