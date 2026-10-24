import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * CI gate on the theme's provisioning / token route authentication (theme
 * 0.4.92): `integrations/wordpress/theme/inc/rest-api/headkit-token.php` and
 * `inc/headkit-provisioning-signature.php`.
 *
 * WHY A STOREFRONT SUITE GUARDS A THEME GATE. On 2026-10-23 an attacker used
 * `headkit/v2/create-wp-site` (permission `__return_true`) to mint five
 * administrators on Bike Society production, and `headkit/v2/disconnect-store`
 * (a "permission" that checked only that a token option EXISTED) to break the
 * shop. Every route in that file now authenticates its caller: a bearer equal
 * to the site's `headkit_api_token` for the routes that run while connected,
 * and dashboard-api's Ed25519 signature for the two that run before a token
 * exists (`create-wp-site`, `connect-store`). The theme has no test runner, so
 * the harness runs the REAL files against recording shims and this suite is
 * the only thing that fails when a route loses its check.
 *
 * The `vectors` block verifies the exact signature
 * `services/dashboard-api/internal/wpsign/wpsign_test.go` pins, so the Go
 * signer and the PHP verifier agree by value.
 *
 * `php` is preinstalled on `ubuntu-latest`, so no toolchain setup is required.
 * macOS has not bundled `php` since Monterey, so this SKIPS on a developer
 * machine without it — and FAILS in CI, where a silent skip would drop the
 * only guard on an admin-minting path.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/token-route-auth-harness.php",
);

interface PermissionResult {
  allowed: boolean;
  code: string | null;
  status: number | null;
}

interface HandlerResult {
  ok: boolean;
  status: number | null;
  code: string | null;
}

interface CreateResult {
  permission: PermissionResult;
  result: HandlerResult;
  roles_after: string[] | null;
  user_count: number;
  mail_sent: number;
  provisioned: boolean;
}

interface HarnessOutput {
  sodium: boolean;
  routes: Record<string, string>;
  bearer: Record<string, Record<string, PermissionResult>>;
  signature: Record<string, PermissionResult | string | number>;
  create: Record<string, CreateResult>;
  connect: {
    permission: PermissionResult;
    result: HandlerResult | null;
    api_token_set: boolean;
    key_inserted: number;
    key_owner_roles: string[] | null;
  };
  disconnect: {
    permission: PermissionResult;
    result: HandlerResult | null;
    backend_called: number;
    backend_bearer: boolean;
    options_cleared: boolean;
    key_deleted: number;
    shared_function: boolean;
  };
  vectors: Record<string, string>;
}

