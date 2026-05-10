import https from 'https';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function espnTeamMatches(candidateName: string, targetName: string): boolean {
  const candidate = normalizeTeamName(candidateName);
  const target = normalizeTeamName(targetName);
  const candidateLast = candidate.split(' ').pop() ?? '';
  const targetLast = target.split(' ').pop() ?? '';

  return candidate === target
    || candidate.includes(target)
    || target.includes(candidate)
    || (candidateLast.length >= 4 && candidateLast === targetLast);
}

const teamIdCache = new Map<string, string>();

export async function findEspnTeamId(
  sport: string,
  league: string,
  teamName: string
): Promise<string | null> {
  const cacheKey = `${sport}:${league}:${teamName}`;
  if (teamIdCache.has(cacheKey)) return teamIdCache.get(cacheKey)!;

  const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams`;
  const teamsData = await fetchJson(teamsUrl);
  const teams = Array.isArray(teamsData?.sports?.[0]?.leagues?.[0]?.teams)
    ? teamsData.sports[0].leagues[0].teams
    : Array.isArray(teamsData?.teams)
      ? teamsData.teams
      : [];

  const directMatch = (teams ?? []).find((t: any) => {
    const name = t?.team?.displayName ?? t?.team?.shortDisplayName ?? t?.team?.name ?? '';
    return espnTeamMatches(name, teamName);
  });

  if (directMatch?.team?.id) {
    teamIdCache.set(cacheKey, directMatch.team.id);
    return directMatch.team.id;
  }

  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
  const scoreboardData = await fetchJson(scoreboardUrl);
  const events = Array.isArray(scoreboardData?.events) ? scoreboardData.events : [];

  for (const event of events) {
    const competitors = event?.competitions?.[0]?.competitors ?? [];
    const match = competitors.find((c: any) =>
      espnTeamMatches(c?.team?.displayName ?? c?.team?.shortDisplayName ?? c?.team?.name ?? '', teamName)
    );
    if (match?.team?.id) {
      teamIdCache.set(cacheKey, match.team.id);
      return match.team.id;
    }
  }

  return null;
}

export function parseEspnScoreValue(score: unknown): number {
  if (typeof score === 'number') return score;
  if (typeof score === 'string') {
    const parsed = parseFloat(score);
    return isNaN(parsed) ? NaN : parsed;
  }
  if (score && typeof score === 'object') {
    const value = (score as { value?: unknown; displayValue?: unknown }).value
      ?? (score as { value?: unknown; displayValue?: unknown }).displayValue;
    return parseEspnScoreValue(value);
  }
  return NaN;
}
