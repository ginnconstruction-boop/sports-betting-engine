// Provider market keys verified against its documentation on 2026-08-30.
// https://the-odds-api.com/sports-odds-data/betting-markets.html
// These are quote categories, NOT validated model recommendations.
export const NFL_MARKET_GROUPS = {
  game: { label: 'Full game — moneyline, spread & total', markets: ['h2h', 'spreads', 'totals'] },
  passing: { label: 'Passing props', markets: ['player_pass_yds', 'player_pass_tds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_interceptions', 'player_pass_longest_completion', 'player_pass_yds_q1'] },
  rushing: { label: 'Rushing & receiving props', markets: ['player_rush_yds', 'player_rush_attempts', 'player_rush_longest', 'player_rush_tds', 'player_receptions', 'player_reception_yds', 'player_reception_longest', 'player_reception_tds'] },
  touchdowns: { label: 'Touchdowns — first, anytime, last & multiple', markets: ['player_1st_td', 'player_anytime_td', 'player_last_td', 'player_tds_over', 'player_rush_reception_tds', 'player_pass_rush_reception_tds'] },
  combined: { label: 'Combined yardage props', markets: ['player_pass_rush_yds', 'player_rush_reception_yds', 'player_pass_rush_reception_yds'] },
  defense: { label: 'Kicking & defensive props', markets: ['player_field_goals', 'player_kicking_points', 'player_pats', 'player_sacks', 'player_solo_tackles', 'player_tackles_assists', 'player_assists', 'player_defensive_interceptions'] },
  q1: { label: '1st quarter', markets: ['h2h_q1', 'h2h_3_way_q1', 'spreads_q1', 'totals_q1', 'team_totals_q1', 'alternate_spreads_q1', 'alternate_totals_q1', 'alternate_team_totals_q1'] },
  q2: { label: '2nd quarter', markets: ['h2h_q2', 'h2h_3_way_q2', 'spreads_q2', 'totals_q2', 'team_totals_q2', 'alternate_spreads_q2', 'alternate_totals_q2', 'alternate_team_totals_q2'] },
  q3: { label: '3rd quarter', markets: ['h2h_q3', 'h2h_3_way_q3', 'spreads_q3', 'totals_q3', 'team_totals_q3', 'alternate_spreads_q3', 'alternate_totals_q3', 'alternate_team_totals_q3'] },
  q4: { label: '4th quarter', markets: ['h2h_q4', 'h2h_3_way_q4', 'spreads_q4', 'totals_q4', 'team_totals_q4', 'alternate_spreads_q4', 'alternate_totals_q4', 'alternate_team_totals_q4'] },
  h1: { label: '1st half', markets: ['h2h_h1', 'h2h_3_way_h1', 'spreads_h1', 'totals_h1', 'team_totals_h1', 'alternate_spreads_h1', 'alternate_totals_h1', 'alternate_team_totals_h1'] },
  h2: { label: '2nd half', markets: ['h2h_h2', 'h2h_3_way_h2', 'spreads_h2', 'totals_h2', 'team_totals_h2', 'alternate_spreads_h2', 'alternate_totals_h2', 'alternate_team_totals_h2'] },
  alternates: { label: 'Alternate game lines & team totals', markets: ['alternate_spreads', 'alternate_totals', 'team_totals', 'alternate_team_totals'] },
  passing_alts: { label: 'Passing milestones & alternate lines', markets: ['player_pass_yds_alternate', 'player_pass_tds_alternate', 'player_pass_attempts_alternate', 'player_pass_completions_alternate', 'player_pass_interceptions_alternate', 'player_pass_longest_completion_alternate', 'player_pass_rush_yds_alternate', 'player_pass_rush_reception_yds_alternate', 'player_pass_rush_reception_tds_alternate'] },
  rushing_alts: { label: 'Rushing / receiving milestones & alternate lines', markets: ['player_rush_yds_alternate', 'player_rush_attempts_alternate', 'player_rush_longest_alternate', 'player_rush_tds_alternate', 'player_receptions_alternate', 'player_reception_yds_alternate', 'player_reception_longest_alternate', 'player_reception_tds_alternate', 'player_rush_reception_yds_alternate', 'player_rush_reception_tds_alternate'] },
  defense_alts: { label: 'Kicking / defense alternate lines', markets: ['player_field_goals_alternate', 'player_kicking_points_alternate', 'player_pats_alternate', 'player_sacks_alternate', 'player_solo_tackles_alternate', 'player_tackles_assists_alternate', 'player_assists_alternate'] },
} as const;

export type NflMarketGroup = keyof typeof NFL_MARKET_GROUPS;
export const NFL_BOARD_WINDOW_DAYS = 14;
export function isNflMarketGroup(value: string): value is NflMarketGroup {
  return Object.prototype.hasOwnProperty.call(NFL_MARKET_GROUPS, value);
}