/** A working `php` on PATH — the harness is executed, not parsed. */
function hasPhp(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PHP_AVAILABLE = hasPhp();
const IS_CI = Boolean(process.env.CI);

const SUITE = "WordPress provisioning / token route authentication";
const SKIPPING = !PHP_AVAILABLE && !IS_CI;
const SUITE_TITLE = SKIPPING
  ? `${SUITE} [skipped: requires \`php\` on PATH]`
  : SUITE;

let output: HarnessOutput | undefined;

/** The harness runs once; its stderr is the theme's own error_log lines. */
function run(): HarnessOutput {
  if (!output) {
    const stdout = execFileSync("php", [HARNESS], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    output = JSON.parse(stdout) as HarnessOutput;
  }
  return output;
}

function permission(group: "signature", name: string): PermissionResult {
  const got = run()[group][name];
  if (!got || typeof got !== "object") {
    throw new Error(
      `the harness reported no ${group} scenario named ${name}; it was renamed or removed`,
    );
  }
  return got;
}

function bearer(route: string, name: string): PermissionResult {
  const got = run().bearer[route]?.[name];
  if (!got) {
    throw new Error(`the harness reported no bearer scenario ${route}/${name}`);
  }
  return got;
}

function create(name: string): CreateResult {
  const got = run().create[name];
  if (!got) {
    throw new Error(`the harness reported no create scenario named ${name}`);
  }
  return got;
}

const BEARER_ROUTES = [
  "disconnect-store",
  "update-frontend-url",
  "handle-refund",
  "update-revalidate-secret",
  "update-checkout-type",
];

describe.skipIf(SKIPPING)(SUITE_TITLE, () => {
  beforeAll(() => {
    // Only reachable in CI: a local run without `php` skipped above.
    if (!PHP_AVAILABLE) {
      throw new Error(
        "`php` is not on PATH. CI is expected to provide it — `ubuntu-latest` " +
          "ships PHP preinstalled — so this suite fails rather than skipping.",
      );
    }
  });

  it("can verify Ed25519 (ext/sodium, or WordPress's sodium_compat in production)", () => {
    expect(run().sodium).toBe(true);
  });

  it("registers no route with an open or existence-only permission callback", () => {
    const routes = run().routes;
    expect(Object.keys(routes).sort()).toEqual(
      [
        "connect-store",
        "create-wp-site",
        "disconnect-store",
        "handle-refund",
        "update-checkout-type",
        "update-frontend-url",
        "update-revalidate-secret",
      ].sort(),
    );
    for (const cb of Object.values(routes)) {
      expect(cb).not.toBe("__return_true");
      expect(cb).not.toBe("check_disconnect_permission");
      expect(cb).not.toBe("check_store_connection");
    }
    expect(routes["create-wp-site"]).toBe(
      "headkit_check_create_wp_site_permission",
    );
    expect(routes["connect-store"]).toBe(
      "headkit_check_connect_store_permission",
    );
    for (const route of [
      "disconnect-store",
      "update-frontend-url",
      "handle-refund",
    ]) {
      expect(routes[route]).toBe("headkit_check_api_token_permission");
    }
  });

  it.each(BEARER_ROUTES)(
    "%s requires Authorization: Bearer <headkit_api_token>",
    (route) => {
      expect(bearer(route, "no_header")).toEqual({
        allowed: false,
        code: "missing_authorization",
        status: 401,
      });
      expect(bearer(route, "not_bearer")).toEqual({
        allowed: false,
        code: "missing_authorization",
        status: 401,
      });
      expect(bearer(route, "wrong_token")).toEqual({
        allowed: false,
        code: "invalid_token",
        status: 403,
      });
      expect(bearer(route, "site_not_connected")).toEqual({
        allowed: false,
        code: "store_not_connected",
        status: 403,
      });
      expect(bearer(route, "right_token").allowed).toBe(true);
    },
  );

  it("refuses an unsigned create-wp-site / connect-store (the reproduction)", () => {
    expect(permission("signature", "unsigned")).toEqual({
      allowed: false,
      code: "provisioning_missing_signature",
      status: 401,
    });
    expect(permission("signature", "connect_unsigned")).toEqual({
      allowed: false,
      code: "provisioning_missing_signature",
      status: 401,
    });
  });

  it("accepts a request signed by a trusted key, from the filter or the wp-config define", () => {
    expect(permission("signature", "signed_by_estate_key").allowed).toBe(true);
    expect(permission("signature", "connect_signed").allowed).toBe(true);
    expect(permission("signature", "wp_config_define_key").allowed).toBe(true);
    expect(permission("signature", "edge_timestamp").allowed).toBe(true);
    expect(permission("signature", "uppercase_host").allowed).toBe(true);
    expect(permission("signature", "home_url_host_fallback").allowed).toBe(
      true,
    );
  });

  it.each([
    ["signed_by_other_key", "provisioning_bad_signature"],
    ["no_filter_other_key", "provisioning_bad_signature"],
    ["signed_for_other_host", "provisioning_bad_signature"],
    ["signed_for_other_route", "provisioning_bad_signature"],
    ["connect_signed_with_create_route", "provisioning_bad_signature"],
    ["tampered_body", "provisioning_bad_signature"],
    ["stale_timestamp", "provisioning_stale_timestamp"],
    ["future_timestamp", "provisioning_stale_timestamp"],
    ["short_nonce", "provisioning_bad_nonce"],
  ])("refuses %s with 403 %s", (name, code) => {
    expect(permission("signature", name)).toEqual({
      allowed: false,
      code,
      status: 403,
    });
  });

  it("refuses a replayed nonce after the first acceptance", () => {
    expect(permission("signature", "replay_first").allowed).toBe(true);
    expect(permission("signature", "replay_second")).toEqual({
      allowed: false,
      code: "provisioning_replayed_nonce",
      status: 403,
    });
  });

  it("keeps a signed reconnect working, but refuses create-wp-site on a connected site", () => {
    expect(
      permission("signature", "connect_signed_while_connected").allowed,
    ).toBe(true);
    expect(permission("signature", "create_signed_while_connected")).toEqual({
      allowed: false,
      code: "store_already_connected",
      status: 403,
    });
  });

  it("fails closed with no trusted key configured", () => {
    expect(run().signature.empty_key_list_reason).toBe("no_public_key");
  });

  it("never promotes an existing non-administrator (the rogue-admin path)", () => {
    const subscriber = create("promote_existing_subscriber");
    expect(subscriber.permission.allowed).toBe(true); // the signature is fine; the HANDLER refuses
    expect(subscriber.result).toMatchObject({
      ok: false,
      code: "existing_user_not_admin",
      status: 409,
    });
    expect(subscriber.roles_after).toEqual(["subscriber"]);
    expect(subscriber.mail_sent).toBe(0);
    expect(subscriber.provisioned).toBe(false);

    const manager = create("promote_existing_shop_manager");
    expect(manager.result.code).toBe("existing_user_not_admin");
    expect(manager.roles_after).toEqual(["shop_manager"]);
  });

  it("creates a new administrator, and reuses an existing administrator on retry", () => {
    const fresh = create("new_email");
    expect(fresh.result.ok).toBe(true);
    expect(fresh.roles_after).toEqual(["administrator"]);
    expect(fresh.user_count).toBe(1);
    expect(fresh.mail_sent).toBe(1);
    expect(fresh.provisioned).toBe(true);

    const retry = create("existing_admin_retry");
    expect(retry.result.ok).toBe(true);
    expect(retry.roles_after).toEqual(["administrator"]);
    expect(retry.user_count).toBe(1); // reused, not duplicated
  });

  it("completes a signed connect-store: token stored, key minted under the service user", () => {
    const c = run().connect;
    expect(c.permission.allowed).toBe(true);
    expect(c.result?.ok).toBe(true);
    expect(c.api_token_set).toBe(true);
    expect(c.key_inserted).toBe(1);
    expect(c.key_owner_roles).toEqual(["shop_manager"]);
  });

  it("completes a bearer disconnect-store through the function the admin button shares", () => {
    const d = run().disconnect;
    expect(d.shared_function).toBe(true);
    expect(d.permission.allowed).toBe(true);
    expect(d.result?.ok).toBe(true);
    expect(d.backend_called).toBe(1);
    expect(d.backend_bearer).toBe(true);
    expect(d.key_deleted).toBe(1);
    expect(d.options_cleared).toBe(true);
  });

  it("verifies dashboard-api's pinned cross-language vector and the ±300 s window", () => {
    const v = run().vectors;
    // Same key, message and signature as internal/wpsign/wpsign_test.go.
    expect(v.go_vector).toBe("valid");
    expect(v.go_vector_upper_host).toBe("valid");
    expect(v.skew_plus_300).toBe("valid");
    expect(v.skew_minus_300).toBe("valid");
    expect(v.skew_plus_301).toBe("stale_timestamp");
    expect(v.skew_minus_301).toBe("stale_timestamp");
    expect(v.other_route).toBe("bad_signature");
    expect(v.other_host).toBe("bad_signature");
    expect(v.tampered_body).toBe("bad_signature");
    expect(v.other_nonce).toBe("bad_signature");
    expect(v.missing_signature).toBe("missing_signature");
    expect(v.non_numeric_timestamp).toBe("bad_timestamp");
    expect(v.garbage_signature).toBe("bad_signature");
    expect(v.replayed).toBe("replayed_nonce");
  });
});
