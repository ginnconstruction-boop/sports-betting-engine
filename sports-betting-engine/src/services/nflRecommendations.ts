import { getUserBookKeys } from '../config/bookmakers';
import { NflMarketBoard, MarketBoardError } from './nflMarketBoard';
import { NflResearch } from './nflResearch';
import { NflPaperLedger, PAPER_RULES } from './nflPaper';
import { assessNflQuote, buildNflForecast, NFL_FORECAST_VERSION } from './nflForecast';
import { exactMarketBaseline } from './footballMarketBaseline';
import { NflEvidenceArchive } from './nflEvidence';

export class NflRecommendations {
  private busy = false;
  constructor(private board: NflMarketBoard, private research: Pick<NflResearch, 'forecastInputs'>,
    private ledger: NflPaperLedger, private books = getUserBookKeys(), private now = () => Date.now(),
    private archive?: NflEvidenceArchive) {}
  async run(eventId: string, group: string, quoteId: string, rules: string) {
    if (rules !== PAPER_RULES) throw new MarketBoardError('Acknowledge the paper rules before generating an automatically tracked recommendation.');
    const selection = this.board.playerQuotes(eventId, group, quoteId);
    const old = this.ledger.modelPick(eventId, selection.quote.participant, selection.quote.market, NFL_FORECAST_VERSION);
    if (old) return { status: 'already_tracked', pick: old, forecast: old.forecast, assessments: [], books: this.books };
    if (this.busy) throw new MarketBoardError('Another NFL forecast is running. Please wait.', 409);
    this.busy = true;
    try {
      const input = await this.research.forecastInputs(selection.event, selection.quote.participant, selection.quote.market);
      const forecast = buildNflForecast(input, selection.event, selection.quote.market, this.now());
      const marketBaselines = selection.quotes.map(q => exactMarketBaseline(selection.event, q, selection.quotes, this.now()));
      const evidence = this.archive?.record({ event: selection.event, input, forecast, quotes: selection.quotes, marketBaselines });
      // Re-validate the server cache after potentially slow data calls.
      this.board.selection(eventId, group, quoteId);
      const assessments = selection.quotes.map(q => assessNflQuote(forecast, q, this.books, this.now()));
      const candidates = assessments.filter(a => a.eligible).sort((a, b) => b.estimatedEV - a.estimatedEV
        || a.quote.bookKey.localeCompare(b.quote.bookKey) || a.quote.side.localeCompare(b.quote.side) || a.quote.line - b.quote.line);
      if (!candidates.length) return { status: 'no_recommendation', forecast, assessments, books: this.books, marketBaselines, evidence };
      const best = candidates[0];
      // The user sees an issued recommendation only after durable logging succeeds.
      const saved = await this.ledger.saveModel(selection.event, best.quote, forecast, best, rules);
      return { status: saved.duplicate ? 'already_tracked' : 'paper_recommendation', pick: saved.pick,
        forecast: saved.pick.forecast, assessments, books: this.books, marketBaselines, evidence };
    } catch (error) {
      this.archive?.record({ event: selection.event, quote: selection.quote, requestedAt: new Date(this.now()).toISOString(),
        status: 'failed_before_issuance', reason: 'Data, identity, cache or persistence check failed. No issued recommendation.' });
      throw error;
    } finally { this.busy = false; }
  }
}
