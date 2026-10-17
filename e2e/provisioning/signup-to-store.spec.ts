import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Signup → live-store provisioning suite (Phase 12 plan 12-10 — PROV-04
 * criterion 5 + E2E-01's provisioning half).
 *
 * Asserts the SIX QA breakpoints of the provisioning pipeline (12-CONTEXT
 * LOCKED decision 2 — the exact failure points manual QA hit), each as a
 * discrete, ordered check against the dashboard-api store document — never a
 * brittle dashboard-UI scrape:
 *
 *   BP1  store created with a minted `pk_` publicKey + canonical doc shape
 *   BP2  GitHub connect callback links the account (gitConnection populated)
 *   BP3  customer repo created from the `headkit-starter` template
 *   BP4  create-wp-site provisions the WP admin on the pool site
 *        (headkit/v2 REST namespace live on the provisioned site)
 *   BP5  git mirror produces exactly one org repo (CreateFromTemplate,
 *        Option B — orgRepoId/orgRepoName recorded once, stable across polls)
 *   BP6  the Vercel project carries the starter env set BEFORE the first
 *        deployment exists (env names present whenever lastDeploymentID is)
 *
 * TARGETING (no host is ever hardcoded — T-12-10-04):
 * The suite is opt-in via E2E_PROVISIONING=1 and reads its entire target from
 * env. It self-skips when the flag is unset, so `bun run test:e2e` (local
 * storefront suite) and the CI job never touch it accidentally.
 *
 *   E2E_PROVISIONING=1                 enable the suite (required)
 *   PROVISIONING_API_URL               dashboard-api base incl. /api/v1
 *                                      (local: the Docker dashboard-api;
 *                                      staging: ONLY at the approved 12-10
 *                                      gate run — LOCAL-ONLY hard rule)
 *   PROVISIONING_AUTH_TOKEN            bearer for /api/v1 (Clerk session JWT)
 *   PROVISIONING_TEAM_SLUG             team owning the store under test
 *   PROVISIONING_STORE_SLUG            store slug under test
 *   PROVISIONING_POLL_TIMEOUT_MS      optional; default 15 min per breakpoint
 *
 * FLOW OWNERSHIP: the suite OBSERVES a provisioning run — it does not mint
 * Clerk users or click through the GitHub OAuth grant (those are driven by
 * the signup UI / gate-run operator). Kick off signup→create-store→connect
 * GitHub against the target, then run this suite; each breakpoint polls until
 * its own external effect lands on the store doc, in pipeline order.
 *
 * SECURITY RIDERS: the store payload must never leak secretKeyEnc, it must
 * never carry environment-variable VALUES (dashboard-api returns only
 * `environmentVariableNames`), and the persisted env map must carry only the
 * public names — HEADKIT_PRIVATE_KEY / HEADKIT_NPM_TOKEN must be absent
 * (12-08 contract).
 */

interface GitConnectionDoc {
  owner?: string;
  repoName?: string;
  repoId?: number;
  orgRepoId?: number;
  orgRepoName?: string;
  installationId?: number;
}

interface ProviderConfigDoc {
  baseUrl?: string;
}

interface CommerceConnectionDoc {
  provider?: string;
  url?: string;
  pressableSiteId?: string;
  isPressableProvisioned?: boolean;
  providerConfig?: ProviderConfigDoc;
}

interface StoreDoc {
  id?: string;
  slug?: string;
  publicKey?: string;
  gitConnection?: GitConnectionDoc;
  commerceConnection?: CommerceConnectionDoc;
  vercelProjectID?: string;
  lastDeploymentID?: string;
  /** Keys of the store's persisted env map; the API never returns values. */
  environmentVariableNames?: string[];
}

interface ApiEnvelope {
  message?: string;
  data?: StoreDoc;
  error?: string;
}

const ENABLED = process.env.E2E_PROVISIONING === "1";
const API_URL = (process.env.PROVISIONING_API_URL ?? "").replace(/\/$/, "");
const AUTH_TOKEN = process.env.PROVISIONING_AUTH_TOKEN ?? "";
const TEAM_SLUG = process.env.PROVISIONING_TEAM_SLUG ?? "";
const STORE_SLUG = process.env.PROVISIONING_STORE_SLUG ?? "";
const POLL_TIMEOUT_MS = Number(
  process.env.PROVISIONING_POLL_TIMEOUT_MS ?? 15 * 60_000,
);
const POLL_INTERVAL_MS = 10_000;

/** Names the store's persisted env map must carry after env-write (12-08). */
const REQUIRED_PUBLIC_ENV_NAMES = [
  "NEXT_PUBLIC_HEADKIT_PUBLIC_KEY",
  "NEXT_PUBLIC_GRAPHQL_URL",
  "NEXT_PUBLIC_FRONTEND_URL",
] as const;

/** Secret names that must NEVER be mirrored into the store doc (12-08). */
const FORBIDDEN_ENV_NAMES = [
  "HEADKIT_PRIVATE_KEY",
  "HEADKIT_NPM_TOKEN",
] as const;

function requireTargetEnv(): void {
  const missing: string[] = [];
  if (!API_URL) missing.push("PROVISIONING_API_URL");
  if (!AUTH_TOKEN) missing.push("PROVISIONING_AUTH_TOKEN");
  if (!TEAM_SLUG) missing.push("PROVISIONING_TEAM_SLUG");
  if (!STORE_SLUG) missing.push("PROVISIONING_STORE_SLUG");
  if (missing.length > 0) {
    throw new Error(
      `E2E_PROVISIONING=1 but the target is incomplete — set: ${missing.join(", ")}. ` +
        "No host is ever hardcoded in this suite; see e2e/provisioning/README.md.",
    );
  }
}

async function fetchStoreRaw(
  api: APIRequestContext,
): Promise<{ raw: string; store: StoreDoc }> {
  const res = await api.get(
    `${API_URL}/teams/${TEAM_SLUG}/stores/${STORE_SLUG}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
  );
  expect(
    res.ok(),
    `dashboard-api store read failed: ${res.status()} ${res.statusText()}`,
  ).toBe(true);
  const raw = await res.text();
  const envelope = JSON.parse(raw) as ApiEnvelope;
  return { raw, store: envelope.data ?? {} };
}

/**
 * Polls the store doc until `predicate` returns truthy or the breakpoint
 * budget elapses. Every observation also feeds the BP6 ordering ledger.
 */
async function pollStore(
  api: APIRequestContext,
  label: string,
  predicate: (store: StoreDoc) => boolean,
): Promise<StoreDoc> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last: StoreDoc = {};
  for (;;) {
    const { store } = await fetchStoreRaw(api);
    last = store;
    recordEnvBeforeDeployObservation(store);
    if (predicate(store)) return store;
    if (Date.now() > deadline) {
      throw new Error(
        `${label}: condition not met within ${POLL_TIMEOUT_MS}ms — last store state: ` +
          JSON.stringify(redactedSummary(last)),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** Values-free summary for failure messages (never dump the full doc). */
function redactedSummary(store: StoreDoc): Record<string, unknown> {
  return {
    hasPublicKey: Boolean(store.publicKey),
    gitOwnerLinked: Boolean(store.gitConnection?.owner),
    repoId: store.gitConnection?.repoId ?? 0,
    orgRepoId: store.gitConnection?.orgRepoId ?? 0,
    pressableSiteId: store.commerceConnection?.pressableSiteId ?? "",
    hasProviderConfig: Boolean(
      store.commerceConnection?.providerConfig?.baseUrl,
    ),
    vercelProjectID: store.vercelProjectID ?? "",
    lastDeploymentID: store.lastDeploymentID ?? "",
    envNames: store.environmentVariableNames ?? [],
  };
}

/**
 * BP6 ordering ledger: every poll observation records whether a deployment
 * existed WITHOUT the starter env names already persisted. The env write
 * happens strictly before deployment create in DeployRepoToVercel, so any
 * deployment-without-env observation is a pipeline-order regression.
 */
let envBeforeDeployViolations = 0;
function recordEnvBeforeDeployObservation(store: StoreDoc): void {
  if (!store.lastDeploymentID) return;
  const names = store.environmentVariableNames ?? [];
  const missing = REQUIRED_PUBLIC_ENV_NAMES.filter((n) => !names.includes(n));
  if (missing.length > 0) envBeforeDeployViolations += 1;
}

test.describe("signup → live store provisioning (6 QA breakpoints)", () => {
  // The breakpoints are pipeline-ordered; run them serially.
  test.describe.configure({ mode: "serial" });
  test.setTimeout(POLL_TIMEOUT_MS + 60_000);

  let api: APIRequestContext;
  /** BP5 stability check: the org repo identity must not change across polls. */
  let firstSeenOrgRepoId = 0;

  test.beforeAll(async () => {
    test.skip(
      !ENABLED,
      "provisioning suite is opt-in — set E2E_PROVISIONING=1 and the PROVISIONING_* target env (see e2e/provisioning/README.md)",
    );
    requireTargetEnv();
    api = await request.newContext();
  });

  test.afterAll(async () => {
    if (api) await api.dispose();
  });

  test("BP1: store created with a minted publicKey and canonical doc shape", async () => {
    const store = await pollStore(api, "BP1 store create", (s) =>
      Boolean(s.publicKey),
    );
    expect(store.slug, "store slug must match the provisioning target").toBe(
      STORE_SLUG,
    );
    expect(
      store.publicKey,
      "publicKey must be minted with the canonical pk_ prefix (12-02)",
    ).toMatch(/^pk_[A-Za-z0-9_-]+$/);

    // Canonical-shape security rider: the encrypted sk must never appear in
    // any API serialization of the store (json:"-" contract).
    const { raw } = await fetchStoreRaw(api);
    expect(
      raw.includes("secretKeyEnc"),
      "store payload must never serialize secretKeyEnc",
    ).toBe(false);
    expect(
      raw.includes('"environmentVariables"'),
      "store payload must never serialize the environment-variable map (its values are secrets)",
    ).toBe(false);
  });

  test("BP2: GitHub connect callback links the account", async () => {
    const store = await pollStore(api, "BP2 GitHub connect", (s) =>
      Boolean(s.gitConnection?.owner && s.gitConnection?.installationId),
    );
    const git = store.gitConnection ?? {};
    expect(git.owner, "gitConnection.owner must be linked").toBeTruthy();
    expect(
      git.installationId,
      "gitConnection.installationId must record the GitHub App installation",
    ).toBeGreaterThan(0);
  });

  test("BP3: customer repo created from the headkit-starter template", async () => {
    const store = await pollStore(api, "BP3 customer repo", (s) =>
      Boolean(s.gitConnection?.repoName && (s.gitConnection?.repoId ?? 0) > 0),
    );
    const git = store.gitConnection ?? {};
    expect(
      git.repoId,
      "gitConnection.repoId must reference the generated customer repo",
    ).toBeGreaterThan(0);
    expect(
      git.repoName,
      "gitConnection.repoName must be recorded for the template-generated repo",
    ).toBeTruthy();
  });

  test("BP4: create-wp-site provisions the pool site on the headkit/v2 namespace", async () => {
    const store = await pollStore(api, "BP4 create-wp-site", (s) =>
      Boolean(
        s.commerceConnection?.pressableSiteId && s.commerceConnection?.url,
      ),
    );
    const commerce = store.commerceConnection ?? {};
    expect(
      commerce.pressableSiteId,
      "commerceConnection.pressableSiteId must record the pool site",
    ).toBeTruthy();
    expect(
      commerce.providerConfig?.baseUrl,
      "canonical nested providerConfig.baseUrl must be written (PROV-01)",
    ).toBeTruthy();

    // The provisioned site must expose the headkit/v2 REST namespace (the
    // FU-11-06 regression: v1-namespaced callers 404ed at site-linking).
    const siteUrl = (commerce.url ?? "").replace(/\/$/, "");
    const wpIndex = await api.get(`${siteUrl}/wp-json/`);
    expect(
      wpIndex.ok(),
      `provisioned WP site REST index unreachable: ${wpIndex.status()}`,
    ).toBe(true);
    const index = (await wpIndex.json()) as { namespaces?: string[] };
    expect(
      index.namespaces ?? [],
      "provisioned site must register the headkit/v2 REST namespace",
    ).toContain("headkit/v2");
  });

  test("BP5: git mirror produces exactly one org repo", async () => {
    const store = await pollStore(api, "BP5 org mirror", (s) =>
      Boolean(
        (s.gitConnection?.orgRepoId ?? 0) > 0 && s.gitConnection?.orgRepoName,
      ),
    );
    const git = store.gitConnection ?? {};
    expect(
      git.orgRepoId,
      "gitConnection.orgRepoId must record the org mirror",
    ).toBeGreaterThan(0);
    expect(
      git.orgRepoName,
      "gitConnection.orgRepoName must be recorded (deterministic mirror name)",
    ).toBeTruthy();
    firstSeenOrgRepoId = git.orgRepoId ?? 0;

    // Stability re-read: the recorded mirror identity must not churn — a
    // second differing id would mean a duplicate generate slipped through.
    const { store: reread } = await fetchStoreRaw(api);
    expect(
      reread.gitConnection?.orgRepoId,
      "org repo id must be stable across reads (exactly one mirror)",
    ).toBe(firstSeenOrgRepoId);
  });

  test("BP6: Vercel project carries the starter env set BEFORE first deploy", async () => {
    const store = await pollStore(api, "BP6 Vercel env-before-deploy", (s) =>
      Boolean(s.vercelProjectID && s.lastDeploymentID),
    );
    expect(
      store.vercelProjectID,
      "vercelProjectID must be recorded",
    ).toBeTruthy();

    const envNames = store.environmentVariableNames ?? [];
    for (const name of REQUIRED_PUBLIC_ENV_NAMES) {
      expect(
        envNames,
        `persisted env map must carry ${name} (starter contract, PROV-03)`,
      ).toContain(name);
    }
    for (const name of FORBIDDEN_ENV_NAMES) {
      expect(
        envNames,
        `${name} is a secret and must never be mirrored into the store doc (12-08)`,
      ).not.toContain(name);
    }

    // Ordering: across EVERY poll observation this run, no deployment was
    // ever seen without the starter env already persisted — the env write
    // happens strictly before deployment create.
    expect(
      envBeforeDeployViolations,
      "observed a deployment without the starter env set — env-before-deploy ordering violated",
    ).toBe(0);
  });
});
