export const NFL_READINESS_VERSION='nfl-2026-readiness-v2';
export const nflReadinessChecklist=()=>({version:NFL_READINESS_VERSION,moneyBettingApproved:false,kellyEnabled:false,items:[
  {id:1,name:'Context source registry',status:'IMPLEMENTED',detail:'Persistent per-source attempts, successes and precise failures.'},
  {id:2,name:'Injuries and game availability',status:'PARTIAL',detail:'The free official NFL weekly practice/game-status report and dated ESPN context are collected; official game-day inactives still await a verified live parser.'},
  {id:3,name:'Roster, depth and QB role',status:'IMPLEMENTED_DIAGNOSTIC',detail:'Current roster and depth sources are checked; depth QB is EXPECTED, never confirmed active.'},
  {id:4,name:'One-click NFL preflight',status:'IMPLEMENTED',detail:'Scans every remaining NFL game today, refreshes context and grades eligible paper records without buying odds.'},
  {id:5,name:'Full-game moneyline/spread model',status:'RESEARCH_FAILED_GATE',detail:'A free-data chronological margin model was tested on untouched 2025 games. It trailed the closing market and went 55-72-1 ATS at the frozen two-point research rule, so recommendations remain disabled.'},
  {id:6,name:'Core player props',status:'PAPER_DIAGNOSTIC',detail:'Passing yards, rushing yards, receiving yards and receptions have experimental workload forecasts; issuance remains availability-gated.'},
  {id:7,name:'Workload layer',status:'PARTIAL',detail:'Attempts, targets, team opportunity shares and free cross-provider snap diagnostics exist; routes and red-zone roles remain missing, and snaps have no model weight.'},
  {id:8,name:'Opponent matchup layer',status:'DIAGNOSTIC_ONLY',detail:'Free dated team/opponent EPA, efficiency, sacks and QB-hit summaries are collected; no opponent coefficient is validated or active.'},
  {id:9,name:'Weather and venue',status:'DIAGNOSTIC_ONLY',detail:'Pregame summary weather/roof fields are collected when present; no forecast point adjustment is enabled.'},
  {id:10,name:'Market comparison',status:'IMPLEMENTED',detail:'Exact-line two-sided comparison uses three other books and rejects stale or mismatched prices.'},
  {id:11,name:'Paper tracking and CLV',status:'PARTIAL',detail:'Immutable picks, grading, replay and unique same-selection line movement now work. Late observations remain distinct from verified closing lines; unattended capture is still missing.'},
  {id:12,name:'Probability calibration',status:'NOT_APPROVED',detail:'Paper metrics are descriptive; no market-specific calibrated probability or Kelly staking is approved.'},
  {id:13,name:'Additional player props',status:'QUOTE_ONLY',detail:'Touchdowns, attempts, completions, combined and longest props remain quote/manual-paper only until separately validated.'},
  {id:14,name:'Quarter and half models',status:'QUOTE_ONLY',detail:'Period quotes and supported manual grading exist; full-game logic is not reused as a period model.'},
  {id:15,name:'Forward-test promotion gate',status:'IMPLEMENTED_LOCKED',detail:'Each core prop now reports frozen sample, baseline, Brier/calibration, verified-CLV and game-cluster ROI checks. Passing only triggers a separate research review, never betting approval.'},
]});
