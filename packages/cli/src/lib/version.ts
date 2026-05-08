import { AppConstants } from "#app/config/constants.ts";
import packageJson from "../../package.json" with { type: "json" };

export const currentVersion = `${AppConstants.APP.NAME}/${packageJson.version}`;
