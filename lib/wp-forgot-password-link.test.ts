import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CI gate on the password-reset email link (theme 0.4.100):
 * `headkit_auth_forgot_password` in
 * `integrations/wordpress/theme/inc/rest-api/headkit-auth.php`.
 *
 * The theme emailed `/reset-password?key=…`, a path no storefront serves, so
 * every link 404'd in the `[...slug]` catch-all and the key was never used.
 * The real form is `/account/reset-password` (`app/account/(public)/reset-password`).
 * The theme has no test runner, so the harness runs the REAL endpoint file and
 * this suite fails when the link path drifts from the page that reads it.
 *
 * `php` is preinstalled on `ubuntu-latest`; this SKIPS on a machine without it
 * and FAILS in CI, where a silent skip would drop the only guard.
 */

const HARNESS = resolve(
  __dirname,
  "../../../integrations/wordpress/theme/tests/forgot-password-link-harness.php",
);

interface HarnessOutput {
  known: {
    status: number;
    link: string | null;
    origin: string;
    path: string | null;
    key: string | null;
    login: string | null;
    mail_count: number;
  };
  unknown: { status: number; mail_sent: number };
  other_origin: { link: string | null };
}

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
const SKIPPING = !PHP_AVAILABLE && !IS_CI;

let output: HarnessOutput | undefined;

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

describe(
  SKIPPING
    ? "WordPress password-reset email link [skipped: requires `php` on PATH]"
    : "WordPress password-reset email link",
  () => {
    it.skipIf(SKIPPING)(
      "points at /account/reset-password on the storefront origin",
      () => {
        const { known } = run();
        expect(known.status).toBe(200);
        expect(known.path).toBe("/account/reset-password");
        expect(known.origin).toBe("https://shop.example.test");
        expect(known.mail_count).toBe(1);
      },
    );

    it.skipIf(SKIPPING)("carries key and login intact through encoding", () => {
      const { known } = run();
      expect(known.key).toBe("Ab1+/=Zz");
      expect(known.login).toBe("jo.bloggs+test");
    });

    it.skipIf(SKIPPING)("follows the configured frontend URL", () => {
      expect(run().other_origin.link).toMatch(
        /^https:\/\/other\.example\.test\/account\/reset-password\?key=/,
      );
    });

    it.skipIf(SKIPPING)(
      "sends nothing and reveals nothing for an unknown email",
      () => {
        expect(run().unknown).toEqual({ status: 200, mail_sent: 0 });
      },
    );
  },
);
