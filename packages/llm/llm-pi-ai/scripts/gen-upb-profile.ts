/**
 * Sync a deployment profile's Uni Paderborn AI-Gateway chat route `models`
 * list to the canonical catalogue.
 *
 * The shipped route ([`UPB_GATEWAY_MODELS`](../src/upb-gateway.ts)) is the
 * catalogue-derived chat set — the single source of truth. A running
 * deployment, however, carries its own `llm-pi-ai` provider profile (the
 * `web` `$DSH_HOME` patch by default) whose `models` list overrides the
 * packaged route, so a catalogue change does not reach pickers until that
 * profile is refreshed. This generator rewrites the
 * `config.providers.<route>.models` list of a target patch to the shipped
 * chat set, preserving the provider's deployment-only fields (`apiKeyEnv`,
 * `baseURL`, `retryPolicy`, `api`) and every other patch row. Each rewritten
 * entry carries the shipped request cap, which is the published output maximum
 * lowered to the gateway's per-minute token share, not the maximum itself: a
 * sync must not raise the per-request output reservation above what the gateway
 * admits.
 *
 * Run `pnpm gen-upb-profile` to write the default
 * `$DSH_HOME/profiles/web/cordis.patch.yml`, or pass `--profile <path>` and
 * `--route <key>`. `pnpm verify-upb-profile` checks freshness without writing.
 *
 * @module dsh-llm-pi-ai/scripts/gen-upb-profile
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMap, isSeq, parseDocument, Scalar, visit } from 'yaml'
import { UPB_GATEWAY_MODELS } from '../src/upb-gateway.ts'

/** Route key of the deployment's Uni Paderborn chat provider this generator refreshes. */
export const UPB_PROFILE_ROUTE = 'uni-paderborn'

/** Plugin id of the row whose `config.providers.<route>.models` is regenerated. */
export const UPB_PROFILE_PLUGIN = 'llm-pi-ai'

/** One `models` entry this generator writes, in stable field order. */
export interface UpbProfileModel {
  readonly id: string
  readonly name: string
  /** Context capacity; omitted for entries the gateway publishes no ceiling for (routers). */
  readonly contextWindow?: number
  /** Per-request output cap, already lowered to the gateway's per-minute token share; omitted when unpublished. */
  readonly maxTokens?: number
  readonly rpm?: number
  readonly tpm?: number
  readonly free: boolean
  /** Published per-million-token rates; omitted when the catalogue publishes none. */
  readonly pricing?: { readonly input?: number; readonly output?: number }
  readonly input?: readonly string[]
}

/**
 * The shipped models as profile `models` entries, in catalogue order. An entry
 * carries the ceilings, quotas, cost and modalities the catalogue publishes; the
 * routers publish no token ceilings, so those keys are omitted and the route's
 * defaults size them. `maxTokens` is the shipped request cap, so a synced
 * profile never asks the gateway for more output than one request may reserve.
 */
export function profileModels(): UpbProfileModel[] {
  return UPB_GATEWAY_MODELS.map(model => ({
    id: model.id,
    name: model.name ?? model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    ...model.rpm === undefined ? {} : { rpm: model.rpm },
    ...model.tpm === undefined ? {} : { tpm: model.tpm },
    free: model.free ?? true,
    ...model.pricing === undefined ? {} : { pricing: { ...model.pricing } },
    ...model.input === undefined ? {} : { input: [...model.input] },
  }))
}

/** Per-model fields the catalogue owns; every other key on an entry is deployment-owned. */
const CATALOGUE_OWNED_MODEL_FIELDS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'rpm', 'tpm', 'free', 'input'])

/**
 * Carry deployment-owned per-model configuration (reasoning levels, wire
 * compatibility, pricing overrides) from the entries already in the patch onto
 * the catalogue-derived entries of the same id. The catalogue owns the model
 * facts; every other key stays the deployment's. Dropping one such key is not a
 * cosmetic loss: a persisted reasoning selection whose levels disappeared makes
 * the model reject its own saved choice.
 * @param models - catalogue-derived entries to write.
 * @param existing - the route's current `models` value, already plain.
 * @returns the entries to write, catalogue fields first.
 */
function mergeDeploymentFields(
  models: readonly UpbProfileModel[],
  existing: unknown,
): Record<string, unknown>[] {
  const prior = new Map<string, Record<string, unknown>>()
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (entry === null || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      if (typeof record['id'] === 'string') prior.set(record['id'], record)
    }
  }
  return models.map((model) => {
    const kept = prior.get(model.id)
    return {
      ...model,
      ...kept === undefined
        ? {}
        : Object.fromEntries(Object.entries(kept).filter(([key]) => !CATALOGUE_OWNED_MODEL_FIELDS.has(key))),
    }
  })
}

/**
 * Replace one route's `models` list in a profile patch document, preserving
 * every other node and comment plus the deployment-owned per-model fields.
 * @param patchText - the raw `cordis.patch.yml` text (a top-level sequence).
 * @param route - the provider route key whose `models` list is replaced.
 * @param models - the desired catalogue-derived `models` entries.
 * @returns the re-serialized patch and whether the list actually changed.
 */
export function applyModelsToPatch(
  patchText: string,
  route: string,
  models: UpbProfileModel[],
): { text: string; changed: boolean } {
  const document = parseDocument(patchText, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  document.contents.flow = false
  const rowIndex = document.contents.items.findIndex((item, index) =>
    isMap(item) && document.getIn([index, 'id']) === UPB_PROFILE_PLUGIN && !item.has('insert'))
  if (rowIndex < 0) {
    throw new Error(`Profile patch has no "${UPB_PROFILE_PLUGIN}" row to refresh`)
  }
  const path = [rowIndex, 'config', 'providers', route, 'models']
  const existing = toPlain(document.getIn(path) as unknown)
  const desired = mergeDeploymentFields(models, existing)
  const before = JSON.stringify(existing)
  const after = JSON.stringify(desired)
  if (before !== after) document.setIn(path, document.createNode(desired))
  visit(document, { Map(_key, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
    const expression = new Scalar(node.get('__jsExpr'))
    expression.tag = 'tag:yaml.org,2002:js'
    return expression
  } })
  return { text: String(document), changed: before !== after }
}

/** Resolve a YAML node to plain JSON-comparable data. */
function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return (value as { toJSON(): unknown }).toJSON()
  }
  return value
}

/** Default `$DSH_HOME/profiles/web/cordis.patch.yml`, honoring `$DSH_HOME`. */
export function defaultProfilePath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, 'profiles', 'web', 'cordis.patch.yml')
}

/** Read a `--flag <value>` argument pair. */
function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const write = !check && !process.argv.includes('--dry-run')
  const path = flagValue('--profile') ?? defaultProfilePath()
  const route = flagValue('--route') ?? UPB_PROFILE_ROUTE
  const models = profileModels()
  const patchText = readFileSync(path, 'utf8')
  const { changed } = applyModelsToPatch(patchText, route, models)
  if (!changed) {
    console.log(`Up to date: "${route}" models in ${path} (${models.length} shipped chat models).`)
    process.exit(0)
  }
  if (check) {
    console.error(`Stale: "${route}" models in ${path} differ from the shipped catalogue; run pnpm gen-upb-profile.`)
    process.exit(1)
  }
  if (!write) {
    console.log(`Would update "${route}" models in ${path} to ${models.length} shipped chat models (--dry-run).`)
    process.exit(0)
  }
  writeFileSync(path, applyModelsToPatch(patchText, route, models).text)
  console.log(`Updated "${route}" models in ${path} (${models.length} shipped chat models).`)
}
