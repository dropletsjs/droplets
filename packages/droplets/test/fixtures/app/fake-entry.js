// A stand-in adapter entry: proves the virtual modules resolve and bundle.
import userConfig from "virtual:droplets-config";
import manifest from "virtual:droplets-manifest";
import * as ssr from "virtual:droplets-ssr";

export const marker = "fake-entry-marker";
export default { userConfig, manifest, render: ssr.renderDroplet };
