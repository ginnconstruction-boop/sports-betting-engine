import { gunzipSync } from 'zlib';
import { CollegeModelConfig, CollegeResult, evaluateCollegeSeason } from './collegeScoreModel';

export const NFL_GAME_LINE_RESEARCH_VERSION = 'nfl-game-line-ridge-research-v1';
export const NFLVERSE_SCHEDULE_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz';

export interface NflScheduleResult extends CollegeResult {
  spreadLine: number | null;
  totalLine: number | null;
}

function csv(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true; else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  if (quoted) throw Error('Unclosed NFL schedule CSV field.'); return rows;
}
const numeric = (value: string) => value.trim() === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

export function parseNflverseGameResults(text: string) {
  const data = csv(text), headers = data.shift() ?? [], required = ['game_id','season','game_type','week','gameday','away_team','away_score','home_team','home_score','location','result','spread_line','total_line'];
  if (required.some(name => !headers.includes(name))) throw Error('nflverse schedule schema changed.');
  const at = (name: string) => headers.indexOf(name), games: NflScheduleResult[] = [], seen = new Set<string>();
  for (const values of data) {
    if (values[at('game_type')] !== 'REG') continue;
    const season = numeric(values[at('season')]), week = numeric(values[at('week')]), homeScore = numeric(values[at('home_score')]), awayScore = numeric(values[at('away_score')]);
    if (season === null || week === null || homeScore === null || awayScore === null) continue;
    const id = values[at('game_id')], home = values[at('home_team')], away = values[at('away_team')], location = values[at('location')];
    const day = values[at('gameday')];
    if (!id || seen.has(id) || !home || !away || home === away || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !['Home','Neutral'].includes(location)
      || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0
      || numeric(values[at('result')]) !== homeScore - awayScore) throw Error(`Invalid or duplicate nflverse schedule result: ${id || 'missing ID'}.`);
    // Calendar day, not an invented UTC kickoff. Evaluation excludes the
    // entire target day before fitting, so same-day results cannot leak.
    seen.add(id); games.push({ id, date: `${day}T12:00:00.000Z`, season, homeId: home, awayId: away,
      homeName: home, awayName: away, homeScore, awayScore, neutral: location === 'Neutral', spreadLine: numeric(values[at('spread_line')]), totalLine: numeric(values[at('total_line')]) });
  }
  return games.sort((a,b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
}

const metric = (values: number[]) => ({ count: values.length, mae: values.length ? values.reduce((n,v)=>n+Math.abs(v),0)/values.length : null,
  rmse: values.length ? Math.sqrt(values.reduce((n,v)=>n+v*v,0)/values.length) : null });

export function evaluateNflGameLineSeason(games: NflScheduleResult[], season: number, config: CollegeModelConfig) {
  const result = evaluateCollegeSeason(games, season, config), byId = new Map(games.map(game => [game.id, game]));
  const rows = result.rows.map(row => {
    const game = byId.get(row.id)!, marketMargin = game.spreadLine;
    const disagreement = marketMargin === null ? null : row.projection.homeMargin - marketMargin;
    const ats = disagreement === null || Math.abs(disagreement) < 2 ? 'PASS'
      : row.margin === marketMargin ? 'PUSH'
      : (row.margin > marketMargin) === (disagreement > 0) ? 'WIN' : 'LOSS';
    return { id: row.id, date: row.date, actualMargin: row.margin, modelMargin: row.projection.homeMargin, naiveMargin: row.projection.naiveMargin,
      marketMargin, modelError: row.marginError, naiveError: row.naiveMarginError,
      marketError: marketMargin === null ? null : row.margin - marketMargin, disagreement, ats };
  });
  const marketRows = rows.filter(row => row.marketError !== null), selections = rows.filter(row => row.ats !== 'PASS');
  const buckets = [[0,3],[3,6],[6,10],[10,Infinity]].map(([from,to]) => {
    const selected = rows.filter(row => row.disagreement !== null && Math.abs(row.disagreement) >= from && Math.abs(row.disagreement) < to);
    return { from, to: Number.isFinite(to) ? to : null, games: selected.length, wins: selected.filter(row=>row.ats==='WIN').length,
      losses: selected.filter(row=>row.ats==='LOSS').length, pushes: selected.filter(row=>row.ats==='PUSH').length };
  });
  return { version: NFL_GAME_LINE_RESEARCH_VERSION, season, config, games: rows.length, excluded: result.excluded,
    modelMargin: metric(rows.map(row=>row.modelError)), naiveMargin: metric(rows.map(row=>row.naiveError)), marketMargin: metric(marketRows.map(row=>row.marketError!)),
    paperThresholdPoints: 2, paperAts: { selections: selections.length, wins: selections.filter(row=>row.ats==='WIN').length,
      losses: selections.filter(row=>row.ats==='LOSS').length, pushes: selections.filter(row=>row.ats==='PUSH').length }, disagreementBuckets: buckets, rows,
    recommendationEnabled: false, moneyBettingApproved: false,
    note: 'Chronological research-only score projection. The model never receives the closing spread; the closing spread is an evaluation benchmark. Revised public schedules are not archived pregame inputs. No recommendation or probability is enabled.' };
}

export async function loadNflverseGameResults(fetcher: typeof fetch = fetch) {
  const response = await fetcher(NFLVERSE_SCHEDULE_SOURCE, { headers: { 'User-Agent': 'sports-betting-engine/2.1 personal research; contact via repository' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`nflverse schedule source returned HTTP ${response.status}`);
  if (!['github.com','release-assets.githubusercontent.com'].includes(new URL(response.url).hostname)) throw Error('nflverse schedule redirected outside approved hosts.');
  const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 5_000_000) throw Error('nflverse schedule exceeded compressed safety limit.');
  return parseNflverseGameResults(gunzipSync(bytes, { maxOutputLength: 40_000_000 }).toString('utf8'));
}
