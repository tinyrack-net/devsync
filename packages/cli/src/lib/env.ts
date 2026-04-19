import z from "zod";

const EnvSchema = z
  .object({
    /**
     * @description
     * Windows only. Path to the default command interpreter (usually `cmd.exe`).
     * Used as the fallback shell command when no explicit override is configured
     * and no parent PowerShell process is detected on the Windows platform.
     */
    COMSPEC: z.string().optional(),

    /**
     * @description
     * The current user's home directory. Used as the root for resolving `~`-prefixed
     * local paths throughout config loading, path expansion, and sync entry
     * resolution on all platforms.
     */
    HOME: z.string().optional(),

    /**
     * @description
     * Unix/macOS/WSL. Absolute path to the user's preferred login shell (e.g.
     * `/bin/zsh` or `/usr/bin/fish`). Read by the `dotweave cd` command to select
     * the shell to launch when no explicit override is configured.
     */
    SHELL: z.string().optional(),

    /**
     * @description
     * WSL (Windows Subsystem for Linux) only. Set by WSL to the name of the active
     * distro (e.g. `Ubuntu`). Its presence is used to detect the WSL platform so
     * that WSL-specific sync mode overrides are applied when resolving config entries.
     */
    WSL_DISTRO_NAME: z.string().optional(),

    /**
     * @description
     * WSL (Windows Subsystem for Linux) only. Path to the WSL interop socket used
     * to communicate with the Windows host. Its presence is used as a secondary
     * signal for detecting the WSL platform alongside `WSL_DISTRO_NAME`.
     */
    WSL_INTEROP: z.string().optional(),

    /**
     * @description
     * XDG Base Directory spec override for the user's config home. When set,
     * replaces the default `~/.config` location for all dotweave configuration
     * files (global config, identity keys, the sync directory). Expanded via
     * Windows-style `%VARIABLE%` expansion when running under WSL or Windows.
     */
    XDG_CONFIG_HOME: z.string().optional(),
  })
  .catchall(z.string().optional());

export type Env = z.infer<typeof EnvSchema>;

export const ENV: Env = EnvSchema.parse(process.env);
