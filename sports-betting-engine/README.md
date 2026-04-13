# Sports Betting Engine

On-demand sports betting market data engine powered by The Odds API v4.

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your API key
Copy the example env file and add your key:
```bash
cp .env.example .env
```
Then edit `.env`:
```
ODDS_API_KEY=your_key_here
```

### 3. Run a scan
```bash
# Morning scan — baseline snapshot for the day
npx ts-node src/index.ts morning

# Midday final card — compare vs morning baseline
npx ts-node src/index.ts midday

# Full scan — all enabled sports
npx ts-node src/index.ts full

# Single sport
npx ts-node src/index.ts nba
npx ts-node src/index.ts mlb
npx ts-node src/index.ts nhl

# Force fresh data (bypass 5-min cache)
npx ts-node src/index.ts morning --force
```

---

## 📁 Project Structure

```
src/
├── api/
│   └── oddsApiClient.ts      # All API requests — single source of truth
├── config/
│   ├── sports.ts             # All target sports — enable/disable here
│   └── bookmakers.ts         # Bookmaker mapping layer
├── services/
│   ├── normalizeOdds.ts      # Raw API → normalized schema
│   ├── aggregateMarkets.ts   # Best lines, consensus, disagreement scores
│   ├── snapshotStore.ts      # File-based snapshot persistence
│   └── runEngine.ts          # Core execution engine
├── commands/
│   ├── runMorningScan.ts     # RUN MORNING SCAN
│   ├── runMiddayFinalCard.ts # RUN MIDDAY FINAL CARD
│   ├── runFullScan.ts        # RUN FULL SCAN
│   ├── runSportScan.ts       # RUN SPORT SCAN <key>
│   └── runLiveCheck.ts       # RUN LIVE CHECK
├── types/
│   └── odds.ts               # All TypeScript types
├── utils/
│   ├── logger.ts             # Centralized logger
│   └── formatOutput.ts       # Console output formatter
└── index.ts                  # CLI entry point
```

---

## 🎯 Target Sports

| Sport         | Key                        | Status      |
|---------------|----------------------------|-------------|
| MLB           | `baseball_mlb`             | ✅ Enabled  |
| NBA           | `basketball_nba`           | ✅ Enabled  |
| NFL           | `americanfootball_nfl`     | ✅ Enabled  |
| NCAAF         | `americanfootball_ncaaf`   | ✅ Enabled  |
| NCAAB         | `basketball_ncaab`         | ✅ Enabled  |
| NCAA Baseball | `baseball_ncaa`            | ✅ Enabled  |
| NHL           | `icehockey_nhl`            | ✅ Enabled  |

To enable/disable a sport, edit `src/config/sports.ts` and set `enabled: true/false`.

---

## 📚 All Commands

```bash
npx ts-node src/index.ts morning          # Morning scan
npx ts-node src/index.ts midday           # Midday final card
npx ts-node src/index.ts full             # Full scan all sports
npx ts-node src/index.ts live             # Live check (no snapshot)
npx ts-node src/index.ts sport <key>      # Single sport by key

# Sport shorthands
npx ts-node src/index.ts nba
npx ts-node src/index.ts mlb
npx ts-node src/index.ts nhl
npx ts-node src/index.ts nfl
npx ts-node src/index.ts ncaaf
npx ts-node src/index.ts ncaab
npx ts-node src/index.ts ncaa-baseball

# Options
--force / -f    Bypass cache, force fresh API call
```

---

## 🔒 Credit Protection

- Each sport is fetched **once per run** — no duplicate calls
- A **5-minute cache** prevents repeat hits if you run too quickly
- Use `--force` only when you need fresh data
- **Player props are disabled by default** — schema is built in but props are never fetched unless you explicitly enable them
- `runLiveCheck` does NOT save snapshots by default to reduce clutter

---

## 📦 Snapshots

Every `morning` and `midday` run saves a timestamped JSON snapshot to `./snapshots/`.

Midday runs automatically compare against the most recent morning snapshot to detect:
- Line movement direction
- Price movement direction  
- Stale book identification
- Book disagreement spikes

---

## 📊 Output Fields

### Per Event
- Matchup, sport, start time
- Available markets (h2h, spreads, totals)
- Best price + best book per side
- Consensus price + consensus line
- Book count per market
- Disagreement score
- Trading flags

### Per Run
- Sports processed
- Events processed
- Markets processed
- API quota used / remaining
- Top movement flags across all events
- Errors per sport (non-fatal)

---

## 🔮 Built for Expansion

The schema and architecture are ready for Phase 2:
- Team totals
- First half / quarter / period markets
- Player props (schema built, fetching disabled)
- PostgreSQL/Supabase storage swap (replace `snapshotStore.ts`)
- Model scoring layer
- Dashboard / read API endpoints
- Best bet ranking engine
- CLV tracking

---

## ⚙️ Environment Variables

| Variable               | Default       | Description                        |
|------------------------|---------------|------------------------------------|
| `ODDS_API_KEY`         | *(required)*  | Your Odds API key                  |
| `CACHE_WINDOW_MINUTES` | `5`           | Cache TTL in minutes               |
| `REQUEST_TIMEOUT_MS`   | `10000`       | API request timeout in ms          |
| `LOG_LEVEL`            | `info`        | `debug`, `info`, `warn`, `error`   |
| `STORAGE_MODE`         | `file`        | `file` (postgres coming in Phase 2)|
| `SNAPSHOT_DIR`         | `./snapshots` | Where snapshots are saved          |

---

## 🚫 What This System Does NOT Do

- ❌ No background polling
- ❌ No scheduled runs
- ❌ No auto-repeat
- ❌ No player prop fetching (until you enable it)
- ❌ No fabricated sharp/public split data

Every API call only happens when **you run a command**.
