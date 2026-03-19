import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveSkillInstallTargetDirectory,
  type SupportedSkillInstallAgent,
  supportedSkillInstallAgents,
} from "#app/skills/agents.ts";

const defaultTargetDirectories = {
  pi: join(homedir(), ".pi", "agent", "skills"),
  codex: join(homedir(), ".agents", "skills"),
  claude: join(homedir(), ".claude", "skills"),
  opencode: join(homedir(), ".config", "opencode", "skills"),
} satisfies Record<SupportedSkillInstallAgent, string>;

describe("supportedSkillInstallAgents", () => {
  it("lists all supported agent harnesses", () => {
    expect(supportedSkillInstallAgents).toEqual([
      "pi",
      "codex",
      "claude",
      "opencode",
    ]);
  });
});

describe("resolveSkillInstallTargetDirectory", () => {
  it.each(
    supportedSkillInstallAgents,
  )("prefers an explicit target directory for %s", (agent) => {
    expect(
      resolveSkillInstallTargetDirectory(agent, {}, "./custom-target"),
    ).toBe(resolve("./custom-target"));
  });

  it("uses PI_CODING_AGENT_DIR for pi when set", () => {
    expect(
      resolveSkillInstallTargetDirectory("pi", {
        PI_CODING_AGENT_DIR: "/tmp/pi-agent",
      }),
    ).toBe(resolve("/tmp/pi-agent", "skills"));
  });

  it.each(
    Object.entries(defaultTargetDirectories) as Array<
      [SupportedSkillInstallAgent, string]
    >,
  )("uses the default user-global directory for %s", (agent, expectedPath) => {
    expect(resolveSkillInstallTargetDirectory(agent, {})).toBe(expectedPath);
  });
});
