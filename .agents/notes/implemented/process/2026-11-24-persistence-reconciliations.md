# Agent Note: Reconcile accepted persistence histories

Status: implemented

English | [中文](2026-11-24-persistence-reconciliations.zh.md)

## Problem

Independent development can create competing transitions for the same persisted root. Acceptance can occur outside a finalized checkpoint, so choosing a branch to rewrite can destroy an accepted compatibility record. A single-predecessor history cannot describe both transitions and their combined successor.

## Decision

An explicit reconciliation records the independent predecessor tips for each affected root and a complete combined after schema. The verifier classifies the transition from every predecessor, rejects cycles, duplicate or dependent predecessors, and any fork that lacks a unique resulting tip. The author supplies the compatibility decision and bilingual evidence. A reconciliation is retained as a historical record; later changes add successors.

Finalization locks every predecessor reference and requires all of them in a checkpoint. Existing checkpoint digests remain unchanged. The [persistence-history decision](2026-09-11-persistence-type-history.md) continues to own schema normalization, compatibility classification, and checkpoint preservation; this decision supersedes its single-predecessor requirement for reconciled forks.

## Alternatives considered

**Rewrite one branch into a linear sequence.** Its machine record and snapshot can already have been accepted, and changing their predecessor would misstate the recorded transition.

**Select one branch or leave competing tips.** Selecting one loses a compatibility history; competing tips do not identify the schema that current source must match.

## Consequences

Authors review each predecessor against the combined schema and describe both reader directions. Classification and a recorded decision do not establish runtime compatibility, so tests and independent review remain necessary. The [cookbook](../../../../docs/cookbook/reviewing-persistence-type-changes.md) owns the authoring workflow. This mechanism changes contributor records, not the Session wire format.
