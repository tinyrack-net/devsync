import { CONSTANTS } from "#app/config/constants.ts";
import packageJson from "../../package.json" with { type: "json" };

export const currentVersion = `${CONSTANTS.APP.NAME}/${packageJson.version}`;
