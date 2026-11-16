# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/santika1938-source/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/santika1938-source/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot, finds the protocols that still record no token, and ranks them by implied launch value. The radar-2 model prices each category from the snapshot's own market — the median market-cap/TVL of that category's live-token protocols — adjusted for multi-chain reach, seven-day growth and time running with no token. It writes a 200-row board (the whole 40-protocol watchlist plus 160 early rows below the floor), a static dark-scope dashboard with a detail view and farm plan for every protocol, and the dossier the judge reads.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=1c6jcmp6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
