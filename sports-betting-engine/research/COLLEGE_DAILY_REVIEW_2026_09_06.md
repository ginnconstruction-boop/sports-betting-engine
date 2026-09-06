# College daily review — September 6, 2026

## September 5 retrospective

The archived September 5 scan contained 68 provider games, 66 games with fresh
odds and zero official paper recommendations. The safety layer therefore did
its job: there is no official win/loss record for the slate.

For model diagnosis only, the raw directional output was compared with final
scores at the archived consensus spreads. This is not a reconstructed paper
record and must not be reported as one.

- Raw diagnostic direction: 20 wins, 46 losses, 0 pushes.
- PAPER MONITOR diagnostic direction: 2 wins, 7 losses.
- PAPER PASS diagnostic direction: 2 wins, 6 losses.
- MODEL WARNING diagnostic direction: 16 wins, 33 losses.
- FBS/FCS diagnostic direction: 12 wins, 26 losses.
- FBS/FBS diagnostic direction: 8 wins, 20 losses.
- Raw margin MAE: 21.17 points.
- Raw margin RMSE: 25.13 points.

The largest failures again showed the known early-season mean-reversion issue,
especially when an FCS underdog faced a much deeper FBS roster. No coefficients
or thresholds were tuned to this one slate.

## Action taken

The simple website view no longer prints a side, line, projected score or fair
spread for PAPER MONITOR observations. It now says that no side is recommended.
The immutable diagnostic observation remains stored for later model evaluation.

## September 6 preview

The scan checked all three FBS-scope games listed by the odds provider and used
two sportsbook API credits. No spread cleared all price, context, calibration
and safety gates, so there are zero qualified paper recommendations.

- Washington State at Washington: WATCH, but no side recommended. The raw model
  and market differed by 8 points while early-season roster/QB context remained
  incomplete.
- Louisville at Ole Miss: PASS. The model was close to the market and no usable
  price edge was found.
- Wisconsin at Notre Dame: PASS. The model was close to the market and no usable
  price edge was found.

Two additional September 6 games on the broad NCAA schedule are FCS-only and
are outside the current FBS provider/model scope.

## NFL backlog

The preserved NFL order and evidence gates remain in
`research/NFL_FORWARD_AND_GAME_LINE_RELEASE_2026_09_06.md`. This college review
does not change that list.
