import { homedir } from "node:os";
import { resolve } from "node:path";

export const supportedSkillInstallAgents = [
  "pi",
  "codex",
  "claude",
  "opencode",
] as const;

export type SupportedSkillInstallAgent =
  (typeof supportedSkillInstallAgents)[number];

const resolvePiTargetDirectory = (environment: NodeJS.ProcessEnv) => {
  const environmentWithPiDirectory = environment as NodeJS.ProcessEnv & {
    PI_CODING_AGENT_DIR?: string;
  };
  const customAgentDirectory =
    environmentWithPiDirectory.PI_CODING_AGENT_DIR?.trim();

  if (customAgentDirectory !== undefined && customAgentDirectory !== "") {
    return resolve(customAgentDirectory, "skills");
  }

  return resolve(homedir(), ".pi", "agent", "skills");
};

const skillInstallTargetDirectoryResolvers = {
  pi: resolvePiTargetDirectory,
  codex: () => resolve(homedir(), ".agents", "skills"),
  claude: () => resolve(homedir(), ".claude", "skills"),
  opencode: () => resolve(homedir(), ".config", "opencode", "skills"),
} satisfies Record<
  SupportedSkillInstallAgent,
  (environment: NodeJS.ProcessEnv) => string
>;

export const resolveSkillInstallTargetDirectory = (
  agent: SupportedSkillInstallAgent,
  environment: NodeJS.ProcessEnv,
  targetDirectory?: string,
) => {
  if (targetDirectory !== undefined && targetDirectory !== "") {
    return resolve(targetDirectory);
  }

  return skillInstallTargetDirectoryResolvers[agent](environment);
};
