---
kind: upgrade-guide
description: "Orchestration authorization and routing use required Session events that older readers cannot interpret."
---

# Orchestration Session events

English | [中文](guide.zh.md)

## Change

The base profile includes the default-off Orchestration service and the Web application includes its switch. Sessions that use the switch or routing can contain new required authorization and routing events. Older readers reject those Sessions; existing experimental routing records remain readable by the new runtime.

## Migration

1. Upgrade the Host and any Session readers together before enabling Orchestration in a conversation. Keep a backup of Session data before upgrading readers that cannot be updated together.
2. Remove duplicate `orchestration` or `ui-orchestration` insertions from custom profile patches based on `dsh-base`; configure the existing entries instead. Higher-priority home patches and command-line overlays can prevent GUI settings writes.
3. Open a conversation, configure its model pool, and approve any additional child routes. Verify the switch activates and the intended models appear in Orchestration settings. Existing children retain their recorded permissions.

See the [service reference](../../../../packages/subagent/orchestration/README.md) for routing and the [persistence change record](../../../persistence-changes/README.md) for Session compatibility.
