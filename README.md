# Colossus: Mind Game — browser prototype

A playable prototype of the asymmetric 1v3 / 1v4 boss battler described in [GDD.md](GDD.md).
Interpretations of unclear rules are logged in [RULINGS.md](RULINGS.md).

## Getting started

```bash
npm install
npm test          # rules engine unit tests
```

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/` | Pure rules engine: `applyAction(state, action) -> newState`, seeded RNG in state, no UI or network code |
| `src/engine/engine.test.ts` | Unit tests: dice, Parry/whiff, Tumbles, climbing, Rest/burn, escalation, commit-reveal |
