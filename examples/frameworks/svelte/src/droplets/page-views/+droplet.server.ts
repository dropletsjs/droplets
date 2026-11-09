import type { PageViews } from "../../lib/page-views.ts";
import { viewsOf } from "../../lib/server/page-views.ts";
import type { LoadEvent } from "./$types";

/**
 * The views counted so far, inlined into the fragment: the script gets
 * them as `data` without asking. It counts the new one itself, in the browser.
 */
export const load = ({ props }: LoadEvent): PageViews => ({ page: props.page, views: viewsOf(props.page) });
