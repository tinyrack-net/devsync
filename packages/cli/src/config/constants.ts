const APP_NAME = "devsync";
const AUTOCOMPLETE_COMPLETE_SUBCOMMAND = "__complete";

export const CONSTANTS = {
  APP: {
    NAME: APP_NAME,
  },
  AUTOCOMPLETE: {
    CLI_COMMAND_NAME: APP_NAME,
    COMMAND: `${APP_NAME} ${AUTOCOMPLETE_COMPLETE_SUBCOMMAND}`,
    COMPLETE_SUBCOMMAND: AUTOCOMPLETE_COMPLETE_SUBCOMMAND,
  },
  GLOBAL_CONFIG: {
    CURRENT_VERSION: 3,
    FILE_NAME: "settings.json",
    LEGACY_VERSION: 2,
  },
  INIT: {
    DEFAULT_IDENTITY_FILE: `~/.config/${APP_NAME}/keys.txt`,
    LEGACY_IDENTITY_FILE: `~/.config/${APP_NAME}/age/keys.txt`,
  },
  SYNC: {
    CONFIG_FILE_NAME: "manifest.json",
    CONFIG_VERSION: 7,
    DEFAULT_PROFILE: "default",
    MODES: ["normal", "secret", "ignore"],
    SECRET_ARTIFACT_SUFFIX: ".devsync.secret",
  },
  XDG: {
    APP_DIRECTORY_NAME: APP_NAME,
    SYNC_DIRECTORY_NAME: "repository",
  },
} as const;
