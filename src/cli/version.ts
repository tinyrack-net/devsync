import packageJson from "../../package.json" with { type: "json" };

export const currentVersion = `devsync/${packageJson.version}`;
