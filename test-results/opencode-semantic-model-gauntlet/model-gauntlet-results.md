# OpenCode Model Gauntlet Results

Generated: 2026-05-09T23:16:07.760Z

Runs per model: 3
Recommended threshold: average >= 90, successful runs >= 3, consistency >= 85, hard failures = 0

Provider-infra runs are reported separately and are not counted as model behavior. They still block a Recommended verdict until rerun succeeds.

Scoring weights: launchBootstrap=15, directReply=10, peerRelayAB=15, peerRelayBC=15, concurrentReplies=15, taskRefs=10, cleanTranscript=10, noDuplicateTokens=5, latencyStable=5.

## Model Summary

| Model | Verdict | Confidence | Readiness | Consistency | Score Spread | Behavior Avg | Overall Avg | Counted | Pass Runs | Weakest Stage | Weakest TaskRef | Dominant Failure | Blockers | Provider Infra | Runtime Transport | Model Fails | Protocol Runs | p50 | p95 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `opencode/big-pickle` | Recommended | high | 100 | 100 | 0 | 100 | 100 | 3/3 | 3/3 | cleanTranscript 3/3 (100%) | concurrentBob 3/3 (100%) | none | - | 0 | 0 | 0 | 0 | 112355ms | 116891ms |
| `opencode/minimax-m2.5-free` | Strong candidate | high | 88.6 | 93.1 | 5 | 98.3 | 98.3 | 3/3 | 2/3 | noDuplicateTokens 2/3 (66.7%) | concurrentBob 3/3 (100%) | model-behavior | successful runs 2 < 3; hard failures 1; model-behavior failures 1; highest weighted stage loss noDuplicateTokens=5; protocol violations in 1 runs | 0 | 0 | 1 | 1 | 108862ms | 118757ms |

## opencode/big-pickle

Readiness score: 100.

Score stability: consistency=100, min=100, max=100, spread=0, stdDev=0, samples=3.

Recommendation blockers: -.

Weighted stage impact: -.

Stage pass rates: launchBootstrap:3/3 (100%), directReply:3/3 (100%), peerRelayAB:3/3 (100%), peerRelayBC:3/3 (100%), concurrentReplies:3/3 (100%), taskRefs:3/3 (100%), cleanTranscript:3/3 (100%), noDuplicateTokens:3/3 (100%), latencyStable:3/3 (100%).

TaskRef pass rates: directReply:3/3 (100%), peerRelayAB:3/3 (100%), peerRelayBC:3/3 (100%), concurrentBob:3/3 (100%), concurrentTom:3/3 (100%).

Protocol totals: badMessages=0, duplicateOrMissingTokens=0, affectedRuns=0.

| Run | Outcome | Category | Score | Counted | Duration | Failed Stages | Slowest Stage | TaskRefs | Protocol | Diagnostics |
| ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- |
| 1 | passed | none | 100 | yes | 112344ms | - | peerRelayBC:28154ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | - | runId=d9d27eb0-2798-4980-a0fa-f082a6edd705 |
| 2 | passed | none | 100 | yes | 112355ms | - | peerRelayBC:28580ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | - | runId=97364154-e06d-460c-94ae-65b73cb1b6f9 |
| 3 | passed | none | 100 | yes | 116891ms | - | peerRelayAB:27842ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | - | runId=7bdd4b2e-dbd6-4474-a8a0-9418df433671 |

## opencode/minimax-m2.5-free

Readiness score: 88.6.

Score stability: consistency=93.1, min=95, max=100, spread=5, stdDev=2.4, samples=3.

Recommendation blockers: successful runs 2 < 3; hard failures 1; model-behavior failures 1; highest weighted stage loss noDuplicateTokens=5; protocol violations in 1 runs.

Weighted stage impact: noDuplicateTokens:loss=5, failed=1, pass=2/3 (66.7%).

Stage pass rates: launchBootstrap:3/3 (100%), directReply:3/3 (100%), peerRelayAB:3/3 (100%), peerRelayBC:3/3 (100%), concurrentReplies:3/3 (100%), taskRefs:3/3 (100%), cleanTranscript:3/3 (100%), noDuplicateTokens:2/3 (66.7%), latencyStable:3/3 (100%).

TaskRef pass rates: directReply:3/3 (100%), peerRelayAB:3/3 (100%), peerRelayBC:3/3 (100%), concurrentBob:3/3 (100%), concurrentTom:3/3 (100%).

Protocol totals: badMessages=0, duplicateOrMissingTokens=2, affectedRuns=1.

| Run | Outcome | Category | Score | Counted | Duration | Failed Stages | Slowest Stage | TaskRefs | Protocol | Diagnostics |
| ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- |
| 1 | passed | none | 100 | yes | 91530ms | - | peerRelayBC:27370ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | - | runId=23ae85d2-e79d-41c9-93a6-e843acea6d9e |
| 2 | passed | none | 100 | yes | 108862ms | - | peerRelayAB:30664ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | - | runId=c3a55d8a-4028-4af7-9e1a-8ae8c87a95e5 |
| 3 | behavioral-fail | model-behavior | 95 | yes | 118757ms | noDuplicateTokens | peerRelayAB:37430ms | directReply:ok, peerRelayAB:ok, peerRelayBC:ok, concurrentBob:ok, concurrentTom:ok | token=GAUNTLET_JACK_USER_OK_3+GAUNTLET_TOM_USER_OK_3 | duplicateOrMissingTokens=GAUNTLET_JACK_USER_OK_3,GAUNTLET_TOM_USER_OK_3 |

