---
kind: upgrade-guide
description: "`dsh-tool-todo`'s `todo_write` list no longer auto-clears at each new turn, so a plan persists across turns and resumed sessions until it is explicitly emptied."
---

# `todo_write` list persists until explicitly cleared

English | [中文](guide.zh.md)

## Change

The `dsh-tool-todo` `todo_write` list previously was reset to empty at the start of each new turn, so a plan written in one turn vanished on the next and had to be re-entered. It now persists across turns and reopened or resumed sessions until the model clears it explicitly.

Who notices the change: users and agents that relied on the list being empty at the start of a turn. A persisted list now shows what the last `todo_write` recorded; clearing it is an explicit action.

## Migration

1. If you depend on an empty list at turn start, clear it explicitly: the model calls `todo_write` with `todos: []`, or a human uses `/todo clear`.
2. Confirm: after writing a list and starting a new turn or resuming the session, the same list is still shown; an explicit empty `todo_write` empties it.
